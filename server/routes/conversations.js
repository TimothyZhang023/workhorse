import { Router } from "express";
import OpenAI from "openai";

import db, {
  addMessage,
  createConversation,
  deleteConversation,
  deleteLastAssistantMessage,
  getAppSetting,
  getConversation,
  getConversations,
  getMessages,
  getModels,
  listSkills,
  logUsage,
  updateConversationContextWindow,
  updateConversationSystemPrompt,
  updateConversationToolNames,
  updateConversationTitle,
  updateMessage,
} from "../models/database.js";
import {
  abortBuiltInShellExecutions,
  executeMcpTool,
  getAllAvailableTools,
} from "../models/mcpManager.js";
import { logger } from "../utils/logger.js";
import { buildTaskSystemPrompt } from "../utils/agentPromptBuilder.js";
import {
  findModelConfigForEndpoint,
  getEndpointCandidatesForModel,
  getOrderedEndpointGroups,
  mergeGenerationConfig,
  resolveModelCandidates,
} from "../utils/modelSelection.js";
import { getTaskConfig } from "../utils/systemConfig.js";

const router = Router();

const titleSummaryInFlight = new Set();
const activeConversationExecutions = new Map();
const GLOBAL_SYSTEM_PROMPT_MD_KEY = "global_system_prompt_markdown";
const DEFAULT_CONVERSATION_AGENT_PROMPT = `
你是 Workhorse 的对话 Agent。你不是普通聊天助手，而是一个会主动完成任务的执行代理。

规则：
1. 先理解用户目标，再决定是否需要工具。
2. 如果需要查看本地项目、执行 git/node/npm/pnpm/python/测试/构建/脚本命令，优先调用 shell_execute。
3. 只要还没完成任务，就继续调用工具、分析结果并推进，不要过早停下。
4. 只有在你确认任务已经完成、或者明确说明因缺少权限/信息而无法继续时，才输出最终答复。
5. 最终答复必须直接面向用户，清楚说明结果、依据和剩余阻塞项。
6. 不要把内部思考过程当作最终结论；如果需要工具，就直接调用。
`;

export function normalizeMessageForClient(message) {
  if (
    message?.role === "assistant" &&
    message?.content &&
    message.content.startsWith("[TOOL_CALLS]:")
  ) {
    try {
      return {
        ...message,
        content: "",
        tool_calls: JSON.parse(message.content.slice(13)),
      };
    } catch {
      return message;
    }
  }

  if (
    message?.role === "tool" &&
    message?.content &&
    message.content.startsWith("[TOOL_RESULT:")
  ) {
    const match = message.content.match(
      /^\[TOOL_RESULT:([^:]+):([^\]]+)\]:(.*)$/s
    );
    if (match) {
      return {
        ...message,
        content: match[3],
        tool_call_id: match[1],
        name: match[2],
      };
    }
  }

  return message;
}

// ============ 对话 CRUD ============

router.get("/", (req, res) => {
  try {
    res.json(getConversations(req.uid));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/", (req, res) => {
  try {
    const { title, tool_names, context_window, channel_id } = req.body;
    res.json(
      createConversation(
        req.uid,
        title,
        Array.isArray(tool_names) ? tool_names : null,
        { contextWindow: context_window, channelId: channel_id }
      )
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { title, system_prompt, tool_names, context_window } = req.body;
    if (title !== undefined) updateConversationTitle(id, req.uid, title);
    if (system_prompt !== undefined)
      updateConversationSystemPrompt(id, req.uid, system_prompt);
    if (context_window !== undefined) {
      updateConversationContextWindow(id, req.uid, context_window);
    }
    if (tool_names !== undefined) {
      updateConversationToolNames(
        id,
        req.uid,
        Array.isArray(tool_names) ? tool_names : null
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    deleteConversation(req.params.id, req.uid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id/messages", (req, res) => {
  try {
    res.json(
      getMessages(req.params.id, req.uid).map((message) =>
        normalizeMessageForClient(message)
      )
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ 工具函数 ============

/**
 * 构建 OpenAI messages 数组，支持文本和 base64 图片
 */
function buildMessages(history, systemPrompt) {
  const result = [];
  if (systemPrompt && systemPrompt.trim()) {
    result.push({ role: "system", content: systemPrompt.trim() });
  }
  for (const m of history) {
    if (
      m.role === "assistant" &&
      m.content &&
      m.content.startsWith("[TOOL_CALLS]:")
    ) {
      try {
        const toolCalls = JSON.parse(m.content.slice(13));
        result.push({
          role: "assistant",
          content: null,
          tool_calls: toolCalls,
        });
      } catch (e) {
        console.warn("Failed to parse tool calls from history", e);
      }
    } else if (
      m.role === "tool" &&
      m.content &&
      m.content.startsWith("[TOOL_RESULT:")
    ) {
      const match = m.content.match(/^\[TOOL_RESULT:([^:]+):([^\]]+)\]:(.*)$/s);
      if (match) {
        result.push({
          role: "tool",
          tool_call_id: match[1],
          name: match[2],
          content: match[3],
        });
      }
    } else if (m.role === "user" && m.content.includes("[IMAGE_DATA:")) {
      const parts = [];
      const imageRegex = /\[IMAGE_DATA:([^\]]+)\]/g;
      const textContent = m.content.replace(imageRegex, "").trim();
      if (textContent) parts.push({ type: "text", text: textContent });

      let match;
      const imageRegex2 = /\[IMAGE_DATA:([^\]]+)\]/g;
      while ((match = imageRegex2.exec(m.content)) !== null) {
        const base64Data = match[1];
        const mimeType = base64Data.startsWith("/9j/")
          ? "image/jpeg"
          : "image/png";
        parts.push({
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${base64Data}`,
            detail: "auto",
          },
        });
      }
      result.push({ role: "user", content: parts });
    } else {
      result.push({ role: m.role, content: m.content });
    }
  }
  return result;
}

export function buildConversationSystemPrompt(uid, conversation) {
  const enabledSkills = listSkills(uid).filter(
    (skill) => Number(skill.is_enabled) === 1
  );
  const globalPromptMarkdown = getAppSetting(
    uid,
    GLOBAL_SYSTEM_PROMPT_MD_KEY,
    process.env.GLOBAL_SYSTEM_PROMPT_MD || ""
  );

  return buildTaskSystemPrompt({
    taskSystemPrompt: [
      DEFAULT_CONVERSATION_AGENT_PROMPT.trim(),
      String(conversation?.system_prompt || "").trim(),
    ]
      .filter(Boolean)
      .join("\n\n"),
    taskSkills: enabledSkills,
    globalMarkdown: globalPromptMarkdown,
  });
}

/**
 * 获取带 Fallback 的 OpenAI client
 * 1. 优先使用默认 Endpoint
 * 2. 如果失败，自动切换到其他 Endpoint
 */
function getEndpoints(uid) {
  const groups = getOrderedEndpointGroups(uid);
  if (!groups.length) return [];
  return groups;
}

function buildFallbackTitleFromUserText(text, maxLength = 12) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "新对话";
  const sliced = normalized.slice(0, maxLength).trim();
  return normalized.length > maxLength ? `${sliced}...` : sliced;
}

function updateTitleIfUntitled(conversationId, uid, nextTitle) {
  const latest = getConversation(conversationId, uid);
  if (!latest) return false;
  const currentTitle = String(latest.title || "").trim();
  if (currentTitle && currentTitle !== "新对话") return false;
  const normalized = String(nextTitle || "").trim();
  if (!normalized) return false;
  updateConversationTitle(conversationId, uid, normalized);
  return true;
}

async function summarizeConversationTitle(uid, conversationId, preferredModel) {
  const taskKey = `${uid}:${conversationId}`;
  if (titleSummaryInFlight.has(taskKey)) return;
  titleSummaryInFlight.add(taskKey);

  try {
    const conversation = getConversation(conversationId, uid);
    if (!conversation) return;

    // 用户已手动命名时不覆盖
    if (
      conversation.title &&
      conversation.title.trim() &&
      conversation.title.trim() !== "新对话"
    ) {
      return;
    }

    const history = getMessages(conversationId, uid);
    const firstUser = history.find((m) => m.role === "user");
    const firstAssistant = history.find(
      (m) => m.role === "assistant" && m.content?.trim()
    );
    const fallbackTitle = firstUser
      ? buildFallbackTitleFromUserText(extractDisplayText(firstUser.content))
      : "";
    if (!firstUser || !firstAssistant) {
      if (fallbackTitle) {
        updateTitleIfUntitled(conversationId, uid, fallbackTitle);
      }
      return;
    }

    const userText = extractDisplayText(firstUser.content).slice(0, 400);
    const assistantText = extractDisplayText(firstAssistant.content).slice(
      0,
      500
    );
    const endpoints = getEndpoints(uid);
    if (!endpoints.length) {
      if (fallbackTitle) {
        updateTitleIfUntitled(conversationId, uid, fallbackTitle);
      }
      return;
    }

    let sawSummaryFailure = false;
    for (const ep of endpoints) {
      const endpointModels = getModels(ep.id, uid)
        .map((m) => String(m.model_id || "").trim())
        .filter(Boolean);
      const modelCandidates = [
        String(preferredModel || "").trim(),
        ...endpointModels,
        "gpt-4o-mini",
      ].filter(Boolean);
      const dedupedModels = [...new Set(modelCandidates)];
      const baseUrlCandidates = normalizeBaseUrlCandidates(ep.base_url);

      for (const baseURL of baseUrlCandidates) {
        for (const modelId of dedupedModels) {
          try {
            const client = new OpenAI({
              apiKey: ep.api_key,
              baseURL,
              timeout: 12000,
            });
            const completion = await client.chat.completions.create({
              model: modelId,
              temperature: 0.2,
              max_tokens: 40,
              messages: [
                {
                  role: "system",
                  content:
                    "你是标题生成助手。请将对话总结为简短中文标题，长度 8-20 字，不要加引号、句号和前缀。",
                },
                {
                  role: "user",
                  content: `用户问题：${userText}\n\n助手回答摘要：${assistantText}\n\n请输出标题：`,
                },
              ],
            });

            const rawTitle = completion.choices?.[0]?.message?.content || "";
            const normalized = rawTitle
              .replace(/["'“”‘’。！？!?.]/g, "")
              .trim()
              .slice(0, 28);
            if (!normalized) continue;

            if (updateTitleIfUntitled(conversationId, uid, normalized)) {
              return;
            }
            return;
          } catch (error) {
            sawSummaryFailure = true;
            const reason = getUpstreamErrorMessage(error);
            console.warn(
              `[Title Summary] Endpoint "${ep.name}" failed: baseURL=${baseURL}, model=${modelId}, reason=${reason}`
            );

            // 配额类错误直接回退，避免标题长期停留在“新对话”。
            if (fallbackTitle && isQuotaLikeSummaryError(reason)) {
              updateTitleIfUntitled(conversationId, uid, fallbackTitle);
              return;
            }
          }
        }
      }
    }

    if (fallbackTitle) {
      const applied = updateTitleIfUntitled(conversationId, uid, fallbackTitle);
      if (applied && sawSummaryFailure) {
        logger.warn(
          {
            route: "conversations.summarizeTitle",
            uid,
            conversationId,
            fallbackTitle,
          },
          "Title summary failed on all endpoints; applied fallback title"
        );
      }
    }
  } finally {
    titleSummaryInFlight.delete(taskKey);
  }
}

function extractDisplayText(content) {
  return (content || "").replace(/\[IMAGE_DATA:[^\]]+\]/g, "[图片]");
}

function normalizeGenerationConfig(input = {}) {
  const toNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const temperature = toNumber(input.temperature);
  const topP = toNumber(input.top_p);
  const maxTokens = toNumber(input.max_tokens);
  const presencePenalty = toNumber(input.presence_penalty);
  const frequencyPenalty = toNumber(input.frequency_penalty);
  const hasTemperature = temperature !== undefined;
  const hasTopP = topP !== undefined;
  const hasMaxTokens = maxTokens !== undefined;
  const hasPresencePenalty = presencePenalty !== undefined;
  const hasFrequencyPenalty = frequencyPenalty !== undefined;
  const shouldOmitMaxTokens = hasMaxTokens && maxTokens <= 0;

  return {
    // 中性默认值：temperature=0.7, top_p=1
    temperature: hasTemperature ? Math.min(2, Math.max(0, temperature)) : 0.7,
    top_p: hasTopP ? Math.min(1, Math.max(0, topP)) : 1,
    ...(hasPresencePenalty
      ? { presence_penalty: Math.min(2, Math.max(-2, presencePenalty)) }
      : {}),
    ...(hasFrequencyPenalty
      ? { frequency_penalty: Math.min(2, Math.max(-2, frequencyPenalty)) }
      : {}),
    ...(hasMaxTokens && !shouldOmitMaxTokens
      ? { max_tokens: Math.round(Math.min(8192, Math.max(64, maxTokens))) }
      : {}),
  };
}

export function resolveEndpointGenerationConfig(endpoint, generationConfig = {}) {
  const normalized = { ...(generationConfig || {}) };

  if (
    normalized.max_tokens === undefined &&
    String(endpoint?.provider || "").toLowerCase() === "openrouter"
  ) {
    normalized.max_tokens = 16384;
  }

  return normalized;
}

function getUpstreamErrorMessage(error) {
  const bodyMessage =
    error?.error?.message ||
    error?.response?.data?.error?.message ||
    error?.response?.data?.error ||
    error?.response?.error?.message ||
    error?.cause?.error?.message ||
    error?.cause?.message;

  const rawMessage = bodyMessage || error?.message || "上游服务请求失败";
  const status =
    error?.status || error?.response?.status || error?.cause?.status;

  return status ? `[${status}] ${rawMessage}` : rawMessage;
}

function isQuotaLikeSummaryError(reasonText) {
  const text = String(reasonText || "").toLowerCase();
  return (
    text.includes("no accounts available") ||
    text.includes("quota") ||
    text.includes("insufficient_quota") ||
    text.includes("token error")
  );
}

function normalizeBaseUrlCandidates(baseUrl) {
  const trimmed = String(baseUrl || "").replace(/\/+$/, "");
  const candidates = [trimmed];

  if (!trimmed.endsWith("/v1")) {
    candidates.push(`${trimmed}/v1`);
  }
  if (!trimmed.endsWith("/api/v1")) {
    candidates.push(`${trimmed}/api/v1`);
  }

  return [...new Set(candidates)];
}

function isUnsupportedStreamOptionsError(error) {
  const message = getUpstreamErrorMessage(error).toLowerCase();
  return (
    message.includes("stream_options") ||
    message.includes("unknown parameter") ||
    message.includes("unsupported") ||
    message.includes("include_usage")
  );
}

function isReasoningLikeType(value) {
  const t = String(value || "").toLowerCase();
  return /reason|think|analysis|thought/.test(t);
}

function collectTextFragments(value, depth = 0, mode = "any") {
  if (value === null || value === undefined || depth > 6) return [];
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextFragments(item, depth + 1, mode));
  }
  if (typeof value !== "object") return [];

  const obj = value;
  const objectType = String(
    obj.type || obj.delta_type || obj.content_type || ""
  ).toLowerCase();
  const objectIsReasoning = isReasoningLikeType(objectType);
  const reasoningOnlyKeys = [
    "reasoning",
    "reasoning_content",
    "thinking",
    "thinking_content",
  ];
  const directTextKeys = [
    "text",
    "content",
    "output_text",
    "refusal",
    "value",
    "delta",
  ];
  const nestedKeys = [
    "message",
    "parts",
    "content_block",
    "summary",
    "output",
    "result",
    "data",
  ];

  const fragments = [];

  if (mode === "answer" && objectIsReasoning) {
    for (const key of nestedKeys) {
      if (!(key in obj)) continue;
      fragments.push(...collectTextFragments(obj[key], depth + 1, mode));
    }
    return fragments;
  }

  if (mode === "reasoning" && objectType && !objectIsReasoning) {
    for (const key of reasoningOnlyKeys) {
      if (!(key in obj)) continue;
      fragments.push(...collectTextFragments(obj[key], depth + 1, mode));
    }
    for (const key of nestedKeys) {
      if (!(key in obj)) continue;
      fragments.push(...collectTextFragments(obj[key], depth + 1, mode));
    }
    return fragments;
  }

  const keysToRead =
    mode === "answer"
      ? directTextKeys
      : [...reasoningOnlyKeys, ...directTextKeys];
  for (const key of keysToRead) {
    if (!(key in obj)) continue;
    fragments.push(...collectTextFragments(obj[key], depth + 1, mode));
  }
  for (const key of nestedKeys) {
    if (!(key in obj)) continue;
    fragments.push(...collectTextFragments(obj[key], depth + 1, mode));
  }

  return fragments;
}

function collectUniqueText(candidates, mode = "any") {
  const seen = new Set();
  const parts = [];
  for (const candidate of candidates || []) {
    const text = collectTextFragments(candidate, 0, mode).join("");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    parts.push(text);
  }
  return parts.join("");
}

function extractStreamParts(choice, chunk) {
  const delta = choice?.delta || {};
  const reasoningLikeContent = (value) => {
    if (!value || typeof value === "string") return undefined;
    return value;
  };

  const answerText = collectUniqueText(
    [
      delta.content,
      delta.text,
      delta.output_text,
      delta.refusal,
      choice?.message?.content,
      choice?.message?.text,
      chunk?.content,
      chunk?.text,
      chunk?.output_text,
    ],
    "answer"
  );

  const reasoningText = collectUniqueText(
    [
      reasoningLikeContent(delta.content),
      delta.reasoning,
      delta.reasoning_content,
      delta.thinking,
      delta.thinking_content,
      reasoningLikeContent(choice?.message?.content),
      choice?.message?.reasoning,
      choice?.message?.reasoning_content,
      choice?.message?.thinking,
      choice?.message?.thinking_content,
      reasoningLikeContent(chunk?.content),
      chunk?.reasoning,
      chunk?.reasoning_content,
      chunk?.thinking,
      chunk?.thinking_content,
    ],
    "reasoning"
  );

  return { answerText, reasoningText };
}

function splitSseTextChunks(text, maxLength = 96) {
  const raw = String(text || "");
  if (!raw) return [];
  if (raw.length <= maxLength) return [raw];

  const parts = raw.match(/[^。！？!?；;\n]+[。！？!?；;\n]?|.+/g) || [raw];
  const chunks = [];
  let buffer = "";

  for (const part of parts) {
    if (!part) continue;
    if ((buffer + part).length <= maxLength) {
      buffer += part;
      continue;
    }
    if (buffer) chunks.push(buffer);
    if (part.length <= maxLength) {
      buffer = part;
      continue;
    }

    let start = 0;
    while (start < part.length) {
      const end = Math.min(start + maxLength, part.length);
      chunks.push(part.slice(start, end));
      start = end;
    }
    buffer = "";
  }

  if (buffer) chunks.push(buffer);
  return chunks;
}

function emitContentSse(res, content) {
  const chunks = splitSseTextChunks(content);
  for (const piece of chunks) {
    res.write(`data: ${JSON.stringify({ content: piece })}\n\n`);
  }
}

function initSse(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
  if (res.socket && typeof res.socket.setNoDelay === "function") {
    res.socket.setNoDelay(true);
  }
  // Keep stream warm to reduce first-chunk buffering on some proxies.
  res.write(":ok\n\n");
}

function finalizeSse(res) {
  if (res.writableEnded) return;
  res.write("data: [DONE]\n\n");
  res.end();
}

function serializeDebugValue(value, maxLength = 12000) {
  try {
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (serialized.length <= maxLength) {
      return serialized;
    }
    return `${serialized.slice(0, maxLength)}\n...<truncated>`;
  } catch (error) {
    return String(value);
  }
}

function emitDebugSse(res, enabled, payload = {}) {
  if (!enabled || res.writableEnded) {
    return;
  }

  res.write(
    `data: ${JSON.stringify({
      type: "debug",
      timestamp: new Date().toISOString(),
      ...payload,
    })}\n\n`
  );
}

function getConversationExecutionKey(uid, conversationId) {
  const normalizedUid = String(uid || "").trim();
  const normalizedConversationId = String(conversationId || "").trim();
  return `${normalizedUid}:${normalizedConversationId}`;
}

function createExecutionContext(uid, conversationId, res) {
  const key = getConversationExecutionKey(uid, conversationId);
  const existing = activeConversationExecutions.get(key);
  if (existing) {
    existing.abort("replaced");
    abortBuiltInShellExecutions({ uid, conversationId });
  }
  const controller = new AbortController();
  const context = {
    key,
    uid: String(uid || "").trim(),
    conversationId: String(conversationId || "").trim(),
    signal: controller.signal,
    abort: (reason = "stopped") => {
      context.abortReason = reason;
      if (!controller.signal.aborted) {
        controller.abort(reason);
      }
    },
    abortReason: "",
    res,
    createdAt: Date.now(),
  };
  activeConversationExecutions.set(key, context);
  return context;
}

function clearExecutionContext(uid, conversationId) {
  const key = getConversationExecutionKey(uid, conversationId);
  const current = activeConversationExecutions.get(key);
  if (!current) return;
  activeConversationExecutions.delete(key);
}

function isExecutionAborted(executionContext) {
  return Boolean(executionContext?.signal?.aborted);
}

async function requestForcedFinalChatResponse({
  client,
  modelId,
  messages,
  endpointGenerationConfig,
}) {
  const completion = await client.chat.completions.create({
    model: modelId,
    messages: [
      ...messages,
      {
        role: "user",
        content:
          "请停止继续调用工具，基于现有上下文和工具结果直接给出最终答复。格式：结果、依据、未完成项（如无写“无”）。",
      },
    ],
    ...mergeGenerationConfig(endpointGenerationConfig, { max_tokens: 2048 }),
  });

  return String(completion.choices?.[0]?.message?.content || "").trim();
}

async function streamWithFallback(uid, model, messages, res, opts = {}) {
  const endpoints = getEndpoints(uid);
  const modelCandidates = resolveModelCandidates(uid, model);
  const debugEnabled = Boolean(opts.debug);
  const executionContext = opts.executionContext || null;
  const taskConfig = getTaskConfig(uid);
  const requestLog = logger.child({
    route: "conversations.stream",
    uid,
    conversationId: opts.conversationId,
    source: opts.source || "chat",
    requestedModel: model,
    modelCandidates,
  });
  const persistAssistantFailure = (aiMsgId, fallbackText) => {
    if (!aiMsgId) return;
    try {
      updateMessage(aiMsgId, uid, fallbackText);
    } catch (error) {
      requestLog.warn(
        { err: error, aiMsgId },
        "Failed to persist assistant fallback content"
      );
    }
  };

  requestLog.info(
    {
      endpointCount: endpoints.length,
      messageCount: messages.length,
      generationConfig: opts.generationConfig || {},
    },
    "Starting upstream stream request"
  );
  emitDebugSse(res, debugEnabled, {
    phase: "request_init",
    requested_model: model || "",
    model_candidates: modelCandidates,
    conversation_context_window: opts.conversationContextWindow ?? null,
    endpoint_candidates: endpoints.map((endpoint) => ({
      id: endpoint.id,
      name: endpoint.name,
      base_url: endpoint.base_url,
      provider: endpoint.provider,
    })),
    generation_config: opts.generationConfig || {},
    request_messages: messages,
  });

  if (!endpoints.length) {
    const fallbackText = "⚠️ 未配置可用 API Endpoint，请先到设置里配置。";
    persistAssistantFailure(opts.aiMsgId, fallbackText);
    requestLog.warn("No API endpoints configured");
    res.write(
      `data: ${JSON.stringify({ error: "请先在设置中配置 API Endpoint" })}\n\n`
    );
    return false;
  }
  if (!modelCandidates.length) {
    const fallbackText = "⚠️ 当前没有可用模型，请先在端点管理中启用模型。";
    persistAssistantFailure(opts.aiMsgId, fallbackText);
    requestLog.warn("No enabled models configured");
    res.write(
      `data: ${JSON.stringify({ error: "请先在端点管理中启用至少一个模型" })}\n\n`
    );
    return false;
  }

  // Get tools from MCP
  const allTools = await getAllAvailableTools(uid).catch((e) => {
    console.error("Failed to get MCP tools: ", e);
    return [];
  });
  const allowedToolNames = Array.isArray(opts.allowedToolNames)
    ? new Set(
        opts.allowedToolNames.map((item) => String(item || "").trim()).filter(Boolean)
      )
    : null;
  const filteredTools = allowedToolNames
    ? allTools.filter((tool) => allowedToolNames.has(tool.function.name))
    : allTools;
  // Strip internal _mcp_server_id field before sending to OpenAI
  const requestTools =
    filteredTools.length > 0
      ? filteredTools.map(({ _mcp_server_id, ...t }) => t)
      : undefined;

  let maxToolLoops = Number(taskConfig?.max_tool_loops) || 100;
  let currentLoop = 0;

  async function executeTurn(currentMessages, currentAiMsgId) {
    if (isExecutionAborted(executionContext)) {
      return false;
    }
    if (currentLoop >= maxToolLoops) {
      res.write(
        `data: ${JSON.stringify({
          notice: "工具调用次数达到上限，正在基于现有结果生成最终答复",
        })}\n\n`
      );
      return "_FORCE_FINAL_RESPONSE_";
    }
    currentLoop++;

    let lastError = null;
    for (const modelId of modelCandidates) {
      if (isExecutionAborted(executionContext)) {
        return false;
      }
      for (const ep of getEndpointCandidatesForModel(uid, modelId)) {
        if (isExecutionAborted(executionContext)) {
          return false;
        }
        const baseUrlCandidates = normalizeBaseUrlCandidates(ep.base_url);
        for (const baseURL of baseUrlCandidates) {
          if (isExecutionAborted(executionContext)) {
            return false;
          }
          let triedWithoutStreamOptions = false;
          try {
            const client = new OpenAI({ apiKey: ep.api_key, baseURL });
            const endpointModelConfig =
              findModelConfigForEndpoint(ep.id, uid, modelId)
                ?.generation_config || {};
            const endpointGenerationConfig = resolveEndpointGenerationConfig(
              ep,
              mergeGenerationConfig(
                endpointModelConfig,
                opts.generationConfig || {}
              )
            );
            const baseParams = {
              model: modelId,
              messages: currentMessages,
              stream: true,
              tools: requestTools,
              ...endpointGenerationConfig,
            };
            emitDebugSse(res, debugEnabled, {
              phase: "attempt_start",
              model_id: modelId,
              endpoint: {
                id: ep.id,
                name: ep.name,
                provider: ep.provider,
                base_url: baseURL,
              },
              request: {
                messages: currentMessages,
                tools: requestTools,
                generation_config: endpointGenerationConfig,
              },
            });

            let stream;
            try {
              stream = await client.chat.completions.create({
                ...baseParams,
                stream_options: { include_usage: true },
              });
            } catch (error) {
              if (!isUnsupportedStreamOptionsError(error)) {
                throw error;
              }
              triedWithoutStreamOptions = true;
              requestLog.warn(
                {
                  modelId,
                  endpointName: ep.name,
                  baseURL,
                  reason: getUpstreamErrorMessage(error),
                },
                "Upstream rejected stream_options, retrying without it"
              );
              emitDebugSse(res, debugEnabled, {
                phase: "stream_options_retry",
                model_id: modelId,
                endpoint_name: ep.name,
                base_url: baseURL,
                error: getUpstreamErrorMessage(error),
              });
              stream = await client.chat.completions.create(baseParams);
            }

            requestLog.info(
              {
                modelId,
                endpointName: ep.name,
                baseURL,
                messageCount: currentMessages.length,
                hasTools: !!requestTools?.length,
                retriedWithoutStreamOptions: triedWithoutStreamOptions,
                generationConfig: endpointGenerationConfig,
              },
              "Upstream stream connected"
            );
            emitDebugSse(res, debugEnabled, {
              phase: "stream_connected",
              model_id: modelId,
              endpoint_name: ep.name,
              base_url: baseURL,
              retried_without_stream_options: triedWithoutStreamOptions,
            });

            let fullTextContent = "";
            let toolCalls = [];
            let promptTokens = 0;
            let completionTokens = 0;
            let chunkCount = 0;
            let emptyTextChunkCount = 0;
            let firstContentAt = null;
            let lastFinishReason = null;
            let reasoningOpen = false;
            const observedDeltaKeys = new Set();

            for await (const chunk of stream) {
              if (isExecutionAborted(executionContext) || res.writableEnded) {
                throw new Error("Execution aborted");
              }
            chunkCount++;
            const choice = chunk.choices?.[0] || {};
            const delta = choice.delta || {};
            for (const key of Object.keys(delta)) {
              observedDeltaKeys.add(key);
            }
            lastFinishReason = choice.finish_reason || lastFinishReason;

            if (chunk?.error?.message) {
              throw new Error(chunk.error.message);
            }
            emitDebugSse(res, debugEnabled, {
              phase: "upstream_chunk",
              model_id: modelId,
              endpoint_name: ep.name,
              base_url: baseURL,
              chunk: serializeDebugValue(chunk),
            });

            const { answerText, reasoningText } = extractStreamParts(
              choice,
              chunk
            );
            let emittedText = "";
            if (reasoningText) {
              if (!reasoningOpen) {
                emittedText += "<think>\n";
                reasoningOpen = true;
              }
              emittedText += reasoningText;
            }
            if (answerText) {
              if (reasoningOpen) {
                emittedText += "\n</think>\n\n";
                reasoningOpen = false;
              }
              emittedText += answerText;
            }

            if (emittedText) {
              if (!firstContentAt) {
                firstContentAt = Date.now();
                requestLog.info(
                  {
                    endpointName: ep.name,
                    baseURL,
                    chunkCount,
                  },
                  "Received first upstream content chunk"
                );
              }
              fullTextContent += emittedText;
              emitContentSse(res, emittedText);
            } else {
              emptyTextChunkCount++;
            }

            if (delta.tool_calls) {
              const toolCallDeltas = Array.isArray(delta.tool_calls)
                ? delta.tool_calls
                : [delta.tool_calls];
              for (const tcDelta of toolCallDeltas) {
                if (!tcDelta) continue;
                const idx =
                  Number.isInteger(tcDelta.index) && Number(tcDelta.index) >= 0
                    ? Number(tcDelta.index)
                    : toolCalls.length;
                if (!toolCalls[idx]) {
                  toolCalls[idx] = {
                    id: tcDelta.id,
                    type: "function",
                    function: {
                      name: tcDelta.function?.name || "",
                      arguments: "",
                    },
                  };
                }
                if (tcDelta.function?.arguments) {
                  toolCalls[idx].function.arguments +=
                    tcDelta.function.arguments;
                }
              }
            }

            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens || 0;
              completionTokens = chunk.usage.completion_tokens || 0;
            }
          }

            if (reasoningOpen) {
              const closeThinkingTag = "\n</think>\n";
              fullTextContent += closeThinkingTag;
              emitContentSse(res, closeThinkingTag);
            }

            requestLog.info(
              {
                modelId,
                endpointName: ep.name,
                baseURL,
                chunkCount,
                contentLength: fullTextContent.length,
                emptyTextChunkCount,
                toolCallCount: toolCalls.filter(Boolean).length,
                promptTokens,
                completionTokens,
                lastFinishReason,
                observedDeltaKeys: [...observedDeltaKeys],
              },
              "Upstream stream completed"
            );
            emitDebugSse(res, debugEnabled, {
              phase: "stream_completed",
              model_id: modelId,
              endpoint_name: ep.name,
              base_url: baseURL,
              chunk_count: chunkCount,
              content_length: fullTextContent.length,
              tool_call_count: toolCalls.filter(Boolean).length,
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              finish_reason: lastFinishReason,
            });

            try {
              if (promptTokens > 0) {
                logUsage({
                  uid,
                  conversationId: opts.conversationId,
                  model: modelId,
                  endpointName: ep.name,
                  promptTokens,
                  completionTokens,
                  source: opts.source || "chat",
                });
              }
            } catch (logErr) {
              requestLog.warn(
                { err: logErr, modelId, endpointName: ep.name, baseURL },
                "Failed to log usage"
              );
            }

            const finalToolCalls = toolCalls.filter(Boolean);

            // CASE 1: No tools
            if (finalToolCalls.length === 0) {
              if (!fullTextContent.trim()) {
                const requestedMaxTokens =
                  opts?.generationConfig?.max_tokens ?? "未设置";
                const reasonText =
                  lastFinishReason === "length"
                    ? `上游返回空内容（finish_reason: length，max_tokens: ${requestedMaxTokens}）。请调大 max_tokens 后重试。`
                    : lastFinishReason
                    ? `上游返回空内容（finish_reason: ${lastFinishReason}）`
                    : "上游返回空内容（未携带 finish_reason）";
                persistAssistantFailure(currentAiMsgId, `⚠️ ${reasonText}`);
                requestLog.warn(
                  {
                    endpointName: ep.name,
                    baseURL,
                    lastFinishReason,
                    requestedMaxTokens,
                  },
                  "Upstream completed without content"
                );
                res.write(`data: ${JSON.stringify({ error: reasonText })}\n\n`);
                return false;
              }
              return fullTextContent;
            }

            // CASE 2: Tool calls
            const toolCallsMsgStr = `[TOOL_CALLS]:${JSON.stringify(
              finalToolCalls
            )}`;
            updateMessage(currentAiMsgId, uid, toolCallsMsgStr);

            currentMessages.push({
              role: "assistant",
              content: null,
              tool_calls: finalToolCalls,
            });

            // Execute Tools
            for (const tc of finalToolCalls) {
              if (isExecutionAborted(executionContext)) {
                return false;
              }
              try {
                const funcName = tc.function.name;
                const funcArgsDecoded = JSON.parse(tc.function.arguments || "{}");

                res.write(
                  `data: ${JSON.stringify({
                    type: "tool_running",
                    tool_name: funcName,
                  })}\n\n`
                );
                emitDebugSse(res, debugEnabled, {
                  phase: "tool_running",
                  tool_name: funcName,
                  tool_arguments: funcArgsDecoded,
                });

                let resultContent = "";
                const toolDef = filteredTools.find(
                  (t) => t.function.name === funcName
                );
                if (toolDef && toolDef._mcp_server_id) {
                  const mcpRes = await executeMcpTool(
                    uid,
                    toolDef._mcp_server_id,
                    funcName,
                    funcArgsDecoded,
                    {
                      signal: executionContext?.signal,
                      executionScope: {
                        uid,
                        conversationId: opts.conversationId,
                      },
                    }
                  );
                  if (isExecutionAborted(executionContext)) {
                    return false;
                  }
                  resultContent = (mcpRes.content || [])
                    .map((c) => c.text)
                    .join("\n");
                } else {
                  resultContent = `Unknown tool: ${funcName}`;
                }

                const toolResultStr = `[TOOL_RESULT:${tc.id}:${funcName}]:${resultContent}`;
                addMessage(opts.conversationId, uid, "tool", toolResultStr);
                emitDebugSse(res, debugEnabled, {
                  phase: "tool_result",
                  tool_name: funcName,
                  tool_call_id: tc.id,
                  result: serializeDebugValue(resultContent),
                });

                currentMessages.push({
                  role: "tool",
                  tool_call_id: tc.id,
                  name: funcName,
                  content: resultContent,
                });
              } catch (err) {
                requestLog.error(
                  {
                    err,
                    endpointName: ep.name,
                    baseURL,
                    toolName: tc.function.name,
                  },
                  "Tool execution failed"
                );
                const errStr = `[TOOL_RESULT:${tc.id}:${tc.function.name}]:Error - ${err.message}`;
                addMessage(opts.conversationId, uid, "tool", errStr);
                emitDebugSse(res, debugEnabled, {
                  phase: "tool_error",
                  tool_name: tc.function.name,
                  tool_call_id: tc.id,
                  error: err.message,
                });
                currentMessages.push({
                  role: "tool",
                  tool_call_id: tc.id,
                  name: tc.function.name,
                  content: err.message,
                });
              }
            }

            // Loop next response
            const nextAiMsg = addMessage(
              opts.conversationId,
              uid,
              "assistant",
              ""
            );
            const nextContent = await executeTurn(currentMessages, nextAiMsg.id);

            if (nextContent === "_FORCE_FINAL_RESPONSE_") {
              const forcedFinalText = await requestForcedFinalChatResponse({
                client,
                modelId,
                messages: currentMessages,
                endpointGenerationConfig,
              });
              if (!forcedFinalText) {
                persistAssistantFailure(
                  nextAiMsg.id,
                  "⚠️ 工具调用达到上限，但未能整理出最终答复。"
                );
                return false;
              }
              updateMessage(nextAiMsg.id, uid, forcedFinalText);
              emitContentSse(res, forcedFinalText);
              return "_HANDLED_INTERNALLY_";
            }
            if (nextContent === false) {
              persistAssistantFailure(
                nextAiMsg.id,
                "⚠️ 回复中断或上游无有效内容，请点击重新生成。"
              );
              return false;
            }
            if (nextContent !== "_HANDLED_INTERNALLY_") {
              updateMessage(nextAiMsg.id, uid, nextContent);
            }

            return "_HANDLED_INTERNALLY_";
          } catch (error) {
            if (isExecutionAborted(executionContext)) {
              return false;
            }
            lastError = error;
            requestLog.warn(
              {
                modelId,
                endpointName: ep.name,
                baseURL,
                error: getUpstreamErrorMessage(error),
              },
              "Upstream endpoint attempt failed"
            );
            emitDebugSse(res, debugEnabled, {
              phase: "attempt_failed",
              model_id: modelId,
              endpoint_name: ep.name,
              base_url: baseURL,
              error: getUpstreamErrorMessage(error),
            });
          }
        }
      }

      res.write(
        `data: ${JSON.stringify({
          notice: `模型 ${modelId} 不可用，尝试备用模型中...`,
        })}\n\n`
      );
      if (isExecutionAborted(executionContext)) {
        return false;
      }
      emitDebugSse(res, debugEnabled, {
        phase: "model_fallback",
        model_id: modelId,
        notice: `模型 ${modelId} 不可用，尝试备用模型中...`,
      });
    }

    if (isExecutionAborted(executionContext)) {
      return false;
    }

    res.write(
      `data: ${JSON.stringify({
        error: `所有 API 端点均不可用：${getUpstreamErrorMessage(lastError)}`,
      })}\n\n`
    );
    emitDebugSse(res, debugEnabled, {
      phase: "all_attempts_failed",
      error: getUpstreamErrorMessage(lastError),
    });
    persistAssistantFailure(
      opts.aiMsgId,
      `❌ 错误：所有 API 端点均不可用：${getUpstreamErrorMessage(lastError)}`
    );
    return false;
  }

  return await executeTurn(messages, opts.aiMsgId);
}

function createBufferedSseResponse() {
  const events = [];

  return {
    writableEnded: false,
    headers: {},
    socket: {
      setNoDelay() {},
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
    flushHeaders() {},
    write(chunk) {
      const text = String(chunk || "");
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          events.push(JSON.parse(payload));
        } catch {
          // ignore non-json SSE fragments
        }
      }
      return true;
    },
    end() {
      this.writableEnded = true;
    },
    getEvents() {
      return events;
    },
  };
}

export async function runConversationMessage({
  uid,
  conversationId,
  message,
  model,
  images,
  debug = false,
  generationConfig = {},
  source = "channel",
  allowedToolNames = null,
}) {
  const bufferedRes = createBufferedSseResponse();
  const executionContext = createExecutionContext(uid, conversationId, bufferedRes);
  initSse(bufferedRes);

  try {
    const conversation = getConversation(conversationId, uid);
    if (!conversation) {
      throw new Error("对话不存在或无权限");
    }

    const existingHistory = getMessages(conversationId, uid);
    const shouldSummarizeTitle =
      !existingHistory.some((item) => item.role === "user");

    let storedContent = String(message || "");
    if (Array.isArray(images) && images.length > 0) {
      storedContent +=
        "\n" + images.map((img) => `[IMAGE_DATA:${img}]`).join("\n");
    }
    addMessage(conversationId, uid, "user", storedContent);

    const history = getMessages(conversationId, uid);
    const systemPrompt = buildConversationSystemPrompt(uid, conversation);
    const messages = buildMessages(history, systemPrompt);
    const aiMsg = addMessage(conversationId, uid, "assistant", "");

    const fullContent = await streamWithFallback(
      uid,
      String(model || "").trim(),
      messages,
      bufferedRes,
      {
        conversationId,
        source,
        aiMsgId: aiMsg.id,
        debug,
        generationConfig,
        conversationContextWindow: conversation?.context_window ?? null,
        allowedToolNames:
          Array.isArray(allowedToolNames) && allowedToolNames.length > 0
            ? allowedToolNames
            : conversation?.tool_names ?? null,
        executionContext,
      }
    );

    if (fullContent === false) {
      const events = bufferedRes.getEvents();
      const latestError = [...events]
        .reverse()
        .find((event) => event?.error || event?.notice);
      throw new Error(latestError?.error || latestError?.notice || "Agent 执行失败");
    }

    if (fullContent !== "_HANDLED_INTERNALLY_") {
      updateMessage(aiMsg.id, uid, fullContent);
    }

    if (shouldSummarizeTitle) {
      summarizeConversationTitle(uid, conversationId, model).catch(() => {});
    }

    const finalAssistantMessage = getMessages(conversationId, uid).find(
      (item) => Number(item.id) === Number(aiMsg.id)
    );

    finalizeSse(bufferedRes);
    return {
      conversationId: String(conversationId),
      assistantMessageId: aiMsg.id,
      finalResponse: String(finalAssistantMessage?.content || fullContent || "").trim(),
      events: bufferedRes.getEvents(),
    };
  } finally {
    clearExecutionContext(uid, conversationId);
  }
}

// ============ 流式聊天 ============

router.post("/:id/chat", async (req, res) => {
  const { id } = req.params;
  const { message, model, images } = req.body;
  const uid = req.uid;
  const debug = Boolean(req.body?.debug);
  const generationConfig = normalizeGenerationConfig(req.body);
  const requestedModel = String(model || "").trim();
  const executionContext = createExecutionContext(uid, id, res);

  initSse(res);

  try {
    logger.info(
      {
        route: "conversations.chat",
        uid,
        conversationId: id,
        requestedModel,
        imageCount: Array.isArray(images) ? images.length : 0,
        generationConfig,
      },
      "Incoming chat request"
    );
    // 获取对话（含 system_prompt）
    const conversation = getConversation(id, uid);
    if (!conversation) {
      res.write(`data: ${JSON.stringify({ error: "对话不存在或无权限" })}\n\n`);
      res.end();
      return;
    }

    // 构建存储内容（图片用标记内嵌存储）
    let storedContent = message;
    if (images && images.length > 0) {
      storedContent +=
        "\n" + images.map((img) => `[IMAGE_DATA:${img}]`).join("\n");
    }
    addMessage(id, uid, "user", storedContent);

    const history = getMessages(id, uid);
    const systemPrompt = buildConversationSystemPrompt(uid, conversation);
    const messages = buildMessages(history, systemPrompt);

    const aiMsg = addMessage(id, uid, "assistant", "");

    const fullContent = await streamWithFallback(
      uid,
      requestedModel,
      messages,
      res,
      {
        conversationId: id,
        source: "chat",
        aiMsgId: aiMsg.id,
        debug,
        generationConfig,
        conversationContextWindow: conversation?.context_window ?? null,
        allowedToolNames: conversation?.tool_names ?? null,
        executionContext,
      }
    );

    if (fullContent === false) {
      finalizeSse(res);
      return;
    } else if (fullContent !== "_HANDLED_INTERNALLY_") {
      updateMessage(aiMsg.id, uid, fullContent);
    }

    finalizeSse(res);
  } catch (error) {
    logger.error(
      { err: error, route: "conversations.chat", uid, conversationId: id },
      "Chat request failed before stream completion"
    );
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      finalizeSse(res);
    }
  } finally {
    clearExecutionContext(uid, id);
  }
});

router.post("/:id/stop", (req, res) => {
  const { id } = req.params;
  const uid = req.uid;
  const key = getConversationExecutionKey(uid, id);
  const execution = activeConversationExecutions.get(key);

  if (!execution) {
    return res.json({ success: true, stopped: false, message: "当前无运行中的会话" });
  }

  execution.abort("manual_stop");
  const killedCommands = abortBuiltInShellExecutions({
    uid,
    conversationId: id,
  });

  if (execution.res && !execution.res.writableEnded) {
    execution.res.write(
      `data: ${JSON.stringify({
        notice: "会话已被手动终止",
      })}\n\n`
    );
    finalizeSse(execution.res);
  }

  clearExecutionContext(uid, id);
  return res.json({ success: true, stopped: true, killed_commands: killedCommands });
});

// 异步标题总结（不阻塞聊天）
router.post("/:id/summarize-title", (req, res) => {
  const { id } = req.params;
  const { model } = req.body || {};
  const uid = req.uid;

  const conversation = getConversation(id, uid);
  if (!conversation) {
    return res.status(404).json({ error: "对话不存在或无权限" });
  }

  summarizeConversationTitle(uid, id, model).catch((error) => {
    logger.warn(
      {
        route: "conversations.summarizeTitle",
        uid,
        conversationId: id,
        error: getUpstreamErrorMessage(error),
      },
      "Title summary failed"
    );
  });

  res.status(202).json({ queued: true });
});

// ============ 重新生成 ============

router.post("/:id/regenerate", async (req, res) => {
  const { id } = req.params;
  const { model } = req.body;
  const uid = req.uid;
  const debug = Boolean(req.body?.debug);
  const generationConfig = normalizeGenerationConfig(req.body);
  const requestedModel = String(model || "").trim();
  const executionContext = createExecutionContext(uid, id, res);

  initSse(res);

  try {
    logger.info(
      {
        route: "conversations.regenerate",
        uid,
        conversationId: id,
        requestedModel,
        generationConfig,
      },
      "Incoming regenerate request"
    );
    const deleted = deleteLastAssistantMessage(id, uid);
    if (!deleted) {
      res.write(
        `data: ${JSON.stringify({ error: "没有可重新生成的 AI 消息" })}\n\n`
      );
      res.end();
      return;
    }

    const history = getMessages(id, uid);
    if (!history.length) {
      res.write(
        `data: ${JSON.stringify({ error: "没有可重新生成的消息" })}\n\n`
      );
      res.end();
      return;
    }

    const conversation = getConversation(id, uid);
    const systemPrompt = buildConversationSystemPrompt(uid, conversation);
    const messages = buildMessages(history, systemPrompt);
    const aiMsg = addMessage(id, uid, "assistant", "");

    const fullContent = await streamWithFallback(
      uid,
      requestedModel,
      messages,
      res,
      {
        conversationId: id,
        source: "chat",
        aiMsgId: aiMsg.id,
        debug,
        generationConfig,
        conversationContextWindow: conversation?.context_window ?? null,
        allowedToolNames: conversation?.tool_names ?? null,
        executionContext,
      }
    );

    if (fullContent === false) {
      finalizeSse(res);
      return;
    } else if (fullContent !== "_HANDLED_INTERNALLY_") {
      updateMessage(aiMsg.id, uid, fullContent);
    }

    finalizeSse(res);
  } catch (error) {
    logger.error(
      {
        err: error,
        route: "conversations.regenerate",
        uid,
        conversationId: id,
      },
      "Regenerate request failed before stream completion"
    );
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      finalizeSse(res);
    }
  } finally {
    clearExecutionContext(uid, id);
  }
});

// ============ 编辑消息并重新生成 ============

router.put("/:id/messages/:msgId", async (req, res) => {
  const { id, msgId } = req.params;
  const { content, model } = req.body;
  const uid = req.uid;
  const debug = Boolean(req.body?.debug);
  const generationConfig = normalizeGenerationConfig(req.body);
  const requestedModel = String(model || "").trim();
  const executionContext = createExecutionContext(uid, id, res);

  initSse(res);

  try {
    logger.info(
      {
        route: "conversations.editMessage",
        uid,
        conversationId: id,
        messageId: msgId,
        requestedModel,
        generationConfig,
      },
      "Incoming edit-and-regenerate request"
    );
    const conversation = getConversation(id, uid);
    if (!conversation) {
      res.write(`data: ${JSON.stringify({ error: "对话不存在或无权限" })}\n\n`);
      res.end();
      return;
    }

    const m = db
      .prepare(
        "SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND uid = ?"
      )
      .get(msgId, id, uid);
    if (!m) {
      res.write(`data: ${JSON.stringify({ error: "消息不存在" })}\n\n`);
      res.end();
      return;
    }

    // 截断该消息之后的所有消息
    db.prepare(
      "DELETE FROM messages WHERE conversation_id = ? AND uid = ? AND id > ?"
    ).run(id, uid, msgId);

    // 更新当前消息的内容
    updateMessage(msgId, uid, content);

    // 重新获取历史并生成
    const history = getMessages(id, uid);
    const systemPrompt = buildConversationSystemPrompt(uid, conversation);
    const messages = buildMessages(history, systemPrompt);
    const aiMsg = addMessage(id, uid, "assistant", "");

    const fullContent = await streamWithFallback(
      uid,
      requestedModel,
      messages,
      res,
      {
        conversationId: id,
        source: "chat",
        aiMsgId: aiMsg.id,
        debug,
        generationConfig,
        conversationContextWindow: conversation?.context_window ?? null,
        allowedToolNames: conversation?.tool_names ?? null,
        executionContext,
      }
    );

    if (fullContent === false) {
      finalizeSse(res);
      return;
    } else if (fullContent !== "_HANDLED_INTERNALLY_") {
      updateMessage(aiMsg.id, uid, fullContent);
    }

    finalizeSse(res);
  } catch (error) {
    logger.error(
      {
        err: error,
        route: "conversations.editMessage",
        uid,
        conversationId: id,
        messageId: msgId,
      },
      "Edit-and-regenerate request failed before stream completion"
    );
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      finalizeSse(res);
    }
  } finally {
    clearExecutionContext(uid, id);
  }
});

export default router;
