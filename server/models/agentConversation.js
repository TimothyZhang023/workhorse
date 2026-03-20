import {
  addMessage,
  getConversation,
  getMessages,
  logUsage,
  updateMessage,
} from "./database.js";
import { abortBuiltInShellExecutions } from "./mcpManager.js";
import {
  executeAgentToolCall,
  requestAgentTurnWithFallback,
  requestForcedFinalAgentResponse,
} from "./agentExecutionCore.js";
import {
  buildAgentSystemPrompt,
  prepareAgentTooling,
} from "./agentRuntimeConfig.js";
import { logger } from "../utils/logger.js";
import {
  findModelConfigForEndpoint,
  getOrderedEndpointGroups,
  mergeGenerationConfig,
  resolveModelCandidates,
} from "../utils/modelSelection.js";
import { getTaskConfig } from "../utils/systemConfig.js";
import { getConversationAgentPrompt } from "../utils/workspaceAgentConfig.js";

const activeConversationExecutions = new Map();
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

export function buildConversationMessages(history, systemPrompt) {
  const result = [];
  if (systemPrompt && systemPrompt.trim()) {
    result.push({ role: "system", content: systemPrompt.trim() });
  }
  for (const message of history) {
    if (
      message.role === "assistant" &&
      message.content &&
      message.content.startsWith("[TOOL_CALLS]:")
    ) {
      try {
        const toolCalls = JSON.parse(message.content.slice(13));
        result.push({
          role: "assistant",
          content: null,
          tool_calls: toolCalls,
        });
      } catch (error) {
        logger.warn({ err: error }, "Failed to parse tool calls from history");
      }
    } else if (
      message.role === "tool" &&
      message.content &&
      message.content.startsWith("[TOOL_RESULT:")
    ) {
      const match = message.content.match(
        /^\[TOOL_RESULT:([^:]+):([^\]]+)\]:(.*)$/s
      );
      if (match) {
        result.push({
          role: "tool",
          tool_call_id: match[1],
          name: match[2],
          content: match[3],
        });
      }
    } else if (
      message.role === "user" &&
      String(message.content || "").includes("[IMAGE_DATA:")
    ) {
      const parts = [];
      const imageRegex = /\[IMAGE_DATA:([^\]]+)\]/g;
      const textContent = String(message.content || "")
        .replace(imageRegex, "")
        .trim();
      if (textContent) {
        parts.push({ type: "text", text: textContent });
      }

      let match;
      const imageRegex2 = /\[IMAGE_DATA:([^\]]+)\]/g;
      while (
        (match = imageRegex2.exec(String(message.content || ""))) !== null
      ) {
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
      result.push({ role: message.role, content: message.content });
    }
  }
  return result;
}

export function buildConversationSystemPrompt(uid, conversation) {
  return buildAgentSystemPrompt({
    uid,
    baseSystemPrompt: [
      DEFAULT_CONVERSATION_AGENT_PROMPT.trim(),
      getConversationAgentPrompt(uid, conversation),
      String(conversation?.system_prompt || "").trim(),
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
}

function getEndpoints(uid) {
  return getOrderedEndpointGroups(uid);
}

export function normalizeGenerationConfig(input = {}) {
  const toNumber = (value) => {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : undefined;
  };

  const temperature = toNumber(input.temperature);
  const topP = toNumber(input.top_p);
  const maxTokens = toNumber(input.max_tokens);
  const presencePenalty = toNumber(input.presence_penalty);
  const frequencyPenalty = toNumber(input.frequency_penalty);
  const hasMaxTokens = maxTokens !== undefined;
  const shouldOmitMaxTokens = hasMaxTokens && maxTokens <= 0;

  return {
    temperature:
      temperature !== undefined ? Math.min(2, Math.max(0, temperature)) : 0.7,
    top_p: topP !== undefined ? Math.min(1, Math.max(0, topP)) : 1,
    ...(presencePenalty !== undefined
      ? { presence_penalty: Math.min(2, Math.max(-2, presencePenalty)) }
      : {}),
    ...(frequencyPenalty !== undefined
      ? { frequency_penalty: Math.min(2, Math.max(-2, frequencyPenalty)) }
      : {}),
    ...(hasMaxTokens && !shouldOmitMaxTokens
      ? { max_tokens: Math.round(Math.min(8192, Math.max(64, maxTokens))) }
      : {}),
  };
}

export function resolveEndpointGenerationConfig(
  endpoint,
  generationConfig = {}
) {
  const normalized = { ...(generationConfig || {}) };

  if (
    normalized.max_tokens === undefined &&
    String(endpoint?.provider || "").toLowerCase() === "openrouter"
  ) {
    normalized.max_tokens = 16384;
  }

  return normalized;
}

export function getUpstreamErrorMessage(error) {
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

function isReasoningLikeType(value) {
  const normalized = String(value || "").toLowerCase();
  return /reason|think|analysis|thought/.test(normalized);
}

function collectTextFragments(value, depth = 0, mode = "any") {
  if (value === null || value === undefined || depth > 6) return [];
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextFragments(item, depth + 1, mode));
  }
  if (typeof value !== "object") return [];

  const objectType = String(
    value.type || value.delta_type || value.content_type || ""
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
      if (!(key in value)) continue;
      fragments.push(...collectTextFragments(value[key], depth + 1, mode));
    }
    return fragments;
  }

  if (mode === "reasoning" && objectType && !objectIsReasoning) {
    for (const key of reasoningOnlyKeys) {
      if (!(key in value)) continue;
      fragments.push(...collectTextFragments(value[key], depth + 1, mode));
    }
    for (const key of nestedKeys) {
      if (!(key in value)) continue;
      fragments.push(...collectTextFragments(value[key], depth + 1, mode));
    }
    return fragments;
  }

  const keysToRead =
    mode === "answer"
      ? directTextKeys
      : [...reasoningOnlyKeys, ...directTextKeys];
  for (const key of keysToRead) {
    if (!(key in value)) continue;
    fragments.push(...collectTextFragments(value[key], depth + 1, mode));
  }
  for (const key of nestedKeys) {
    if (!(key in value)) continue;
    fragments.push(...collectTextFragments(value[key], depth + 1, mode));
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

export function initSse(res) {
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
  res.write(":ok\n\n");
}

export function finalizeSse(res) {
  if (res.writableEnded) return;
  res.write("data: [DONE]\n\n");
  res.end();
}

export function buildAssistantFailureContent(summary, details = {}) {
  const normalizedSummary = String(summary || "执行失败")
    .replace(/^[⚠️❌]\s*/, "")
    .trim();
  const lines = [`⚠️ ${normalizedSummary}`];
  const detailEntries = Object.entries(details).filter(([, value]) => {
    if (value === null || value === undefined) return false;
    return String(value).trim() !== "";
  });

  if (detailEntries.length > 0) {
    lines.push("", "调试信息：", "```text");
    for (const [key, value] of detailEntries) {
      lines.push(`${key}: ${String(value)}`);
    }
    lines.push("```");
  }

  return lines.join("\n");
}

function serializeDebugValue(value, maxLength = 12000) {
  try {
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (serialized.length <= maxLength) {
      return serialized;
    }
    return `${serialized.slice(0, maxLength)}\n...<truncated>`;
  } catch {
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
  return `${String(uid || "").trim()}:${String(conversationId || "").trim()}`;
}

export function createConversationExecutionContext(uid, conversationId, res) {
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

export function clearConversationExecutionContext(uid, conversationId) {
  activeConversationExecutions.delete(
    getConversationExecutionKey(uid, conversationId)
  );
}

function isExecutionAborted(executionContext) {
  return Boolean(executionContext?.signal?.aborted);
}

function describeExecutionAbort(executionContext, extra = {}) {
  const reasonCode = String(
    executionContext?.abortReason ||
      executionContext?.signal?.reason ||
      extra.reasonCode ||
      ""
  ).trim();
  const errorDetail = extra.error ? getUpstreamErrorMessage(extra.error) : "";

  let summary = "执行已中断。";
  if (reasonCode === "manual_stop") {
    summary = "会话已被手动终止。";
  } else if (reasonCode === "client_disconnect") {
    summary = "客户端连接已断开（可能因刷新、跳转或网络中断）。";
  } else if (reasonCode === "replaced") {
    summary = "当前执行已被新的请求替换。";
  } else if (errorDetail && errorDetail !== "Execution aborted") {
    summary = `上游流式响应异常中断：${errorDetail}`;
  }

  return {
    summary,
    details: {
      abort_reason: reasonCode || "unknown",
      phase: extra.phase || "",
      upstream_error:
        errorDetail && errorDetail !== "Execution aborted" ? errorDetail : "",
    },
  };
}

export function bindClientDisconnectAbort(req, res, executionContext) {
  if (!req || !executionContext) return () => {};

  let responseFinished = false;
  const markFinished = () => {
    responseFinished = true;
  };

  const abortIfClientDisconnected = () => {
    if (!responseFinished && !res.writableEnded) {
      executionContext.abort("client_disconnect");
    }
  };

  req.once("aborted", abortIfClientDisconnected);
  res.once("close", abortIfClientDisconnected);
  res.once("finish", markFinished);

  return () => {
    if (typeof req.off === "function") {
      req.off("aborted", abortIfClientDisconnected);
    } else if (typeof req.removeListener === "function") {
      req.removeListener("aborted", abortIfClientDisconnected);
    }

    if (typeof res.off === "function") {
      res.off("close", abortIfClientDisconnected);
      res.off("finish", markFinished);
    } else if (typeof res.removeListener === "function") {
      res.removeListener("close", abortIfClientDisconnected);
      res.removeListener("finish", markFinished);
    }
  };
}

export async function streamConversationAgent({
  uid,
  model,
  messages,
  res,
  conversationId,
  source = "chat",
  aiMsgId,
  debug = false,
  generationConfig = {},
  conversationContextWindow = null,
  allowedToolNames = null,
  executionContext = null,
}) {
  const endpoints = getEndpoints(uid);
  const modelCandidates = resolveModelCandidates(uid, model);
  const debugEnabled = Boolean(debug);
  const taskConfig = getTaskConfig(uid);
  const requestLog = logger.child({
    route: "agentConversation.stream",
    uid,
    conversationId,
    source,
    requestedModel: model,
    modelCandidates,
  });
  const persistAssistantFailure = (messageId, fallbackText, details = null) => {
    if (!messageId) return;
    try {
      updateMessage(
        messageId,
        uid,
        details
          ? buildAssistantFailureContent(fallbackText, details)
          : String(fallbackText || "")
      );
    } catch (error) {
      requestLog.warn(
        { err: error, aiMsgId: messageId },
        "Failed to persist assistant fallback content"
      );
    }
  };
  const emitExecutionAbort = (messageId, phase, error = null) => {
    const abortInfo = describeExecutionAbort(executionContext, {
      phase,
      error,
    });
    persistAssistantFailure(
      messageId || aiMsgId,
      abortInfo.summary,
      abortInfo.details
    );
    emitDebugSse(res, debugEnabled, {
      phase: "execution_aborted",
      ...abortInfo.details,
    });
    if (!res.writableEnded) {
      res.write(
        `data: ${JSON.stringify({
          error: abortInfo.summary,
          abort_reason: abortInfo.details.abort_reason,
          phase,
          upstream_error: abortInfo.details.upstream_error || undefined,
        })}\n\n`
      );
    }
    return false;
  };

  requestLog.info(
    {
      endpointCount: endpoints.length,
      messageCount: messages.length,
      generationConfig,
      allowedToolNames,
    },
    "Starting upstream stream request"
  );
  emitDebugSse(res, debugEnabled, {
    phase: "request_init",
    requested_model: model || "",
    model_candidates: modelCandidates,
    conversation_context_window: conversationContextWindow,
    endpoint_candidates: endpoints.map((endpoint) => ({
      id: endpoint.id,
      name: endpoint.name,
      base_url: endpoint.base_url,
      provider: endpoint.provider,
    })),
    generation_config: generationConfig,
    request_messages: messages,
    allowed_tool_names: allowedToolNames,
  });

  if (!endpoints.length) {
    const fallbackText = "⚠️ 未配置可用 API Endpoint，请先到设置里配置。";
    persistAssistantFailure(aiMsgId, fallbackText);
    res.write(
      `data: ${JSON.stringify({ error: "请先在设置中配置 API Endpoint" })}\n\n`
    );
    return false;
  }
  if (!modelCandidates.length) {
    const fallbackText = "⚠️ 当前没有可用模型，请先在端点管理中启用模型。";
    persistAssistantFailure(aiMsgId, fallbackText);
    res.write(
      `data: ${JSON.stringify({
        error: "请先在端点管理中启用至少一个模型",
      })}\n\n`
    );
    return false;
  }

  const { requestTools } = await prepareAgentTooling(uid, {
    toolNames: allowedToolNames,
  });
  const requestToolsPayload =
    requestTools.length > 0 ? requestTools : undefined;

  let maxToolLoops = Number(taskConfig?.max_tool_loops) || 100;
  let currentLoop = 0;

  async function executeTurn(currentMessages, currentAiMsgId) {
    if (isExecutionAborted(executionContext)) {
      return emitExecutionAbort(currentAiMsgId, "execute_turn_init");
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
        return emitExecutionAbort(currentAiMsgId, "model_loop_start");
      }
      const attempt = await requestAgentTurnWithFallback({
        uid,
        modelCandidates: [modelId],
        messages: currentMessages,
        openaiTools: requestToolsPayload,
        stream: true,
        resolveGenerationConfig: (endpoint, candidateModelId) => {
          const endpointModelConfig =
            findModelConfigForEndpoint(endpoint.id, uid, candidateModelId)
              ?.generation_config || {};
          return resolveEndpointGenerationConfig(
            endpoint,
            mergeGenerationConfig(endpointModelConfig, generationConfig)
          );
        },
        getErrorMessage: getUpstreamErrorMessage,
        onAttemptStart: ({ endpoint, baseURL, endpointGenerationConfig }) => {
          emitDebugSse(res, debugEnabled, {
            phase: "attempt_start",
            model_id: modelId,
            endpoint: {
              id: endpoint.id,
              name: endpoint.name,
              provider: endpoint.provider,
              base_url: baseURL,
            },
            request: {
              messages: currentMessages,
              tools: requestToolsPayload,
              generation_config: endpointGenerationConfig,
            },
          });
        },
        onStreamOptionsRetry: ({ endpoint, baseURL, error }) => {
          emitDebugSse(res, debugEnabled, {
            phase: "stream_options_retry",
            model_id: modelId,
            endpoint_name: endpoint.name,
            base_url: baseURL,
            error: getUpstreamErrorMessage(error),
          });
        },
        onAttemptFailed: ({ endpoint, baseURL, errorMessage }) => {
          emitDebugSse(res, debugEnabled, {
            phase: "attempt_failed",
            model_id: modelId,
            endpoint_name: endpoint.name,
            base_url: baseURL,
            error: errorMessage,
          });
        },
      });

      if (!attempt.ok) {
        if (isExecutionAborted(executionContext)) {
          return emitExecutionAbort(currentAiMsgId, "endpoint_attempt");
        }
        lastError = attempt.lastError;
      } else {
        const {
          stream,
          client,
          endpoint,
          baseURL,
          endpointGenerationConfig,
          retriedWithoutStreamOptions,
        } = attempt;

        let fullTextContent = "";
        let toolCalls = [];
        let promptTokens = 0;
        let completionTokens = 0;
        let chunkCount = 0;
        let emptyTextChunkCount = 0;
        let lastFinishReason = null;
        let reasoningOpen = false;
        const observedDeltaKeys = new Set();

        emitDebugSse(res, debugEnabled, {
          phase: "stream_connected",
          model_id: modelId,
          endpoint_name: endpoint.name,
          base_url: baseURL,
          retried_without_stream_options: retriedWithoutStreamOptions,
        });

        try {
          for await (const chunk of stream) {
            if (res.writableEnded && !isExecutionAborted(executionContext)) {
              executionContext?.abort("client_disconnect");
            }
            if (isExecutionAborted(executionContext) || res.writableEnded) {
              return emitExecutionAbort(currentAiMsgId, "upstream_stream");
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
              endpoint_name: endpoint.name,
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
              fullTextContent += emittedText;
              emitContentSse(res, emittedText);
            } else {
              emptyTextChunkCount++;
            }

            if (delta.tool_calls) {
              const toolCallDeltas = Array.isArray(delta.tool_calls)
                ? delta.tool_calls
                : [delta.tool_calls];
              for (const toolCallDelta of toolCallDeltas) {
                if (!toolCallDelta) continue;
                const index =
                  Number.isInteger(toolCallDelta.index) &&
                  Number(toolCallDelta.index) >= 0
                    ? Number(toolCallDelta.index)
                    : toolCalls.length;
                if (!toolCalls[index]) {
                  toolCalls[index] = {
                    id: toolCallDelta.id,
                    type: "function",
                    function: {
                      name: toolCallDelta.function?.name || "",
                      arguments: "",
                    },
                  };
                }
                if (toolCallDelta.function?.arguments) {
                  toolCalls[index].function.arguments +=
                    toolCallDelta.function.arguments;
                }
              }
            }

            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens || 0;
              completionTokens = chunk.usage.completion_tokens || 0;
            }
          }
        } catch (error) {
          if (isExecutionAborted(executionContext)) {
            return emitExecutionAbort(
              currentAiMsgId,
              "endpoint_attempt",
              error
            );
          }
          throw error;
        }

        if (reasoningOpen) {
          const closeThinkingTag = "\n</think>\n";
          fullTextContent += closeThinkingTag;
          emitContentSse(res, closeThinkingTag);
        }

        emitDebugSse(res, debugEnabled, {
          phase: "stream_completed",
          model_id: modelId,
          endpoint_name: endpoint.name,
          base_url: baseURL,
          chunk_count: chunkCount,
          content_length: fullTextContent.length,
          empty_text_chunk_count: emptyTextChunkCount,
          tool_call_count: toolCalls.filter(Boolean).length,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          finish_reason: lastFinishReason,
          observed_delta_keys: [...observedDeltaKeys],
        });

        if (promptTokens > 0) {
          logUsage({
            uid,
            conversationId,
            model: modelId,
            endpointName: endpoint.name,
            promptTokens,
            completionTokens,
            source,
          });
        }

        const finalToolCalls = toolCalls.filter(Boolean);
        if (finalToolCalls.length === 0) {
          if (!fullTextContent.trim()) {
            const requestedMaxTokens = generationConfig?.max_tokens ?? "未设置";
            const reasonText =
              lastFinishReason === "length"
                ? `上游返回空内容（finish_reason: length，max_tokens: ${requestedMaxTokens}）。请调大 max_tokens 后重试。`
                : lastFinishReason
                ? `上游返回空内容（finish_reason: ${lastFinishReason}）`
                : "上游返回空内容（未携带 finish_reason）";
            persistAssistantFailure(currentAiMsgId, `⚠️ ${reasonText}`);
            res.write(`data: ${JSON.stringify({ error: reasonText })}\n\n`);
            return false;
          }
          return fullTextContent;
        }

        const toolCallsMessage = `[TOOL_CALLS]:${JSON.stringify(
          finalToolCalls
        )}`;
        updateMessage(currentAiMsgId, uid, toolCallsMessage);

        currentMessages.push({
          role: "assistant",
          content: null,
          tool_calls: finalToolCalls,
        });

        for (const toolCall of finalToolCalls) {
          if (isExecutionAborted(executionContext)) {
            return emitExecutionAbort(currentAiMsgId, "before_tool_execution");
          }

          let toolArgsPreview = null;
          try {
            toolArgsPreview = JSON.parse(toolCall.function.arguments || "{}");
          } catch {
            toolArgsPreview = toolCall.function.arguments || "{}";
          }

          res.write(
            `data: ${JSON.stringify({
              type: "tool_running",
              tool_name: toolCall.function.name,
            })}\n\n`
          );
          emitDebugSse(res, debugEnabled, {
            phase: "tool_running",
            tool_name: toolCall.function.name,
            tool_arguments: toolArgsPreview,
          });

          const toolExecution = await executeAgentToolCall({
            uid,
            requestTools,
            toolCall,
            signal: executionContext?.signal,
            executionScope: {
              uid,
              conversationId,
            },
          });

          if (isExecutionAborted(executionContext)) {
            return emitExecutionAbort(currentAiMsgId, "tool_execution");
          }

          if (toolExecution.ok) {
            const toolResultString = `[TOOL_RESULT:${toolCall.id}:${toolExecution.toolName}]:${toolExecution.resultText}`;
            addMessage(conversationId, uid, "tool", toolResultString);
            emitDebugSse(res, debugEnabled, {
              phase: "tool_result",
              tool_name: toolExecution.toolName,
              tool_call_id: toolCall.id,
              result: serializeDebugValue(toolExecution.resultText),
            });

            currentMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              name: toolExecution.toolName,
              content: toolExecution.resultText,
            });
            continue;
          }

          const toolError = `[TOOL_RESULT:${toolCall.id}:${toolCall.function.name}]:Error - ${toolExecution.errorMessage}`;
          addMessage(conversationId, uid, "tool", toolError);
          emitDebugSse(res, debugEnabled, {
            phase: "tool_error",
            tool_name: toolCall.function.name,
            tool_call_id: toolCall.id,
            error: toolExecution.errorMessage,
          });
          currentMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: toolExecution.errorMessage,
          });
        }

        const nextAiMessage = addMessage(conversationId, uid, "assistant", "");
        const nextContent = await executeTurn(
          currentMessages,
          nextAiMessage.id
        );

        if (nextContent === "_FORCE_FINAL_RESPONSE_") {
          const forcedFinalText = await requestForcedFinalAgentResponse({
            client,
            modelId,
            messages: currentMessages,
            wrapUpPrompt:
              "请停止继续调用工具，基于现有上下文和工具结果直接给出最终答复。格式：结果、依据、未完成项（如无写“无”）。",
            generationConfig: mergeGenerationConfig(endpointGenerationConfig, {
              max_tokens: 2048,
            }),
            onUsage: (usage) => {
              if (!usage?.prompt_tokens) return;
              logUsage({
                uid,
                conversationId,
                model: modelId,
                endpointName: endpoint.name,
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens,
                source,
              });
            },
          });
          if (!forcedFinalText) {
            persistAssistantFailure(
              nextAiMessage.id,
              "⚠️ 工具调用达到上限，但未能整理出最终答复。"
            );
            return false;
          }
          updateMessage(nextAiMessage.id, uid, forcedFinalText);
          emitContentSse(res, forcedFinalText);
          return "_HANDLED_INTERNALLY_";
        }
        if (nextContent === false) {
          return false;
        }
        if (nextContent !== "_HANDLED_INTERNALLY_") {
          updateMessage(nextAiMessage.id, uid, nextContent);
        }

        return "_HANDLED_INTERNALLY_";
      }

      res.write(
        `data: ${JSON.stringify({
          notice: `模型 ${modelId} 不可用，尝试备用模型中...`,
        })}\n\n`
      );
    }

    if (isExecutionAborted(executionContext)) {
      return emitExecutionAbort(currentAiMsgId, "all_attempts_exhausted");
    }

    const fallbackError = getUpstreamErrorMessage(lastError);
    res.write(
      `data: ${JSON.stringify({
        error: `所有 API 端点均不可用：${fallbackError}`,
      })}\n\n`
    );
    persistAssistantFailure(
      currentAiMsgId,
      `❌ 错误：所有 API 端点均不可用：${fallbackError}`
    );
    return false;
  }

  return executeTurn(messages, aiMsgId);
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
          // ignore non-json fragments
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
}) {
  const bufferedRes = createBufferedSseResponse();
  const executionContext = createConversationExecutionContext(
    uid,
    conversationId,
    bufferedRes
  );
  initSse(bufferedRes);
  let aiMessage = null;

  try {
    const conversation = getConversation(conversationId, uid);
    if (!conversation) {
      throw new Error("对话不存在或无权限");
    }

    let storedContent = String(message || "");
    if (Array.isArray(images) && images.length > 0) {
      storedContent +=
        "\n" + images.map((img) => `[IMAGE_DATA:${img}]`).join("\n");
    }
    addMessage(conversationId, uid, "user", storedContent);

    const history = getMessages(conversationId, uid);
    const systemPrompt = buildConversationSystemPrompt(uid, conversation);
    const messages = buildConversationMessages(history, systemPrompt);
    aiMessage = addMessage(conversationId, uid, "assistant", "");

    const fullContent = await streamConversationAgent({
      uid,
      model: String(model || "").trim(),
      messages,
      res: bufferedRes,
      conversationId,
      source,
      aiMsgId: aiMessage.id,
      debug,
      generationConfig,
      conversationContextWindow: conversation?.context_window ?? null,
      allowedToolNames: conversation?.tool_names ?? null,
      executionContext,
    });

    if (fullContent === false) {
      const latestError = [...bufferedRes.getEvents()]
        .reverse()
        .find((event) => event?.error || event?.notice);
      throw new Error(
        latestError?.error || latestError?.notice || "Agent 执行失败"
      );
    }

    if (fullContent !== "_HANDLED_INTERNALLY_") {
      updateMessage(aiMessage.id, uid, fullContent);
    }

    const finalAssistantMessage = [...getMessages(conversationId, uid)]
      .reverse()
      .find(
        (item) =>
          item.role === "assistant" &&
          String(item.content || "").trim() &&
          !String(item.content || "").startsWith("[TOOL_CALLS]:")
      );

    finalizeSse(bufferedRes);
    return {
      conversationId: String(conversationId),
      assistantMessageId: Number(finalAssistantMessage?.id || aiMessage.id),
      finalResponse: String(
        finalAssistantMessage?.content || fullContent || ""
      ).trim(),
      events: bufferedRes.getEvents(),
    };
  } catch (error) {
    if (aiMessage?.id) {
      updateMessage(
        aiMessage.id,
        uid,
        buildAssistantFailureContent("Agent 执行失败。", {
          phase: "channel_run",
          error: error.message || "unknown_error",
        })
      );
    }
    throw error;
  } finally {
    clearConversationExecutionContext(uid, conversationId);
  }
}

export function stopConversationExecution(uid, conversationId) {
  const key = getConversationExecutionKey(uid, conversationId);
  const execution = activeConversationExecutions.get(key);

  if (!execution) {
    return { success: true, stopped: false, message: "当前无运行中的会话" };
  }

  execution.abort("manual_stop");
  const killedCommands = abortBuiltInShellExecutions({
    uid,
    conversationId,
  });

  if (execution.res && !execution.res.writableEnded) {
    execution.res.write(
      `data: ${JSON.stringify({
        notice: "会话已被手动终止",
      })}\n\n`
    );
    finalizeSse(execution.res);
  }

  clearConversationExecutionContext(uid, conversationId);
  return { success: true, stopped: true, killed_commands: killedCommands };
}
