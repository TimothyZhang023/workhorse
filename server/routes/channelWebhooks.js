import { Router } from "express";
import { createConversation, getChannelById } from "../models/database.js";
import {
  appendChannelEvent,
  getChannelSessionBinding,
  setChannelSessionBinding,
} from "../models/channelRuntime.js";
import { runConversationMessage } from "./conversations.js";

const router = Router();

export function buildDingtalkText(content) {
  return {
    msgtype: "text",
    text: {
      content,
    },
  };
}

export function buildTelegramDelivery(chatId, text) {
  return {
    ok: true,
    method: "sendMessage",
    result: {
      chat_id: chatId,
      text,
    },
  };
}

function ensureEnabledChannel(channel, expectedPlatform) {
  if (!channel) {
    throw new Error("未找到对应通道。");
  }
  if (channel.platform !== expectedPlatform) {
    throw new Error(`该通道不是 ${expectedPlatform} 类型。`);
  }
  if (!channel.is_enabled) {
    throw new Error("该通道已禁用。");
  }
}

function ensureTextMessage(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    throw new Error("未检测到可执行的文本消息。");
  }
  return normalized;
}

function parseChannelCommand(messageText) {
  const normalized = String(messageText || "").trim();
  if (!normalized.startsWith("/")) {
    return { command: "", payload: normalized };
  }

  const [commandToken, ...rest] = normalized.split(/\s+/);
  return {
    command: commandToken.toLowerCase(),
    payload: rest.join(" ").trim(),
  };
}

function createChannelConversation(uid, channel, participantKey, titleHint) {
  const conversation = createConversation(
    uid,
    `${channel.name} · ${titleHint || participantKey}`,
    null,
    { channelId: channel.id }
  );
  setChannelSessionBinding(uid, channel.id, participantKey, conversation.id);
  return String(conversation.id);
}

function getOrCreateChannelConversation(uid, channel, participantKey, titleHint) {
  const binding = getChannelSessionBinding(uid, channel.id, participantKey);
  if (binding?.conversationId) {
    setChannelSessionBinding(uid, channel.id, participantKey, binding.conversationId);
    return String(binding.conversationId);
  }

  return createChannelConversation(uid, channel, participantKey, titleHint);
}

export async function sendDingtalkSessionMessage(sessionWebhook, text) {
  const targetUrl = String(sessionWebhook || "").trim();
  if (!targetUrl) {
    throw new Error("缺少钉钉 sessionWebhook，无法回传消息。");
  }

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildDingtalkText(text)),
  });

  if (!response.ok) {
    throw new Error(`钉钉消息回传失败 (${response.status})`);
  }

  return response.json().catch(() => ({ ok: true }));
}

export async function sendTelegramTextMessage(botToken, chatId, text) {
  const token = String(botToken || "").trim();
  if (!token) {
    throw new Error("缺少 Telegram Bot Token，无法回传消息。");
  }

  const targetChatId = String(chatId || "").trim();
  if (!targetChatId) {
    throw new Error("缺少 Telegram chat_id，无法回传消息。");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: targetChatId,
      text,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.description || `Telegram 消息回传失败 (${response.status})`);
  }

  return data;
}

export async function handleIncomingChannelMessage({
  uid,
  channel,
  platform,
  participantKey,
  participantLabel,
  messageText,
  replyTarget,
  rawPayload,
}) {
  const parsedCommand = parseChannelCommand(messageText);
  const inboundLogPath = appendChannelEvent(uid, channel.id, {
    direction: "inbound",
    platform,
    participant_key: participantKey,
    participant_label: participantLabel,
    message_text: messageText,
    command: parsedCommand.command || null,
    payload: rawPayload,
  });

  let conversationId = getOrCreateChannelConversation(
    uid,
    channel,
    participantKey,
    participantLabel
  );

  if (parsedCommand.command === "/new") {
    conversationId = createChannelConversation(
      uid,
      channel,
      participantKey,
      participantLabel
    );
    if (!parsedCommand.payload) {
      const outboundText = `已创建新会话 #${conversationId}，请继续发送消息。`;
      const outboundLogPath = appendChannelEvent(uid, channel.id, {
        direction: "outbound",
        platform,
        participant_key: participantKey,
        participant_label: participantLabel,
        conversation_id: conversationId,
        assistant_message_id: null,
        message_text: outboundText,
        delivery_target: replyTarget,
      });

      return {
        conversationId,
        assistantMessageId: null,
        finalResponse: outboundText,
        inboundLogPath,
        outboundLogPath,
      };
    }
  }

  const runResult = await runConversationMessage({
    uid,
    conversationId,
    message: parsedCommand.payload || messageText,
    source: `${platform}_channel`,
  });

  setChannelSessionBinding(uid, channel.id, participantKey, runResult.conversationId);

  const outboundText = runResult.finalResponse || "Agent 未生成可返回内容。";
  const outboundLogPath = appendChannelEvent(uid, channel.id, {
    direction: "outbound",
    platform,
    participant_key: participantKey,
    participant_label: participantLabel,
    conversation_id: runResult.conversationId,
    assistant_message_id: runResult.assistantMessageId,
    message_text: outboundText,
    delivery_target: replyTarget,
  });

  return {
    conversationId: runResult.conversationId,
    assistantMessageId: runResult.assistantMessageId,
    finalResponse: outboundText,
    inboundLogPath,
    outboundLogPath,
  };
}

export function normalizeDingtalkInboundPayload(body = {}) {
  const incomingText = ensureTextMessage(
    body?.text?.content || body?.content || body?.msg || body?.message
  );
  const participantKey = String(
    body?.senderStaffId ||
      body?.senderId ||
      body?.conversationId ||
      body?.chatId ||
      "anonymous"
  );
  const participantLabel = String(
    body?.senderNick || body?.senderStaffId || body?.senderId || participantKey
  );

  return {
    participantKey,
    participantLabel,
    messageText: incomingText,
    replyTarget: {
      conversationId: body?.conversationId || null,
      sessionWebhook: body?.sessionWebhook || null,
    },
    rawPayload: body,
  };
}

export function normalizeTelegramInboundPayload(body = {}) {
  const incomingText = ensureTextMessage(
    body?.message?.text ||
      body?.edited_message?.text ||
      body?.text ||
      body?.message
  );
  const chatId =
    body?.message?.chat?.id || body?.edited_message?.chat?.id || body?.chat_id;
  const senderId =
    body?.message?.from?.id ||
    body?.edited_message?.from?.id ||
    body?.from?.id ||
    chatId ||
    "anonymous";
  const participantKey = String(senderId);
  const participantLabel = String(
    body?.message?.from?.username ||
      body?.edited_message?.from?.username ||
      body?.message?.from?.first_name ||
      participantKey
  );

  return {
    participantKey,
    participantLabel,
    messageText: incomingText,
    replyTarget: {
      chatId,
    },
    rawPayload: body,
  };
}

router.post("/dingtalk/:channelId", async (req, res) => {
  try {
    const channelId = Number(req.params.channelId);
    if (!Number.isInteger(channelId) || channelId <= 0) {
      return res.status(400).json(buildDingtalkText("无效的 channelId。"));
    }

    const uid = String(req.query.uid || req.body?.uid || "local");
    const channel = getChannelById(channelId, uid);
    ensureEnabledChannel(channel, "dingtalk");
    const normalizedPayload = normalizeDingtalkInboundPayload(req.body);

    const result = await handleIncomingChannelMessage({
      uid,
      channel,
      platform: "dingtalk",
      ...normalizedPayload,
    });

    return res.json(
      buildDingtalkText(
        [
          result.finalResponse,
          "",
          `[mock-delivery] conversation=${result.conversationId}`,
        ].join("\n")
      )
    );
  } catch (error) {
    return res.status(500).json(buildDingtalkText(`执行失败: ${error.message}`));
  }
});

router.post("/telegram/:channelId", async (req, res) => {
  try {
    const channelId = Number(req.params.channelId);
    if (!Number.isInteger(channelId) || channelId <= 0) {
      return res.status(400).json({ ok: false, error: "无效的 channelId。" });
    }

    const uid = String(req.query.uid || req.body?.uid || "local");
    const channel = getChannelById(channelId, uid);
    ensureEnabledChannel(channel, "telegram");
    const expectedSecret = String(channel.metadata?.secret_token || "").trim();
    const providedSecret = String(
      req.headers["x-telegram-bot-api-secret-token"] || ""
    ).trim();
    if (expectedSecret && expectedSecret !== providedSecret) {
      return res.status(401).json({ ok: false, error: "telegram secret token 校验失败" });
    }
    const normalizedPayload = normalizeTelegramInboundPayload(req.body);

    const result = await handleIncomingChannelMessage({
      uid,
      channel,
      platform: "telegram",
      ...normalizedPayload,
    });

    return res.json(
      buildTelegramDelivery(
        normalizedPayload.replyTarget.chatId,
        result.finalResponse
      )
    );
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

export default router;
