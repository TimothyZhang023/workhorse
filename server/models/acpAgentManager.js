import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

import {
  getAcpAgent,
  getConversation,
  listMcpServers,
  updateAcpAgentLastUsedModel,
  updateConversationAcpModel,
  updateConversationAcpSession,
  updateConversationTitle,
} from "./database.js";
import { logger } from "../utils/logger.js";
import { getShellEnv, resolveExecutableCommand } from "../utils/shellEnv.js";
import { getConversationAgentPrompt } from "../utils/workspaceAgentConfig.js";

const runtimeCache = new Map();
const ACP_CLIENT_INFO = {
  name: "workhorse-acp-client",
  title: "Workhorse ACP Client",
  version: "0.1.0",
};

export const ACP_AGENT_PRESETS = {
  opencode: {
    id: "opencode",
    label: "OpenCode",
    docs: "https://opencode.ai/docs/acp/",
    command: "opencode",
    args: ["acp"],
    env_key: "OPENCODE_API_KEY",
    description: "通过 `opencode acp` 将 OpenCode 作为外部 ACP Agent 接入。",
  },
  claude_code: {
    id: "claude_code",
    label: "Claude Code ACP Adapter",
    docs: "https://github.com/zed-industries/claude-code-acp",
    command: "npx",
    args: ["-y", "@zed-industries/claude-agent-acp"],
    env_key: "ANTHROPIC_API_KEY",
    description:
      "通过 Zed 官方 `@zed-industries/claude-agent-acp` adapter 将 Claude Code 接入 ACP。",
  },
};

export function resolveAcpLaunchSpec(agentConfig = {}) {
  const rawCommand = String(agentConfig.command || "").trim();
  const rawArgs = Array.isArray(agentConfig.args) ? agentConfig.args.map(String) : [];

  if (agentConfig.preset === "claude_code") {
    const normalizedCommand = rawCommand.toLowerCase();
    const isLegacyBareCommand =
      (normalizedCommand === "claude-code-acp" ||
        normalizedCommand === "claude-agent-acp") &&
      rawArgs.length === 0;

    if (isLegacyBareCommand) {
      return {
        command: "npx",
        args: ["-y", "@zed-industries/claude-agent-acp"],
      };
    }
  }

  return {
    command: rawCommand,
    args: rawArgs,
  };
}

function buildFriendlyLaunchError(error, agentConfig, launchSpec) {
  if (error?.code !== "ENOENT") {
    return error;
  }

  const attempted = [launchSpec.command, ...(launchSpec.args || [])]
    .filter(Boolean)
    .join(" ");

  if (agentConfig?.preset === "claude_code") {
    return new Error(
      `未找到 Claude ACP 启动命令。当前尝试执行：${attempted || "未配置"}。请确认本机已安装 Node.js/npm，并先执行 \`npx -y @zed-industries/claude-agent-acp --help\` 验证。`
    );
  }

  return new Error(
    `未找到 ACP 启动命令：${launchSpec.command || "未配置"}。请确认该命令已安装并位于 PATH 中。`
  );
}

function getWorkspaceRoot() {
  return path.resolve(process.env.WORKHORSE_WORKSPACE_ROOT || process.cwd());
}

function getRuntimeKey(uid, agentId) {
  return `${uid}:${agentId}`;
}

function withAuthHeaders(headers = {}, auth = null) {
  const next = { ...(headers || {}) };

  if (!auth || !auth.type) {
    return next;
  }

  if (auth.type === "bearer" && auth.token) {
    next.Authorization = `Bearer ${auth.token}`;
  }

  if (auth.type === "basic" && auth.username) {
    const encoded = Buffer.from(
      `${auth.username}:${auth.password || ""}`,
      "utf8"
    ).toString("base64");
    next.Authorization = `Basic ${encoded}`;
  }

  return next;
}

function mapHeaders(headers = {}) {
  return Object.entries(headers || {})
    .filter(([name, value]) => name && value !== undefined && value !== null)
    .map(([name, value]) => ({
      name: String(name),
      value: String(value),
    }));
}

function mapEnv(env = {}) {
  return Object.entries(env || {})
    .filter(([name, value]) => name && value !== undefined && value !== null)
    .map(([name, value]) => ({
      name: String(name),
      value: String(value),
    }));
}

function buildMcpServersForAcp(uid) {
  return listMcpServers(uid)
    .filter((server) => Number(server.is_enabled) === 1)
    .map((server) => {
      if (server.type === "stdio") {
        return {
          name: server.name,
          command: String(server.command || ""),
          args: Array.isArray(server.args) ? server.args.map(String) : [],
          env: mapEnv(server.env || {}),
        };
      }

      const headers = withAuthHeaders(server.headers || {}, server.auth || null);
      const normalizedType = server.type === "sse" ? "sse" : "http";
      return {
        type: normalizedType,
        name: server.name,
        url: String(server.url || ""),
        headers: mapHeaders(headers),
      };
    })
    .filter((server) => {
      if ("command" in server) {
        return Boolean(server.command);
      }
      return Boolean(server.url);
    });
}

function inferImageMime(base64Data = "") {
  return String(base64Data || "").startsWith("/9j/")
    ? "image/jpeg"
    : "image/png";
}

function normalizeUsageUpdate(update = {}) {
  if (!update || typeof update !== "object") {
    return update;
  }

  if (update.sessionUpdate !== "usage_update") {
    return update;
  }

  const normalized = { ...update };
  const used = normalized.used;
  if (used === null || used === undefined || used === "") {
    normalized.used = 0;
  } else {
    const numericUsed = Number(used);
    normalized.used = Number.isFinite(numericUsed) ? numericUsed : 0;
  }

  if (normalized.size !== null && normalized.size !== undefined) {
    const numericSize = Number(normalized.size);
    if (Number.isFinite(numericSize)) {
      normalized.size = numericSize;
    }
  }

  return normalized;
}

function normalizeIncomingAcpMessage(message) {
  if (!message || typeof message !== "object") {
    return message;
  }

  if (message.method !== "session/update") {
    return message;
  }

  const params =
    message.params && typeof message.params === "object" ? message.params : null;
  const update = params?.update;
  if (!update || typeof update !== "object") {
    return message;
  }

  const normalizedUpdate = normalizeUsageUpdate(update);
  if (normalizedUpdate === update) {
    return message;
  }

  return {
    ...message,
    params: {
      ...params,
      update: normalizedUpdate,
    },
  };
}

function createNormalizedNdJsonStream(output, input) {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  const readable = new ReadableStream({
    async start(controller) {
      let content = "";
      const reader = input.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          if (!value) {
            continue;
          }

          content += textDecoder.decode(value, { stream: true });
          const lines = content.split("\n");
          content = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) {
              continue;
            }

            try {
              controller.enqueue(normalizeIncomingAcpMessage(JSON.parse(trimmedLine)));
            } catch (error) {
              logger.warn(
                {
                  err: error,
                  line: trimmedLine.slice(0, 400),
                },
                "[ACP] Failed to parse incoming NDJSON message"
              );
            }
          }
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });

  const writable = new WritableStream({
    async write(message) {
      const content = `${JSON.stringify(message)}\n`;
      const writer = output.getWriter();
      try {
        await writer.write(textEncoder.encode(content));
      } finally {
        writer.releaseLock();
      }
    },
  });

  return { readable, writable };
}

function toPromptBlocks(message = "", images = []) {
  const blocks = [];
  const trimmed = String(message || "").trim();
  if (trimmed) {
    blocks.push({
      type: "text",
      text: trimmed,
    });
  }

  for (const image of Array.isArray(images) ? images : []) {
    const data = String(image || "").trim();
    if (!data) continue;
    blocks.push({
      type: "image",
      data,
      mimeType: inferImageMime(data),
    });
  }

  return blocks;
}

function extractDisplayContent(content = "") {
  return String(content || "").replace(/\[IMAGE_DATA:[^\]]+\]/g, "[图片]");
}

function buildReplayBootstrapText(history = []) {
  const transcript = (Array.isArray(history) ? history : [])
    .map((message, index) => {
      const role =
        message.role === "assistant"
          ? "assistant"
          : message.role === "tool"
            ? "tool"
            : "user";
      const text = extractDisplayContent(message.content || "").trim();
      if (!text) {
        return "";
      }
      return `${index + 1}. ${role}: ${text}`;
    })
    .filter(Boolean)
    .join("\n");

  if (!transcript) {
    return "";
  }

  return [
    "下面是此前已经发生的完整对话历史，请把它恢复为后续对话的上下文。",
    "这是一次隐藏的上下文同步，不是要你正式回答用户。",
    "严格要求：",
    "1. 不要调用任何工具，不要修改文件，不要执行命令。",
    "2. 不要分析任务，不要总结方案，不要复述历史。",
    "3. 只回复单个单词 READY。",
    "",
    "历史记录：",
    transcript,
  ].join("\n");
}

function buildAgentPromptBootstrapText(agentPrompt = "") {
  const normalizedPrompt = String(agentPrompt || "").trim();
  if (!normalizedPrompt) {
    return "";
  }

  return [
    "下面是当前会话绑定的 Agent 运行提示词，请把它作为后续对话的长期约束。",
    "这是一次隐藏的上下文同步，不是要你正式回答用户。",
    "严格要求：",
    "1. 不要调用任何工具，不要修改文件，不要执行命令。",
    "2. 不要总结、不要复述、不要解释规则。",
    "3. 只回复单个单词 READY。",
    "",
    "Agent 提示词：",
    normalizedPrompt,
  ].join("\n");
}

function contentBlockToText(content) {
  if (!content) return "";
  if (content.type === "text") return String(content.text || "");
  if (content.type === "resource" && content.resource?.text) {
    return String(content.resource.text || "");
  }
  return "";
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function selectPermissionOption(options = [], strategy = "allow") {
  const normalized = Array.isArray(options) ? options : [];
  if (strategy === "reject") {
    return (
      normalized.find((item) => item.kind === "reject_once") ||
      normalized.find((item) => item.kind === "reject_always") ||
      null
    );
  }

  return (
    normalized.find((item) => item.kind === "allow_once") ||
    normalized.find((item) => item.kind === "allow_always") ||
    normalized[0] ||
    null
  );
}

class ManagedTerminal {
  constructor(params) {
    this.id = crypto.randomUUID();
    this.outputByteLimit =
      Number.isFinite(Number(params.outputByteLimit)) &&
      Number(params.outputByteLimit) > 0
        ? Math.round(Number(params.outputByteLimit))
        : 256 * 1024;
    this.output = "";
    this.truncated = false;
    this.exitCode = null;
    this.signal = null;
    this.released = false;

    const command = resolveExecutableCommand(params.command, params.env);
    this.child = spawn(command, params.args || [], {
      cwd: params.cwd,
      env: params.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.waitPromise = new Promise((resolve) => {
      this.child.once("close", (exitCode, signal) => {
        this.exitCode = typeof exitCode === "number" ? exitCode : null;
        this.signal = signal || null;
        resolve({
          exitCode: this.exitCode,
          signal: this.signal,
        });
      });
    });

    for (const stream of [this.child.stdout, this.child.stderr]) {
      stream?.on("data", (chunk) => {
        this.appendOutput(chunk);
      });
    }
  }

  appendOutput(chunk) {
    const nextChunk = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (!nextChunk) return;
    this.output += nextChunk;
    const outputBytes = Buffer.byteLength(this.output, "utf8");
    if (outputBytes <= this.outputByteLimit) return;

    this.truncated = true;
    const targetBytes = Math.max(this.outputByteLimit - 64, 0);
    let current = this.output;
    while (Buffer.byteLength(current, "utf8") > targetBytes && current.length > 0) {
      current = current.slice(1);
    }
    this.output = current;
  }

  async currentOutput() {
    return {
      output: this.output,
      truncated: this.truncated,
      exitStatus:
        this.exitCode !== null || this.signal
          ? {
              exitCode: this.exitCode,
              signal: this.signal,
            }
          : null,
    };
  }

  async waitForExit() {
    return this.waitPromise;
  }

  async kill() {
    if (!this.child.killed && this.exitCode === null && !this.signal) {
      this.child.kill("SIGTERM");
    }
    return {};
  }

  async release() {
    if (this.released) {
      return {};
    }
    this.released = true;
    await this.kill();
    return {};
  }
}

class WorkhorseAcpClient {
  constructor(runtime) {
    this.runtime = runtime;
  }

  async sessionUpdate(params) {
    this.runtime.handleSessionUpdate(params);
  }

  async requestPermission(params) {
    const strategy =
      this.runtime.permissionStrategies.get(String(params.sessionId)) || "allow";
    const selected = selectPermissionOption(params.options, strategy);
    if (!selected) {
      return {
        outcome: {
          outcome: "cancelled",
        },
      };
    }

    return {
      outcome: {
        outcome: "selected",
        optionId: selected.optionId,
      },
    };
  }

  async readTextFile(params) {
    const filePath = path.resolve(String(params.path || ""));
    const raw = fs.readFileSync(filePath, "utf8");
    const startLine =
      Number.isFinite(Number(params.line)) && Number(params.line) > 0
        ? Math.round(Number(params.line)) - 1
        : 0;
    const limit =
      Number.isFinite(Number(params.limit)) && Number(params.limit) > 0
        ? Math.round(Number(params.limit))
        : null;

    if (!limit && startLine <= 0) {
      return { content: raw };
    }

    const lines = raw.split("\n");
    const sliced = lines.slice(startLine, limit ? startLine + limit : undefined);
    return {
      content: sliced.join("\n"),
    };
  }

  async writeTextFile(params) {
    const filePath = path.resolve(String(params.path || ""));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, String(params.content || ""), "utf8");
    return {};
  }

  async createTerminal(params) {
    const sessionCwd = this.runtime.sessionCwds.get(String(params.sessionId));
    const cwd = path.resolve(String(params.cwd || sessionCwd || getWorkspaceRoot()));
    const env = {
      ...getShellEnv(),
      ...Object.fromEntries(
        (Array.isArray(params.env) ? params.env : []).map((item) => [
          item.name,
          item.value,
        ])
      ),
    };
    const terminal = new ManagedTerminal({
      command: params.command,
      args: Array.isArray(params.args) ? params.args.map(String) : [],
      cwd,
      env,
      outputByteLimit: params.outputByteLimit,
    });
    this.runtime.terminals.set(terminal.id, terminal);
    return {
      terminalId: terminal.id,
    };
  }

  async terminalOutput(params) {
    const terminal = this.runtime.terminals.get(String(params.terminalId));
    if (!terminal) {
      throw new Error("Terminal not found");
    }
    return terminal.currentOutput();
  }

  async waitForTerminalExit(params) {
    const terminal = this.runtime.terminals.get(String(params.terminalId));
    if (!terminal) {
      throw new Error("Terminal not found");
    }
    return terminal.waitForExit();
  }

  async killTerminal(params) {
    const terminal = this.runtime.terminals.get(String(params.terminalId));
    if (!terminal) {
      return {};
    }
    return terminal.kill();
  }

  async releaseTerminal(params) {
    const terminalId = String(params.terminalId);
    const terminal = this.runtime.terminals.get(terminalId);
    if (!terminal) {
      return {};
    }
    await terminal.release();
    this.runtime.terminals.delete(terminalId);
    return {};
  }
}

class AcpRuntime {
  constructor(uid, agentConfig) {
    this.uid = uid;
    this.agentConfig = agentConfig;
    this.runtimeKey = getRuntimeKey(uid, agentConfig.id);
    this.terminals = new Map();
    this.sessionCwds = new Map();
    this.updateHandlers = new Map();
    this.permissionStrategies = new Map();
    this.initialized = false;
    this.agentCapabilities = {};
    this.agentInfo = null;
    this.sessionModels = new Map();
    this.closed = false;
  }

  handleSessionUpdate(params) {
    const handler = this.updateHandlers.get(String(params.sessionId));
    if (!handler) return;
    handler(params.update);
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    runtimeCache.delete(this.runtimeKey);
    for (const terminal of this.terminals.values()) {
      terminal.release().catch(() => {});
    }
    this.terminals.clear();
    this.updateHandlers.clear();
    this.permissionStrategies.clear();
    this.sessionModels.clear();
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
  }

  async ensureInitialized() {
    if (this.initialized) {
      return this;
    }

    const launchSpec = resolveAcpLaunchSpec(this.agentConfig);
    const env = {
      ...getShellEnv(),
      ...(this.agentConfig.env || {}),
    };
    const command = resolveExecutableCommand(launchSpec.command, env);
    let startupError = null;
    this.child = spawn(command, launchSpec.args || [], {
      cwd: getWorkspaceRoot(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const childStartupError = new Promise((_, reject) => {
      this.child.once("error", (error) => {
        startupError = error;
        reject(error);
      });
    });
    this.child.once("exit", (code, signal) => {
      logger.warn(
        {
          uid: this.uid,
          agentId: this.agentConfig.id,
          code,
          signal,
        },
        "[ACP] Agent process exited"
      );
      this.dispose();
    });
    this.child.stderr?.on("data", (chunk) => {
      logger.debug(
        {
          uid: this.uid,
          agentId: this.agentConfig.id,
          stderr: String(chunk || ""),
        },
        "[ACP] Agent stderr"
      );
    });

    const stream = createNormalizedNdJsonStream(
      Writable.toWeb(this.child.stdin),
      Readable.toWeb(this.child.stdout)
    );
    this.clientImpl = new WorkhorseAcpClient(this);
    this.connection = new acp.ClientSideConnection(() => this.clientImpl, stream);
    let initResult;
    try {
      initResult = await Promise.race([
        this.connection.initialize({
          protocolVersion: acp.PROTOCOL_VERSION,
          clientInfo: ACP_CLIENT_INFO,
          clientCapabilities: {
            fs: {
              readTextFile: true,
              writeTextFile: true,
            },
            terminal: true,
            auth: {
              terminal: true,
            },
          },
        }),
        childStartupError,
      ]);
    } catch (error) {
      const friendlyError = buildFriendlyLaunchError(
        startupError || error,
        this.agentConfig,
        launchSpec
      );
      logger.error(
        {
          err: friendlyError,
          uid: this.uid,
          agentId: this.agentConfig.id,
          command,
          args: launchSpec.args || [],
        },
        "[ACP] Agent process error"
      );
      this.dispose();
      throw friendlyError;
    }

    this.agentCapabilities = initResult.agentCapabilities || {};
    this.agentInfo = initResult.agentInfo || null;
    this.protocolVersion = initResult.protocolVersion || acp.PROTOCOL_VERSION;
    this.initialized = true;
    return this;
  }

  recordSessionModels(sessionId, modelState) {
    if (!sessionId) return;
    if (modelState && typeof modelState === "object") {
      this.sessionModels.set(String(sessionId), modelState);
      return;
    }
    this.sessionModels.delete(String(sessionId));
  }

  getSessionModelState(sessionId) {
    return this.sessionModels.get(String(sessionId)) || null;
  }

  async applyPreferredModel(sessionId, preferredModelId) {
    const desiredModelId = String(preferredModelId || "").trim();
    if (!desiredModelId) {
      return;
    }

    const connectionSupportsModelSelection =
      typeof this.connection?.unstable_setSessionModel === "function";
    if (!connectionSupportsModelSelection) {
      logger.warn(
        {
          uid: this.uid,
          agentId: this.agentConfig.id,
          desiredModelId,
        },
        "[ACP] Agent does not expose session model selection"
      );
      return;
    }

    const modelState = this.sessionModels.get(String(sessionId)) || null;
    const currentModelId = String(modelState?.currentModelId || "").trim();
    if (currentModelId && currentModelId === desiredModelId) {
      return;
    }

    const availableModels = Array.isArray(modelState?.availableModels)
      ? modelState.availableModels
      : [];
    if (
      availableModels.length > 0 &&
      !availableModels.some(
        (model) => String(model?.modelId || "").trim() === desiredModelId
      )
    ) {
      logger.warn(
        {
          uid: this.uid,
          agentId: this.agentConfig.id,
          desiredModelId,
          availableModels: availableModels.map((model) => model.modelId),
        },
        "[ACP] Preferred model is not available on this agent"
      );
      return;
    }

    try {
      await this.connection.unstable_setSessionModel({
        sessionId,
        modelId: desiredModelId,
      });

      if (modelState) {
        this.sessionModels.set(String(sessionId), {
          ...modelState,
          currentModelId: desiredModelId,
        });
      }
    } catch (error) {
      logger.warn(
        {
          err: error,
          uid: this.uid,
          agentId: this.agentConfig.id,
          sessionId,
          desiredModelId,
        },
        "[ACP] Failed to switch session model; continuing with agent default"
      );
    }
  }

  async setSessionModel(sessionId, modelId, options = {}) {
    const desiredModelId = String(modelId || "").trim();
    if (!desiredModelId) {
      throw new Error("缺少目标模型 ID");
    }

    const strict = Boolean(options.strict);
    const connectionSupportsModelSelection =
      typeof this.connection?.unstable_setSessionModel === "function";
    if (!connectionSupportsModelSelection) {
      if (strict) {
        throw new Error("当前 ACP Agent 不支持会话内切模型");
      }
      return;
    }

    const modelState = this.getSessionModelState(sessionId);
    const availableModels = Array.isArray(modelState?.availableModels)
      ? modelState.availableModels
      : [];
    if (
      availableModels.length > 0 &&
      !availableModels.some(
        (model) => String(model?.modelId || "").trim() === desiredModelId
      )
    ) {
      throw new Error(`模型 ${desiredModelId} 不在当前 ACP Agent 的可用模型列表中`);
    }

    await this.connection.unstable_setSessionModel({
      sessionId,
      modelId: desiredModelId,
    });

    this.sessionModels.set(String(sessionId), {
      ...(modelState || {}),
      currentModelId: desiredModelId,
      availableModels,
    });
  }

  async createSession(conversationId, cwd, mcpServers, preferredModelId = "") {
    const created = await this.connection.newSession({
      cwd,
      mcpServers,
    });
    this.sessionCwds.set(created.sessionId, cwd);
    this.recordSessionModels(created.sessionId, created.models || null);
    await this.applyPreferredModel(created.sessionId, preferredModelId);
    updateConversationAcpSession(conversationId, this.uid, created.sessionId);
    return created.sessionId;
  }

  async tryRestoreSession(sessionId, cwd, mcpServers, preferredModelId = "") {
    if (
      this.agentCapabilities?.sessionCapabilities?.resume &&
      typeof this.connection.unstable_resumeSession === "function"
    ) {
      try {
        const resumed = await this.connection.unstable_resumeSession({
          sessionId,
          cwd,
          mcpServers,
        });
        this.sessionCwds.set(sessionId, cwd);
        this.recordSessionModels(sessionId, resumed?.models || null);
        await this.applyPreferredModel(sessionId, preferredModelId);
        return true;
      } catch (error) {
        logger.warn(
          {
            err: error,
            uid: this.uid,
            agentId: this.agentConfig.id,
            sessionId,
          },
          "[ACP] Resume session failed"
        );
      }
    }

    if (
      this.agentCapabilities?.loadSession &&
      typeof this.connection.loadSession === "function"
    ) {
      try {
        const loaded = await this.connection.loadSession({
          sessionId,
          cwd,
          mcpServers,
        });
        this.sessionCwds.set(sessionId, cwd);
        this.recordSessionModels(sessionId, loaded?.models || null);
        await this.applyPreferredModel(sessionId, preferredModelId);
        return true;
      } catch (error) {
        logger.warn(
          {
            err: error,
            uid: this.uid,
            agentId: this.agentConfig.id,
            sessionId,
          },
          "[ACP] Load session failed"
        );
      }
    }

    return false;
  }

  async replayHistory(sessionId, history = [], agentPrompt = "") {
    const agentPromptBootstrap = buildAgentPromptBootstrapText(agentPrompt);
    if (agentPromptBootstrap) {
      await this.prompt({
        sessionId,
        prompt: toPromptBlocks(agentPromptBootstrap),
        onUpdate: () => {},
        permissionStrategy: "reject",
      });
    }

    const bootstrapText = buildReplayBootstrapText(history);
    if (!bootstrapText) {
      return;
    }

    await this.prompt({
      sessionId,
      prompt: toPromptBlocks(bootstrapText),
      onUpdate: () => {},
      permissionStrategy: "reject",
    });
  }

  async ensureSession(conversation, history = [], options = {}) {
    const cwd = getWorkspaceRoot();
    const mcpServers = buildMcpServersForAcp(this.uid);
    const currentSessionId = String(conversation?.acp_session_id || "").trim();
    const agentPrompt = getConversationAgentPrompt(this.uid, conversation);
    const forceRebuild = Boolean(options.forceRebuild);
    const preferredModelId =
      String(
        options.preferredModelId ??
          conversation?.acp_model_id ??
          this.agentConfig.default_model_id ??
          ""
      ).trim() || "";

    if (!forceRebuild && currentSessionId && this.sessionCwds.has(currentSessionId)) {
      await this.applyPreferredModel(currentSessionId, preferredModelId);
      return currentSessionId;
    }

    if (!forceRebuild && currentSessionId) {
      const restored = await this.tryRestoreSession(
        currentSessionId,
        cwd,
        mcpServers,
        preferredModelId
      );
      if (restored) {
        return currentSessionId;
      }
    }

    const nextSessionId = await this.createSession(
      conversation.id,
      cwd,
      mcpServers,
      preferredModelId
    );
    if ((Array.isArray(history) && history.length > 0) || agentPrompt) {
      await this.replayHistory(nextSessionId, history, agentPrompt);
    }
    return nextSessionId;
  }

  async prompt({
    sessionId,
    prompt,
    onUpdate,
    permissionStrategy = "allow",
  }) {
    this.updateHandlers.set(String(sessionId), onUpdate);
    this.permissionStrategies.set(String(sessionId), permissionStrategy);
    try {
      return await this.connection.prompt({
        sessionId,
        prompt,
      });
    } finally {
      this.updateHandlers.delete(String(sessionId));
      this.permissionStrategies.delete(String(sessionId));
    }
  }

  async cancel(sessionId) {
    if (!this.connection || !sessionId) return;
    await this.connection.cancel({ sessionId });
  }
}

function disposeRuntime(uid, agentId) {
  const runtimeKey = getRuntimeKey(uid, agentId);
  const runtime = runtimeCache.get(runtimeKey);
  if (runtime) {
    runtime.dispose();
  }
}

async function getRuntime(uid, agentId, options = {}) {
  const runtimeKey = getRuntimeKey(uid, agentId);
  if (options.forceRecreate) {
    disposeRuntime(uid, agentId);
  }

  if (runtimeCache.has(runtimeKey)) {
    return runtimeCache.get(runtimeKey);
  }

  const agentConfig = getAcpAgent(agentId, uid, { includeSecrets: true });
  if (!agentConfig || Number(agentConfig.is_enabled) !== 1) {
    throw new Error("ACP Agent 不存在或已禁用");
  }

  const runtime = new AcpRuntime(uid, agentConfig);
  runtimeCache.set(runtimeKey, runtime);
  try {
    await runtime.ensureInitialized();
    return runtime;
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

function maybePersistConversationTitle(conversationId, uid, nextTitle) {
  const normalized = String(nextTitle || "").trim();
  if (!normalized) return;

  const current = getConversation(conversationId, uid);
  if (!current) return;
  const currentTitle = String(current.title || "").trim();
  if (currentTitle && currentTitle !== "新对话") return;
  updateConversationTitle(conversationId, uid, normalized.slice(0, 64));
}

export async function streamAcpConversation({
  uid,
  conversation,
  conversationId,
  message,
  images,
  history = [],
  res,
  debug = false,
}) {
  const prompt = toPromptBlocks(message, images);
  if (!prompt.length) {
    throw new Error("ACP 对话消息不能为空");
  }
  const priorHistory = Array.isArray(history) ? history.slice(0, -1) : [];
  let lastError = null;

  for (const attempt of [0, 1]) {
    let finalText = "";
    const toolStatusMap = new Map();
    const onUpdate = (update) => {
      switch (update.sessionUpdate) {
        case "agent_message_chunk": {
          const text = contentBlockToText(update.content);
          if (text) {
            finalText += text;
            writeSse(res, { content: text });
          }
          return;
        }
        case "tool_call": {
          toolStatusMap.set(update.toolCallId, update.title || "工具执行");
          writeSse(res, {
            type: "tool_running",
            tool_name: update.title || "工具执行",
          });
          return;
        }
        case "tool_call_update": {
          const toolTitle =
            update.title ||
            toolStatusMap.get(update.toolCallId) ||
            "工具执行";
          toolStatusMap.set(update.toolCallId, toolTitle);
          if (update.status === "in_progress") {
            writeSse(res, {
              type: "tool_running",
              tool_name: toolTitle,
            });
          }
          if (debug) {
            writeSse(res, {
              type: "debug",
              phase: "acp_tool_update",
              tool_call_id: update.toolCallId,
              title: toolTitle,
              status: update.status || "unknown",
            });
          }
          return;
        }
        case "session_info_update": {
          if (update.title) {
            maybePersistConversationTitle(conversationId, uid, update.title);
            writeSse(res, { title: update.title });
          }
          return;
        }
        case "plan": {
          if (!debug) return;
          writeSse(res, {
            type: "debug",
            phase: "acp_plan",
            entries: update.entries || [],
          });
          return;
        }
        case "agent_thought_chunk": {
          if (!debug) return;
          const thought = contentBlockToText(update.content);
          if (!thought) return;
          writeSse(res, {
            type: "debug",
            phase: "acp_thought",
            content: thought,
          });
          return;
        }
        default:
          return;
      }
    };

    try {
      const runtime = await getRuntime(uid, conversation.acp_agent_id, {
        forceRecreate: attempt === 1,
      });
      const latestConversation =
        attempt === 0
          ? conversation
          : getConversation(conversationId, uid) || conversation;
      const sessionId = await runtime.ensureSession(latestConversation, priorHistory, {
        forceRebuild: attempt === 1,
      });
      const result = await runtime.prompt({
        sessionId,
        prompt,
        onUpdate,
      });

      if (!finalText.trim() && result.stopReason === "refusal") {
        finalText = "抱歉，外部 ACP Agent 拒绝了这次请求。";
      }

      if (!finalText.trim() && result.stopReason === "cancelled") {
        finalText = "已取消当前 ACP Agent 执行。";
      }

      return finalText;
    } catch (error) {
      lastError = error;
      logger.warn(
        {
          err: error,
          uid,
          conversationId,
          agentId: conversation.acp_agent_id,
          attempt: attempt + 1,
        },
        "[ACP] Turn attempt failed"
      );
      disposeRuntime(uid, conversation.acp_agent_id);
    }
  }

  throw lastError || new Error("ACP Agent 执行失败");
}

export async function cancelAcpConversation(uid, conversation) {
  if (!conversation?.acp_agent_id || !conversation?.acp_session_id) {
    return { stopped: false };
  }

  const runtime = runtimeCache.get(getRuntimeKey(uid, conversation.acp_agent_id));
  if (!runtime) {
    return { stopped: false };
  }

  await runtime.cancel(conversation.acp_session_id);
  return { stopped: true };
}

export async function testAcpAgentConnection(uid, agentId) {
  const runtime = await getRuntime(uid, agentId);
  const agentInfo = runtime.agentInfo || {};
  return {
    success: true,
    agent_id: Number(agentId),
    protocol_version: runtime.protocolVersion || acp.PROTOCOL_VERSION,
    agent_info: agentInfo,
    capabilities: runtime.agentCapabilities || {},
  };
}

export async function getConversationAcpModels(uid, conversation) {
  if (!conversation?.acp_agent_id) {
    throw new Error("当前会话未绑定 ACP Agent");
  }

  const runtime = await getRuntime(uid, conversation.acp_agent_id);
  const sessionId = await runtime.ensureSession(conversation);
  const modelState = runtime.getSessionModelState(sessionId) || {};
  const agentConfig = getAcpAgent(conversation.acp_agent_id, uid, {
    includeSecrets: false,
  });

  return {
    session_id: sessionId,
    current_model_id: String(modelState.currentModelId || "").trim() || null,
    available_models: Array.isArray(modelState.availableModels)
      ? modelState.availableModels.map((model) => ({
          model_id: String(model?.modelId || "").trim(),
          name: String(model?.name || model?.modelId || "").trim(),
        }))
      : [],
    configured_model_id:
      String(conversation.acp_model_id || "").trim() ||
      String(agentConfig?.default_model_id || "").trim() ||
      null,
    agent_default_model_id:
      String(agentConfig?.default_model_id || "").trim() || null,
    agent_last_used_model_id:
      String(agentConfig?.last_used_model_id || "").trim() || null,
    supports_switching:
      typeof runtime.connection?.unstable_setSessionModel === "function",
  };
}

export async function setConversationAcpModel(uid, conversation, modelId) {
  if (!conversation?.acp_agent_id) {
    throw new Error("当前会话未绑定 ACP Agent");
  }

  const desiredModelId = String(modelId || "").trim();
  if (!desiredModelId) {
    throw new Error("缺少目标模型 ID");
  }

  const runtime = await getRuntime(uid, conversation.acp_agent_id);
  const sessionId = await runtime.ensureSession(conversation, [], {
    preferredModelId: desiredModelId,
  });
  await runtime.setSessionModel(sessionId, desiredModelId, { strict: true });
  updateConversationAcpModel(conversation.id, uid, desiredModelId);
  updateAcpAgentLastUsedModel(conversation.acp_agent_id, uid, desiredModelId);

  return getConversationAcpModels(
    uid,
    getConversation(conversation.id, uid) || {
      ...conversation,
      acp_model_id: desiredModelId,
    }
  );
}

export function shutdownAcpRuntimes() {
  for (const runtime of runtimeCache.values()) {
    runtime.dispose();
  }
  runtimeCache.clear();
}
