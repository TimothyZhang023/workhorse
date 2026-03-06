import { Router } from "express";
import OpenAI from "openai";
import { authMiddleware } from "../middleware/auth.js";
import {
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
import db from "../models/database.js";
import { executeMcpTool, getAllAvailableTools } from "../models/mcpManager.js";

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
    if (m.role === "assistant" && m.content && m.content.startsWith("[TOOL_CALLS]:")) {
      try {
        const toolCalls = JSON.parse(m.content.slice(13));
        result.push({ role: "assistant", content: null, tool_calls: toolCalls });
      } catch (e) {
        console.warn("Failed to parse tool calls from history", e);
      }
    } else if (m.role === "tool" && m.content && m.content.startsWith("[TOOL_RESULT:")) {
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
        const mimeType = base64Data.startsWith("/9j/") ? "image/jpeg" : "image/png";
        parts.push({
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: "auto" },
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

  return {
    ...(temperature !== undefined
      ? { temperature: Math.min(2, Math.max(0, temperature)) }
      : {}),
    ...(topP !== undefined ? { top_p: Math.min(1, Math.max(0, topP)) } : {}),
    ...(maxTokens !== undefined
      ? { max_tokens: Math.round(Math.min(8192, Math.max(1, maxTokens))) }
      : {}),
  };
}

async function streamWithFallback(uid, model, messages, res, opts = {}) {
  const endpoints = getEndpoints(uid);
  if (!endpoints.length) {
    res.write(`data: ${JSON.stringify({ error: "请先在设置中配置 API Endpoint" })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
    return false;
  }

  // Get tools from MCP
  const allTools = await getAllAvailableTools(uid).catch((e) => {
    console.error("Failed to get MCP tools: ", e);
    return [];
  });
  // Strip internal _mcp_server_id field before sending to OpenAI
  const requestTools = allTools.length > 0
    ? allTools.map(({ _mcp_server_id, ...t }) => t)
    : undefined;

  let maxToolLoops = 5;
  let currentLoop = 0;

  async function executeTurn(currentMessages, currentAiMsgId) {
    if (currentLoop >= maxToolLoops) {
      res.write(`data: ${JSON.stringify({ error: "超出最大工具调用次数" })}\n\n`);
      return false;
    }
    currentLoop++;

    let lastError = null;
    for (const ep of endpoints) {
      try {
        const client = new OpenAI({ apiKey: ep.api_key, baseURL: ep.base_url });
        const streamParams = {
          model: model || "gpt-4",
          messages: currentMessages,
          stream: true,
          tools: requestTools,
          stream_options: { include_usage: true },
          ...(opts.generationConfig || {}),
        };

        const stream = await client.chat.completions.create(streamParams);

        let fullTextContent = "";
        let toolCalls = [];
        let promptTokens = 0;
        let completionTokens = 0;

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta || {};

          if (delta.content) {
            fullTextContent += delta.content;
            res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
          }

          if (delta.tool_calls) {
            for (const tcDelta of delta.tool_calls) {
              const idx = tcDelta.index;
              if (!toolCalls[idx]) {
                toolCalls[idx] = {
                  id: tcDelta.id,
                  type: "function",
                  function: { name: tcDelta.function?.name || "", arguments: "" },
                };
              }
              if (tcDelta.function?.arguments) {
                toolCalls[idx].function.arguments += tcDelta.function.arguments;
              }
            }
          }

          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens || 0;
            completionTokens = chunk.usage.completion_tokens || 0;
          }
        }

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
          console.warn("[Usage] Failed to log usage:", logErr.message);
        }

        const finalToolCalls = toolCalls.filter(Boolean);

        // CASE 1: No tools
        if (finalToolCalls.length === 0) {
          return fullTextContent;
        }

        // CASE 2: Tool calls
        const toolCallsMsgStr = `[TOOL_CALLS]:${JSON.stringify(finalToolCalls)}`;
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

            res.write(`data: ${JSON.stringify({ type: "tool_running", tool_name: funcName })}\n\n`);

            let resultContent = "";
            const toolDef = allTools.find((t) => t.function.name === funcName);
            if (toolDef && toolDef._mcp_server_id) {
              const mcpRes = await executeMcpTool(uid, toolDef._mcp_server_id, funcName, funcArgsDecoded);
              resultContent = (mcpRes.content || []).map((c) => c.text).join("\n");
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
            console.error(err);
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
        const nextAiMsg = addMessage(opts.conversationId, uid, "assistant", "");
        const nextContent = await executeTurn(currentMessages, nextAiMsg.id);

        if (nextContent !== false && nextContent !== "_HANDLED_INTERNALLY_") {
          updateMessage(nextAiMsg.id, uid, nextContent);
        }

        return "_HANDLED_INTERNALLY_";
      } catch (error) {
        lastError = error;
        console.warn(`[Fallback] Endpoint "${ep.name}" failed: ${error.message}.`);
        if (endpoints.indexOf(ep) < endpoints.length - 1) {
          res.write(`data: ${JSON.stringify({ notice: "切换到备用端点中..." })}\n\n`);
        }
      }
    }

    res.write(`data: ${JSON.stringify({ error: `所有 API 端点均不可用：${lastError?.message}` })}\n\n`);
    res.write("data: [DONE]\n\n");
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

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
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

    const fullContent = await streamWithFallback(uid, model, messages, res, {
      conversationId: id,
      source: "chat",
      aiMsgId: aiMsg.id,
      generationConfig,
    });

    if (fullContent === false) {
      // Early exit handled in stream
      return;
    } else if (fullContent !== "_HANDLED_INTERNALLY_") {
      updateMessage(aiMsg.id, uid, fullContent);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
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
    console.warn(
      `[Title Summary] Failed for conversation ${id}: ${error.message}`
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

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
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

    const fullContent = await streamWithFallback(uid, model, messages, res, {
      conversationId: id,
      source: "chat",
      aiMsgId: aiMsg.id,
      generationConfig,
    });

    if (fullContent === false) {
      return;
    } else if (fullContent !== "_HANDLED_INTERNALLY_") {
      updateMessage(aiMsg.id, uid, fullContent);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// ============ 编辑消息并重新生成 ============

router.put("/:id/messages/:msgId", async (req, res) => {
  const { id, msgId } = req.params;
  const { content, model } = req.body;
  const uid = req.uid;
  const generationConfig = normalizeGenerationConfig(req.body);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const conversation = getConversation(id, uid);
    if (!conversation) {
      res.write(`data: ${JSON.stringify({ error: "对话不存在或无权限" })}\n\n`);
      res.end();
      return;
    }

    const m = db.prepare("SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND uid = ?").get(msgId, id, uid);
    if (!m) {
      res.write(`data: ${JSON.stringify({ error: "消息不存在" })}\n\n`);
      res.end();
      return;
    }

    // 截断该消息之后的所有消息
    db.prepare("DELETE FROM messages WHERE conversation_id = ? AND uid = ? AND id > ?").run(id, uid, msgId);

    // 更新当前消息的内容
    updateMessage(msgId, uid, content);

    // 重新获取历史并生成
    const history = getMessages(id, uid);
    const systemPrompt = conversation?.system_prompt || "";
    const messages = buildMessages(history, systemPrompt);
    const aiMsg = addMessage(id, uid, "assistant", "");

    const fullContent = await streamWithFallback(uid, model, messages, res, {
      conversationId: id,
      source: "chat",
      aiMsgId: aiMsg.id,
      generationConfig,
    });

    if (fullContent === false) {
      return;
    } else if (fullContent !== "_HANDLED_INTERNALLY_") {
      updateMessage(aiMsg.id, uid, fullContent);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

export default router;
