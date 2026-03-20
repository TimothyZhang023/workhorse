import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { getMcpServer, listMcpServers } from "./database.js";
import { getShellEnv, resolveExecutableCommand } from "../utils/shellEnv.js";

// Global map to hold connected MCP clients
// key: string (e.g. `uid_serverId`), value: { client: Client, transport: Transport }
const mcpClients = new Map();
// Track in-progress connect attempts to prevent races
const mcpConnecting = new Map();
const activeBuiltInShellProcesses = new Map();

export const BUILTIN_SHELL_SERVER_ID = "__builtin_shell__";
export const BUILTIN_SHELL_TOOL_NAME = "shell_execute";
const BUILTIN_SHELL_MAX_OUTPUT_CHARS = 24000;
const BUILTIN_SHELL_DEFAULT_TIMEOUT_MS = 20000;
const BUILTIN_SHELL_MAX_TIMEOUT_MS = 120000;

function getExecutionScopeKey(scope = {}) {
  const uid = String(scope?.uid || "").trim();
  const conversationId = String(scope?.conversationId || "").trim();
  if (!uid || !conversationId) {
    return "";
  }
  return `${uid}:${conversationId}`;
}

function terminateChildProcess(child) {
  if (!child || child.killed) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  setTimeout(() => {
    if (!child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }, 800).unref?.();
}

export function abortBuiltInShellExecutions(scope = {}) {
  const scopeKey = getExecutionScopeKey(scope);
  if (!scopeKey) return 0;
  const set = activeBuiltInShellProcesses.get(scopeKey);
  if (!set || set.size === 0) return 0;

  let killed = 0;
  for (const child of set) {
    terminateChildProcess(child);
    killed += 1;
  }
  activeBuiltInShellProcesses.delete(scopeKey);
  return killed;
}

function truncateShellOutput(
  value,
  maxLength = BUILTIN_SHELL_MAX_OUTPUT_CHARS
) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}\n...<output truncated>`;
}

function resolveShellWorkingDirectory(inputCwd) {
  const workspaceRoot =
    process.env.WORKHORSE_WORKSPACE_ROOT ||
    process.env.WORKHORSE_DATA_DIR ||
    path.join(os.homedir(), ".workhorse");
  const rawCwd = String(inputCwd || "").trim();

  if (!rawCwd) {
    return workspaceRoot;
  }

  const resolved = path.isAbsolute(rawCwd)
    ? path.normalize(rawCwd)
    : path.resolve(workspaceRoot, rawCwd);

  return resolved;
}

function getShellLaunchConfig(command) {
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand) {
    throw new Error("shell_execute 缺少 command");
  }

  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", normalizedCommand],
    };
  }

  const shell = getShellEnv().SHELL || process.env.SHELL || "/bin/zsh";
  return {
    command: shell,
    args: ["-lc", normalizedCommand],
  };
}

export function getBuiltInTools() {
  return [
    {
      type: "function",
      function: {
        name: BUILTIN_SHELL_TOOL_NAME,
        description:
          "执行本机 shell 命令。适用于查看文件、运行 git/node/npm/python 等命令、构建和调试当前工作目录中的项目。",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description:
                "要执行的 shell 命令，例如 `pwd`、`ls -la`、`git status`。",
            },
            cwd: {
              type: "string",
              description:
                "可选工作目录。相对路径将基于当前 workspace 解析；留空时默认使用当前 workspace。",
            },
            timeout_ms: {
              type: "integer",
              description: "可选超时时间，单位毫秒。默认 20000，最大 120000。",
              minimum: 1000,
              maximum: BUILTIN_SHELL_MAX_TIMEOUT_MS,
            },
          },
          required: ["command"],
          additionalProperties: false,
        },
      },
      _mcp_server_id: BUILTIN_SHELL_SERVER_ID,
    },
  ];
}

export async function executeBuiltInShellTool(args = {}, options = {}) {
  const commandText = String(args?.command || "").trim();
  if (!commandText) {
    throw new Error("shell_execute 缺少 command");
  }

  const cwd = resolveShellWorkingDirectory(args?.cwd);
  const requestedTimeout = Number(args?.timeout_ms);
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.max(
        1000,
        Math.min(BUILTIN_SHELL_MAX_TIMEOUT_MS, Math.round(requestedTimeout))
      )
    : BUILTIN_SHELL_DEFAULT_TIMEOUT_MS;
  const launch = getShellLaunchConfig(commandText);
  const abortSignal = options?.signal || null;
  const scopeKey = getExecutionScopeKey(options?.executionScope);

  const result = await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const child = spawn(launch.command, launch.args, {
      cwd,
      env: getShellEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finalizeScopeTracking = () => {
      if (!scopeKey) return;
      const scopeSet = activeBuiltInShellProcesses.get(scopeKey);
      if (!scopeSet) return;
      scopeSet.delete(child);
      if (scopeSet.size === 0) {
        activeBuiltInShellProcesses.delete(scopeKey);
      }
    };

    if (scopeKey) {
      if (!activeBuiltInShellProcesses.has(scopeKey)) {
        activeBuiltInShellProcesses.set(scopeKey, new Set());
      }
      activeBuiltInShellProcesses.get(scopeKey).add(child);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      terminateChildProcess(child);
    }, timeoutMs);

    const handleAbort = () => {
      aborted = true;
      terminateChildProcess(child);
    };
    if (abortSignal) {
      if (abortSignal.aborted) {
        handleAbort();
      } else {
        abortSignal.addEventListener("abort", handleAbort, { once: true });
      }
    }

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > BUILTIN_SHELL_MAX_OUTPUT_CHARS * 2) {
        stdout = stdout.slice(0, BUILTIN_SHELL_MAX_OUTPUT_CHARS * 2);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > BUILTIN_SHELL_MAX_OUTPUT_CHARS * 2) {
        stderr = stderr.slice(0, BUILTIN_SHELL_MAX_OUTPUT_CHARS * 2);
      }
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (abortSignal) {
        abortSignal.removeEventListener?.("abort", handleAbort);
      }
      finalizeScopeTracking();
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (abortSignal) {
        abortSignal.removeEventListener?.("abort", handleAbort);
      }
      finalizeScopeTracking();
      resolve({
        code: Number.isInteger(code) ? code : null,
        signal: signal || null,
        stdout,
        stderr,
        timedOut,
        aborted,
      });
    });
  });

  const sections = [
    `Command: ${commandText}`,
    `CWD: ${cwd}`,
    `Timeout(ms): ${timeoutMs}`,
    `Timed out: ${result.timedOut ? "yes" : "no"}`,
    `Aborted: ${result.aborted ? "yes" : "no"}`,
    `Exit code: ${result.code === null ? "null" : result.code}`,
  ];

  if (result.signal) {
    sections.push(`Signal: ${result.signal}`);
  }

  sections.push("STDOUT:");
  sections.push(truncateShellOutput(result.stdout || "(empty)"));
  sections.push("STDERR:");
  sections.push(truncateShellOutput(result.stderr || "(empty)"));

  return {
    content: [
      {
        type: "text",
        text: sections.join("\n"),
      },
    ],
    metadata: {
      command: commandText,
      cwd,
      timeout_ms: timeoutMs,
      timed_out: result.timedOut,
      aborted: result.aborted,
      exit_code: result.code,
      signal: result.signal,
      stdout: truncateShellOutput(result.stdout),
      stderr: truncateShellOutput(result.stderr),
    },
  };
}

/**
 * Ensures an MCP server is connected and returns the client instance.
 * @param {object} serverConfig - The MCP server configuration from database
 * @returns {Promise<Client>}
 */
export async function getConnectedMcpClient(serverConfig) {
  const clientKey = `${serverConfig.uid}_${serverConfig.id}`;

  if (mcpClients.has(clientKey)) {
    return mcpClients.get(clientKey).client;
  }

  // Deduplicate concurrent connect attempts
  if (mcpConnecting.has(clientKey)) {
    return mcpConnecting.get(clientKey);
  }

  // Initialize new connection
  const connectPromise = (async () => {
    const client = new Client(
      {
        name: `workhorse-client-${serverConfig.name}`,
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    let transport;

    try {
      if (serverConfig.type === "stdio") {
        let args = [];
        if (serverConfig.args) {
          args =
            typeof serverConfig.args === "string"
              ? JSON.parse(serverConfig.args)
              : serverConfig.args;
        }

        // Stdio doesn't natively support headers/auth in the same way as SSE,
        // but we can inject them as environment variables if needed.
        const env = { ...getShellEnv() };
        if (serverConfig.env) {
          Object.entries(serverConfig.env).forEach(([k, v]) => {
            env[k] = String(v ?? "");
          });
        }
        if (serverConfig.headers) {
          Object.entries(serverConfig.headers).forEach(([k, v]) => {
            env[k] = v;
          });
        }
        if (serverConfig.auth) {
          if (serverConfig.auth.type === "bearer") {
            env["AUTHORIZATION"] = `Bearer ${serverConfig.auth.token}`;
          } else if (serverConfig.auth.type === "basic") {
            const creds = Buffer.from(
              `${serverConfig.auth.username}:${serverConfig.auth.password}`
            ).toString("base64");
            env["AUTHORIZATION"] = `Basic ${creds}`;
          }
        }

        const resolvedCommand = resolveExecutableCommand(
          serverConfig.command,
          env
        );
        if (resolvedCommand !== serverConfig.command) {
          console.log(
            `[MCP] Resolved stdio command ${serverConfig.command} -> ${resolvedCommand}`
          );
        }

        transport = new StdioClientTransport({
          command: resolvedCommand,
          args: args,
          env: env,
        });
      } else if (serverConfig.type === "sse") {
        const url = new URL(serverConfig.url);
        const headers = { ...serverConfig.headers };

        if (serverConfig.auth) {
          if (serverConfig.auth.type === "bearer") {
            headers["Authorization"] = `Bearer ${serverConfig.auth.token}`;
          } else if (serverConfig.auth.type === "basic") {
            const creds = Buffer.from(
              `${serverConfig.auth.username}:${serverConfig.auth.password}`
            ).toString("base64");
            headers["Authorization"] = `Basic ${creds}`;
          }
        }

        transport = new SSEClientTransport(url, {
          eventSourceInit: {
            headers: headers,
          },
          requestInit: {
            headers: headers,
          },
        });
      } else {
        throw new Error(`Unsupported MCP transport type: ${serverConfig.type}`);
      }

      // Register the close handler BEFORE connecting, so we don't miss early disconnects
      transport.onclose = () => {
        console.log(`[MCP] Connection lost for ${serverConfig.name}`);
        mcpClients.delete(clientKey);
      };

      await client.connect(transport);
      mcpClients.set(clientKey, { client, transport });

      return client;
    } catch (error) {
      console.error(`[MCP] Failed to connect to ${serverConfig.name}:`, error);
      if (transport) {
        transport.close().catch(console.error);
      }
      throw error;
    } finally {
      mcpConnecting.delete(clientKey);
    }
  })();

  mcpConnecting.set(clientKey, connectPromise);
  return connectPromise;
}

/**
 * Fetch available tools from all enabled MCP servers for a given user.
 * It connects to any configured MCP server if not already connected.
 *
 * Returns an array of tools formatted according to OpenAI's tool schema:
 * {
 *   type: "function",
 *   function: { name: "", description: "", parameters: {...} }
 * }
 */
export async function getAllAvailableTools(uid) {
  const tools = [...getBuiltInTools()];
  const servers = listMcpServers(uid);
  const enabledServers = servers.filter((s) => s.is_enabled === 1);

  for (const serverConfig of enabledServers) {
    try {
      const client = await getConnectedMcpClient(serverConfig);
      const mcpToolsRes = await Promise.race([
        client.listTools(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout retrieving MCP tools")), 4000))
      ]);

      for (const t of mcpToolsRes.tools) {
        // Ensure the tool name avoids collisions or prefix it with the server ID if needed
        // For simplicity, we assume name uniqueness or user manages it.
        // We inject the server ID as a custom property so we know where to route it later.
        tools.push({
          type: "function",
          function: {
            name: t.name,
            description: t.description || "",
            parameters: t.inputSchema || { type: "object", properties: {} },
          },
          _mcp_server_id: serverConfig.id, // For internal routing
        });
      }
    } catch (e) {
      console.error(
        `[MCP] Skipping tools for ${serverConfig.name} due to error:`,
        e.message
      );
    }
  }

  return tools;
}

/**
 * Execute a specific tool on its associated MCP server.
 */
export async function executeMcpTool(
  uid,
  serverId,
  toolName,
  args,
  options = {}
) {
  if (
    serverId === BUILTIN_SHELL_SERVER_ID &&
    String(toolName || "") === BUILTIN_SHELL_TOOL_NAME
  ) {
    return executeBuiltInShellTool(args, options);
  }

  const servers = listMcpServers(uid);
  const serverConfig = servers.find((s) => s.id === serverId);

  if (!serverConfig) {
    throw new Error(`MCP Server ${serverId} not found or access denied.`);
  }

  const client = await getConnectedMcpClient(serverConfig);
  const result = await client.callTool({
    name: toolName,
    arguments: args,
  });

  return result;
}

/**
 * Force disconnects a specific server (e.g. when user changes settings)
 */
export async function disconnectMcpServer(uid, serverId) {
  const clientKey = `${uid}_${serverId}`;
  if (mcpClients.has(clientKey)) {
    const { transport } = mcpClients.get(clientKey);
    try {
      await transport.close();
    } catch (e) {
      /* ignore */
    }
    mcpClients.delete(clientKey);
  }
}

export async function testMcpServerConnection(
  uid,
  serverId,
  timeoutMs = 12000
) {
  const serverConfig = getMcpServer(serverId, uid);
  if (!serverConfig) {
    throw new Error(`MCP Server ${serverId} not found or access denied.`);
  }

  await disconnectMcpServer(uid, serverId);

  const runTest = async () => {
    const client = await getConnectedMcpClient(serverConfig);
    const toolsResponse = await client.listTools();
    const tools = Array.isArray(toolsResponse?.tools)
      ? toolsResponse.tools
      : [];

    return {
      success: true,
      server_id: Number(serverId),
      server_name: serverConfig.name,
      tool_count: tools.length,
      tool_names: tools.slice(0, 10).map((tool) => tool.name),
    };
  };

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error("测试连接超时，请检查命令、网络或认证配置"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([runTest(), timeoutPromise]);
  } catch (error) {
    await disconnectMcpServer(uid, serverId).catch(() => {});
    throw error;
  }
}
