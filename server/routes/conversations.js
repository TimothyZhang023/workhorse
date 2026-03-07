import { Router } from "express";
import OpenAI from "openai";
import { authMiddleware } from "../middleware/auth.js";
import db, {
  addMessage,
  createConversation,
  deleteConversation,
  deleteLastAssistantMessage,
  getConversation,
  getConversations,
  getEndpointGroups,
  getMessages,
  logUsage,
  updateConversationSystemPrompt,
  updateConversationTitle,
  updateMessage,
} from "../models/database.js";
import { executeMcpTool, getAllAvailableTools } from "../models/mcpManager.js";
import { logger } from "../utils/logger.js";

const router = Router();
router.use(authMiddleware);
const titleSummaryInFlight = new Set();

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
    const { title } = req.body;
    res.json(createConversation(req.uid, title));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { title, system_prompt } = req.body;
    if (title !== undefined) updateConversationTitle(id, req.uid, title);
    if (system_prompt !== undefined)
      updateConversationSystemPrompt(id, req.uid, system_prompt);
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
    res.json(getMessages(req.params.id, req.uid));
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

/**
 * 获取带 Fallback 的 OpenAI client
 * 1. 优先使用默认 Endpoint
 * 2. 如果失败，自动切换到其他 Endpoint
 */
function getEndpoints(uid) {
  const groups = getEndpointGroups(uid);
  if (!groups.length) return [];
  // 默认的排首位
  return groups.sort((a, b) => b.is_default - a.is_default);
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
    if (!firstUser || !firstAssistant) return;

    const userText = extractDisplayText(firstUser.content).slice(0, 400);
    const assistantText = extractDisplayText(firstAssistant.content).slice(
      0,
      500
    );
    const endpoints = getEndpoints(uid);
    if (!endpoints.length) return;

    for (const ep of endpoints) {
      try {
        const client = new OpenAI({ apiKey: ep.api_key, baseURL: ep.base_url });
        const completion = await client.chat.completions.create({
          model: preferredModel || "gpt-4o-mini",
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

        updateConversationTitle(conversationId, uid, normalized);
        return;
      } catch (error) {
        console.warn(
          `[Title Summary] Endpoint "${ep.name}" failed: ${error.message}`
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
  const hasTemperature = temperature !== undefined;
  const hasTopP = topP !== undefined;
  const hasMaxTokens = maxTokens !== undefined;
  const shouldOmitMaxTokens = hasMaxTokens && maxTokens <= 0;

  return {
    // 中性默认值：temperature=0.7, top_p=1
    temperature: hasTemperature ? Math.min(2, Math.max(0, temperature)) : 0.7,
    top_p: hasTopP ? Math.min(1, Math.max(0, topP)) : 1,
    ...(hasMaxTokens && !shouldOmitMaxTokens
      ? { max_tokens: Math.round(Math.min(8192, Math.max(64, maxTokens))) }
      : {}),
  };
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

function stringifyDeltaText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.content === "string") return part.content;
      if (typeof part?.reasoning === "string") return part.reasoning;
      return "";
    })
    .join("");
}

function finalizeSse(res) {
  if (res.writableEnded) return;
  res.write("data: [DONE]\n\n");
  res.end();
}

async function streamWithFallback(uid, model, messages, res, opts = {}) {
  const endpoints = getEndpoints(uid);
  const requestLog = logger.child({
    route: "conversations.stream",
    uid,
    conversationId: opts.conversationId,
    source: opts.source || "chat",
    model,
  });

  requestLog.info(
    {
      endpointCount: endpoints.length,
      messageCount: messages.length,
      generationConfig: opts.generationConfig || {},
    },
    "Starting upstream stream request"
  );

  if (!endpoints.length) {
    requestLog.warn("No API endpoints configured");
    res.write(
      `data: ${JSON.stringify({ error: "请先在设置中配置 API Endpoint" })}\n\n`
    );
    return false;
  }

  // Get tools from MCP
  const allTools = await getAllAvailableTools(uid).catch((e) => {
    console.error("Failed to get MCP tools: ", e);
    return [];
  });
  // Strip internal _mcp_server_id field before sending to OpenAI
  const requestTools =
    allTools.length > 0
      ? allTools.map(({ _mcp_server_id, ...t }) => t)
      : undefined;

  let maxToolLoops = 5;
  let currentLoop = 0;

  async function executeTurn(currentMessages, currentAiMsgId) {
    if (currentLoop >= maxToolLoops) {
      res.write(
        `data: ${JSON.stringify({ error: "超出最大工具调用次数" })}\n\n`
      );
      return false;
    }
    currentLoop++;

    let lastError = null;
    for (const ep of endpoints) {
      const baseUrlCandidates = normalizeBaseUrlCandidates(ep.base_url);
      for (const baseURL of baseUrlCandidates) {
        let triedWithoutStreamOptions = false;
        try {
          const client = new OpenAI({ apiKey: ep.api_key, baseURL });
          const baseParams = {
            model,
            messages: currentMessages,
            stream: true,
            tools: requestTools,
            ...(opts.generationConfig || {}),
          };

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
                endpointName: ep.name,
                baseURL,
                reason: getUpstreamErrorMessage(error),
              },
              "Upstream rejected stream_options, retrying without it"
            );
            stream = await client.chat.completions.create(baseParams);
          }

          requestLog.info(
            {
              endpointName: ep.name,
              baseURL,
              messageCount: currentMessages.length,
              hasTools: !!requestTools?.length,
              retriedWithoutStreamOptions: triedWithoutStreamOptions,
            },
            "Upstream stream connected"
          );

          let fullTextContent = "";
          let toolCalls = [];
          let promptTokens = 0;
          let completionTokens = 0;
          let chunkCount = 0;
          let firstContentAt = null;
          let lastFinishReason = null;

          for await (const chunk of stream) {
            chunkCount++;
            const choice = chunk.choices?.[0] || {};
            const delta = choice.delta || {};
            lastFinishReason = choice.finish_reason || lastFinishReason;

            if (chunk?.error?.message) {
              throw new Error(chunk.error.message);
            }

            const deltaContent = stringifyDeltaText(delta.content);
            const deltaRefusal = stringifyDeltaText(delta.refusal);
            const deltaReasoning = stringifyDeltaText(
              delta.reasoning || delta.reasoning_content
            );
            const emittedText = deltaContent || deltaRefusal || deltaReasoning;

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
              res.write(
                `data: ${JSON.stringify({ content: emittedText })}\n\n`
              );
            }

            if (delta.tool_calls) {
              for (const tcDelta of delta.tool_calls) {
                const idx = tcDelta.index;
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

          requestLog.info(
            {
              endpointName: ep.name,
              baseURL,
              chunkCount,
              contentLength: fullTextContent.length,
              toolCallCount: toolCalls.filter(Boolean).length,
              promptTokens,
              completionTokens,
              lastFinishReason,
            },
            "Upstream stream completed"
          );

          try {
            if (promptTokens > 0) {
              logUsage({
                uid,
                conversationId: opts.conversationId,
                model,
                endpointName: ep.name,
                promptTokens,
                completionTokens,
                source: opts.source || "chat",
              });
            }
          } catch (logErr) {
            requestLog.warn(
              { err: logErr, endpointName: ep.name, baseURL },
              "Failed to log usage"
            );
          }

          const finalToolCalls = toolCalls.filter(Boolean);

          // CASE 1: No tools
          if (finalToolCalls.length === 0) {
            if (!fullTextContent.trim() && lastFinishReason) {
              const requestedMaxTokens =
                opts?.generationConfig?.max_tokens ?? "未设置";
              const reasonText =
                lastFinishReason === "length"
                  ? `上游返回空内容（finish_reason: length，max_tokens: ${requestedMaxTokens}）。请调大 max_tokens 后重试。`
                  : `上游返回空内容（finish_reason: ${lastFinishReason}）`;
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
            try {
              const funcName = tc.function.name;
              const funcArgsDecoded = JSON.parse(tc.function.arguments || "{}");

              res.write(
                `data: ${JSON.stringify({
                  type: "tool_running",
                  tool_name: funcName,
                })}\n\n`
              );

              let resultContent = "";
              const toolDef = allTools.find(
                (t) => t.function.name === funcName
              );
              if (toolDef && toolDef._mcp_server_id) {
                const mcpRes = await executeMcpTool(
                  uid,
                  toolDef._mcp_server_id,
                  funcName,
                  funcArgsDecoded
                );
                resultContent = (mcpRes.content || [])
                  .map((c) => c.text)
                  .join("\n");
              } else {
                resultContent = `Unknown tool: ${funcName}`;
              }

              const toolResultStr = `[TOOL_RESULT:${tc.id}:${funcName}]:${resultContent}`;
              addMessage(opts.conversationId, uid, "tool", toolResultStr);

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

          if (nextContent === false) {
            return false;
          }
          if (nextContent !== "_HANDLED_INTERNALLY_") {
            updateMessage(nextAiMsg.id, uid, nextContent);
          }

          return "_HANDLED_INTERNALLY_";
        } catch (error) {
          lastError = error;
          requestLog.warn(
            {
              endpointName: ep.name,
              baseURL,
              error: getUpstreamErrorMessage(error),
            },
            "Upstream endpoint attempt failed"
          );
        }
      }

      if (endpoints.indexOf(ep) < endpoints.length - 1) {
        res.write(
          `data: ${JSON.stringify({ notice: "切换到备用端点中..." })}\n\n`
        );
      }
    }

    res.write(
      `data: ${JSON.stringify({
        error: `所有 API 端点均不可用：${getUpstreamErrorMessage(lastError)}`,
      })}\n\n`
    );
    return false;
  }

  return await executeTurn(messages, opts.aiMsgId);
}

// ============ 流式聊天 ============

router.post("/:id/chat", async (req, res) => {
  const { id } = req.params;
  const { message, model, images } = req.body;
  const uid = req.uid;
  const generationConfig = normalizeGenerationConfig(req.body);
  const requestedModel = String(model || "").trim();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

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
    if (!requestedModel) {
      res.write(`data: ${JSON.stringify({ error: "请选择模型后再发送" })}\n\n`);
      finalizeSse(res);
      return;
    }
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
    const systemPrompt = conversation?.system_prompt || "";
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
        generationConfig,
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
  }
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
  const generationConfig = normalizeGenerationConfig(req.body);
  const requestedModel = String(model || "").trim();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

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
    if (!requestedModel) {
      res.write(`data: ${JSON.stringify({ error: "请选择模型后再重试" })}\n\n`);
      finalizeSse(res);
      return;
    }
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
    const systemPrompt = conversation?.system_prompt || "";
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
        generationConfig,
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
  }
});

// ============ 编辑消息并重新生成 ============

router.put("/:id/messages/:msgId", async (req, res) => {
  const { id, msgId } = req.params;
  const { content, model } = req.body;
  const uid = req.uid;
  const generationConfig = normalizeGenerationConfig(req.body);
  const requestedModel = String(model || "").trim();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

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
    if (!requestedModel) {
      res.write(`data: ${JSON.stringify({ error: "请选择模型后再重试" })}\n\n`);
      finalizeSse(res);
      return;
    }
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
    const systemPrompt = conversation?.system_prompt || "";
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
        generationConfig,
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
  }
});

export default router;
