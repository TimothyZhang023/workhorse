import { Router } from "express";
import OpenAI from "openai";

import db, {
  addMessage,
  createConversation,
  deleteConversation,
  deleteLastAssistantMessage,
  getConversation,
  getConversations,
  getMessages,
  getModels,
  updateConversationAcpModel,
  updateConversationContextWindow,
  updateConversationSystemPrompt,
  updateConversationTitle,
  updateConversationToolNames,
  updateMessage,
} from "../models/database.js";
import {
  bindClientDisconnectAbort,
  buildAssistantFailureContent,
  buildConversationMessages,
  buildConversationSystemPrompt,
  clearConversationExecutionContext,
  createConversationExecutionContext,
  finalizeSse,
  getUpstreamErrorMessage,
  initSse,
  normalizeGenerationConfig,
  normalizeMessageForClient,
  resolveEndpointGenerationConfig,
  runConversationMessage,
  stopConversationExecution,
  streamConversationAgent,
} from "../models/agentConversation.js";
import { prepareAgentTooling } from "../models/agentRuntimeConfig.js";
import {
  cancelAcpConversation,
  getConversationAcpModels,
  setConversationAcpModel,
  streamAcpConversation,
} from "../models/acpAgentManager.js";
import { normalizeBaseUrlCandidates } from "../models/agentExecutionCore.js";
import { logger } from "../utils/logger.js";
import { getOrderedEndpointGroups } from "../utils/modelSelection.js";
import {
  buildCompactedConversationHistory,
  computeConversationContextBudget,
} from "../utils/conversationCompaction.js";

const router = Router();
const titleSummaryInFlight = new Set();

export {
  buildConversationSystemPrompt,
  normalizeMessageForClient,
  resolveEndpointGenerationConfig,
  runConversationMessage,
};

router.get("/", (req, res) => {
  try {
    res.json(getConversations(req.uid));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/", (req, res) => {
  try {
    const {
      title,
      tool_names,
      system_prompt,
      context_window,
      channel_id,
      acp_agent_id,
      acp_model_id,
    } =
      req.body;
    res.json(
      createConversation(
        req.uid,
        title,
        Array.isArray(tool_names) ? tool_names : null,
        {
          contextWindow: context_window,
          channelId: channel_id,
          acpAgentId: acp_agent_id,
          acpModelId: acp_model_id,
          systemPrompt: system_prompt,
        }
      )
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { title, system_prompt, tool_names, context_window, acp_model_id } =
      req.body;
    if (title !== undefined) updateConversationTitle(id, req.uid, title);
    if (system_prompt !== undefined) {
      updateConversationSystemPrompt(id, req.uid, system_prompt);
    }
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
    if (acp_model_id !== undefined) {
      updateConversationAcpModel(id, req.uid, acp_model_id);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id/acp-models", async (req, res) => {
  try {
    const conversation = getConversation(req.params.id, req.uid);
    if (!conversation) {
      return res.status(404).json({ error: "对话不存在或无权限" });
    }

    res.json(await getConversationAcpModels(req.uid, conversation));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/:id/acp-model", async (req, res) => {
  try {
    const conversation = getConversation(req.params.id, req.uid);
    if (!conversation) {
      return res.status(404).json({ error: "对话不存在或无权限" });
    }

    res.json(
      await setConversationAcpModel(
        req.uid,
        conversation,
        String(req.body?.model_id || "").trim()
      )
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/:id/context-budget", async (req, res) => {
  try {
    const conversation = getConversation(req.params.id, req.uid);
    if (!conversation) {
      return res.status(404).json({ error: "对话不存在或无权限" });
    }

    const history = getMessages(req.params.id, req.uid).filter(m => !m.is_archived);
    const tools = await getConversationTooling(req.uid, conversation);
    const systemPrompt = buildConversationSystemPrompt(req.uid, conversation);
    const budget = await computeConversationContextBudget({
      uid: req.uid,
      conversation,
      history,
      systemPrompt,
      tools,
    });

    return res.json(budget);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/:id/compact", async (req, res) => {
  try {
    const conversation = getConversation(req.params.id, req.uid);
    if (!conversation) {
      return res.status(404).json({ error: "对话不存在或无权限" });
    }

    const history = getMessages(req.params.id, req.uid).filter(m => !m.is_archived);
    const compacted = await getConversationHistoryForExecution(
      req.uid,
      conversation,
      history,
      { force: true }
    );

    if (!compacted.compacted || !Array.isArray(compacted.summaryMessages)) {
      return res.json({
        success: true,
        compacted: false,
        budget: compacted.budget,
      });
    }

    const droppedIds = compacted.droppedMessages.map(m => m.id);
    if (droppedIds.length > 0) {
      const placeholders = droppedIds.map(() => '?').join(',');
      db.prepare(`UPDATE messages SET is_archived = 1 WHERE id IN (${placeholders}) AND uid = ?`)
        .run(...droppedIds, req.uid);
    }

    for (const message of compacted.summaryMessages) {
      addMessage(req.params.id, req.uid, message.role, message.content, { is_hidden: 1, is_archived: 0 });
    }

    return res.json({
      success: true,
      compacted: true,
      compacted_messages: compacted.summaryMessages.length,
      budget: compacted.budget,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
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

function getEndpoints(uid) {
  return getOrderedEndpointGroups(uid);
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

function extractDisplayText(content) {
  return String(content || "").replace(/\[IMAGE_DATA:[^\]]+\]/g, "[图片]");
}

function decomposeStoredUserContent(content) {
  const raw = String(content || "");
  const images = [...raw.matchAll(/\[IMAGE_DATA:([^\]]+)\]/g)].map(
    (match) => match[1]
  );
  const message = raw.replace(/\[IMAGE_DATA:[^\]]+\]/g, "").trim();
  return { message, images };
}

async function getConversationTooling(uid, conversation) {
  const { requestTools } = await prepareAgentTooling(uid, {
    toolNames: conversation?.tool_names ?? null,
  });
  return requestTools;
}

async function getConversationHistoryForExecution(uid, conversation, history, options = {}) {
  const systemPrompt = buildConversationSystemPrompt(uid, conversation);
  const tools = await getConversationTooling(uid, conversation);
  return buildCompactedConversationHistory({
    uid,
    conversation,
    history,
    systemPrompt,
    tools,
    force: Boolean(options.force),
  });
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

async function summarizeConversationTitle(uid, conversationId, preferredModel) {
  const taskKey = `${uid}:${conversationId}`;
  if (titleSummaryInFlight.has(taskKey)) return;
  titleSummaryInFlight.add(taskKey);

  try {
    const conversation = getConversation(conversationId, uid);
    if (!conversation) return;

    if (
      conversation.title &&
      conversation.title.trim() &&
      conversation.title.trim() !== "新对话"
    ) {
      return;
    }

    const history = getMessages(conversationId, uid);
    const firstUser = history.find((message) => message.role === "user");
    const firstAssistant = history.find(
      (message) => message.role === "assistant" && message.content?.trim()
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
    for (const endpoint of endpoints) {
      const endpointModels = getModels(endpoint.id, uid)
        .map((model) => String(model.model_id || "").trim())
        .filter(Boolean);
      const modelCandidates = [
        String(preferredModel || "").trim(),
        ...endpointModels,
        "gpt-4o-mini",
      ].filter(Boolean);
      const dedupedModels = [...new Set(modelCandidates)];
      const baseUrlCandidates = normalizeBaseUrlCandidates(endpoint.base_url);

      for (const baseURL of baseUrlCandidates) {
        for (const modelId of dedupedModels) {
          try {
            const client = new OpenAI({
              apiKey: endpoint.api_key,
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

            updateTitleIfUntitled(conversationId, uid, normalized);
            return;
          } catch (error) {
            sawSummaryFailure = true;
            const reason = getUpstreamErrorMessage(error);
            logger.warn(
              {
                route: "conversations.summarizeTitle",
                uid,
                conversationId,
                endpointName: endpoint.name,
                baseURL,
                modelId,
                reason,
              },
              "Title summary endpoint failed"
            );

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

router.post("/:id/chat", async (req, res) => {
  const { id } = req.params;
  const { message, model, images } = req.body;
  const uid = req.uid;
  const debug = Boolean(req.body?.debug);
  const generationConfig = normalizeGenerationConfig(req.body);
  const requestedModel = String(model || "").trim();
  const executionContext = createConversationExecutionContext(uid, id, res);
  const detachClientDisconnectAbort = bindClientDisconnectAbort(
    req,
    res,
    executionContext
  );
  let aiMessage = null;

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

    const conversation = getConversation(id, uid);
    if (!conversation) {
      res.write(`data: ${JSON.stringify({ error: "对话不存在或无权限" })}\n\n`);
      res.end();
      return;
    }

    let storedContent = String(message || "");
    if (images && images.length > 0) {
      storedContent +=
        "\n" + images.map((img) => `[IMAGE_DATA:${img}]`).join("\n");
    }
    addMessage(id, uid, "user", storedContent);

    const history = getMessages(id, uid).filter(m => !m.is_archived);
    const compactedState = await getConversationHistoryForExecution(
      uid,
      conversation,
      history
    );
    aiMessage = addMessage(id, uid, "assistant", "");
    const fullContent = conversation?.acp_agent_id
      ? await streamAcpConversation({
          uid,
          conversation,
          conversationId: id,
          message,
          images,
          history: compactedState.history,
          res,
          debug,
        })
      : await streamConversationAgent({
          uid,
          model: requestedModel,
          messages: buildConversationMessages(
            compactedState.history,
            buildConversationSystemPrompt(uid, conversation)
          ),
          res,
          conversationId: id,
          source: "chat",
          aiMsgId: aiMessage.id,
          debug,
          generationConfig,
          conversationContextWindow: conversation?.context_window ?? null,
          allowedToolNames: conversation?.tool_names ?? null,
          executionContext,
        });

    if (fullContent === false) {
      finalizeSse(res);
      return;
    }
    if (fullContent !== "_HANDLED_INTERNALLY_") {
      updateMessage(aiMessage.id, uid, fullContent);
    }

    finalizeSse(res);
  } catch (error) {
    logger.error(
      { err: error, route: "conversations.chat", uid, conversationId: id },
      "Chat request failed before stream completion"
    );
    if (aiMessage?.id) {
      updateMessage(
        aiMessage.id,
        uid,
        buildAssistantFailureContent("服务端在流式回复前异常中断。", {
          phase: "chat_route",
          error: error.message || "unknown_error",
        })
      );
    }
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      finalizeSse(res);
    }
  } finally {
    detachClientDisconnectAbort();
    clearConversationExecutionContext(uid, id);
  }
});

router.post("/:id/stop", async (req, res) => {
  const conversation = getConversation(req.params.id, req.uid);
  const stopped = stopConversationExecution(req.uid, req.params.id);

  if (conversation?.acp_agent_id) {
    const acpStopped = await cancelAcpConversation(req.uid, conversation);
    return res.json({
      ...stopped,
      acp_stopped: acpStopped.stopped,
      stopped: stopped.stopped || acpStopped.stopped,
    });
  }

  res.json(stopped);
});

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

router.post("/:id/regenerate", async (req, res) => {
  const { id } = req.params;
  const { model } = req.body;
  const uid = req.uid;
  const debug = Boolean(req.body?.debug);
  const generationConfig = normalizeGenerationConfig(req.body);
  const requestedModel = String(model || "").trim();
  const executionContext = createConversationExecutionContext(uid, id, res);
  const detachClientDisconnectAbort = bindClientDisconnectAbort(
    req,
    res,
    executionContext
  );
  let aiMessage = null;

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

    const history = getMessages(id, uid).filter(m => !m.is_archived);
    if (!history.length) {
      res.write(
        `data: ${JSON.stringify({ error: "没有可重新生成的消息" })}\n\n`
      );
      res.end();
      return;
    }

    const conversation = getConversation(id, uid);
    if (!conversation) {
      res.write(`data: ${JSON.stringify({ error: "对话不存在或无权限" })}\n\n`);
      finalizeSse(res);
      return;
    }
    const compactedState = await getConversationHistoryForExecution(
      uid,
      conversation,
      history
    );
    const systemPrompt = buildConversationSystemPrompt(uid, conversation);
    const messages = buildConversationMessages(compactedState.history, systemPrompt);
    aiMessage = addMessage(id, uid, "assistant", "");
    const lastUserMessage = [...history]
      .reverse()
      .find((message) => message.role === "user");
    const fullContent = conversation?.acp_agent_id
      ? await (() => {
          const payload = decomposeStoredUserContent(lastUserMessage?.content || "");
          if (!payload.message && payload.images.length === 0) {
            throw new Error("没有可重新生成的用户消息");
          }
          return streamAcpConversation({
            uid,
            conversation,
            conversationId: id,
            message: payload.message,
            images: payload.images,
            history: compactedState.history,
            res,
            debug,
          });
        })()
      : await streamConversationAgent({
          uid,
          model: requestedModel,
          messages,
          res,
          conversationId: id,
          source: "chat",
          aiMsgId: aiMessage.id,
          debug,
          generationConfig,
          conversationContextWindow: conversation?.context_window ?? null,
          allowedToolNames: conversation?.tool_names ?? null,
          executionContext,
        });

    if (fullContent === false) {
      finalizeSse(res);
      return;
    }
    if (fullContent !== "_HANDLED_INTERNALLY_") {
      updateMessage(aiMessage.id, uid, fullContent);
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
    if (aiMessage?.id) {
      updateMessage(
        aiMessage.id,
        uid,
        buildAssistantFailureContent("重新生成在服务端异常中断。", {
          phase: "regenerate_route",
          error: error.message || "unknown_error",
        })
      );
    }
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      finalizeSse(res);
    }
  } finally {
    detachClientDisconnectAbort();
    clearConversationExecutionContext(uid, id);
  }
});

router.put("/:id/messages/:msgId", async (req, res) => {
  const { id, msgId } = req.params;
  const { content, model } = req.body;
  const uid = req.uid;
  const debug = Boolean(req.body?.debug);
  const generationConfig = normalizeGenerationConfig(req.body);
  const requestedModel = String(model || "").trim();
  const executionContext = createConversationExecutionContext(uid, id, res);
  const detachClientDisconnectAbort = bindClientDisconnectAbort(
    req,
    res,
    executionContext
  );
  let aiMessage = null;

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
    const message = db
      .prepare(
        "SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND uid = ?"
      )
      .get(msgId, id, uid);
    if (!message) {
      res.write(`data: ${JSON.stringify({ error: "消息不存在" })}\n\n`);
      res.end();
      return;
    }

    db.prepare(
      "DELETE FROM messages WHERE conversation_id = ? AND uid = ? AND id > ?"
    ).run(id, uid, msgId);
    updateMessage(msgId, uid, content);

    const history = getMessages(id, uid).filter(m => !m.is_archived);
    const compactedState = await getConversationHistoryForExecution(
      uid,
      conversation,
      history
    );
    const systemPrompt = buildConversationSystemPrompt(uid, conversation);
    const messages = buildConversationMessages(compactedState.history, systemPrompt);
    aiMessage = addMessage(id, uid, "assistant", "");
    const lastUserMessage = [...history]
      .reverse()
      .find((item) => item.role === "user");
    const fullContent = conversation?.acp_agent_id
      ? await (() => {
          const payload = decomposeStoredUserContent(lastUserMessage?.content || "");
          if (!payload.message && payload.images.length === 0) {
            throw new Error("编辑后缺少可发送的用户消息");
          }
          return streamAcpConversation({
            uid,
            conversation,
            conversationId: id,
            message: payload.message,
            images: payload.images,
            history: compactedState.history,
            res,
            debug,
          });
        })()
      : await streamConversationAgent({
          uid,
          model: requestedModel,
          messages,
          res,
          conversationId: id,
          source: "chat",
          aiMsgId: aiMessage.id,
          debug,
          generationConfig,
          conversationContextWindow: conversation?.context_window ?? null,
          allowedToolNames: conversation?.tool_names ?? null,
          executionContext,
        });

    if (fullContent === false) {
      finalizeSse(res);
      return;
    }
    if (fullContent !== "_HANDLED_INTERNALLY_") {
      updateMessage(aiMessage.id, uid, fullContent);
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
    if (aiMessage?.id) {
      updateMessage(
        aiMessage.id,
        uid,
        buildAssistantFailureContent("编辑后重新生成在服务端异常中断。", {
          phase: "edit_regenerate_route",
          error: error.message || "unknown_error",
        })
      );
    }
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      finalizeSse(res);
    }
  } finally {
    detachClientDisconnectAbort();
    clearConversationExecutionContext(uid, id);
  }
});

export default router;
