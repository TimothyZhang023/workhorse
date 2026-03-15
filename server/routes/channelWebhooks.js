import { Router } from "express";
import { createConversation, getChannelById } from "../models/database.js";
import {
  appendChannelEvent,
  getChannelSessionBinding,
  setChannelSessionBinding,
} from "../models/channelRuntime.js";
import { runConversationMessage } from "./conversations.js";

const router = Router();

function buildDingtalkText(content) {
  return {
    msgtype: "text",
    text: {
      content,
    },
  };
}

function buildTelegramDelivery(chatId, text) {
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

function getOrCreateChannelConversation(uid, channel, participantKey, titleHint) {
  const binding = getChannelSessionBinding(uid, channel.id, participantKey);
  if (binding?.conversationId) {
    return String(binding.conversationId);
  }

  const conversation = createConversation(
    uid,
    `${channel.name} · ${titleHint || participantKey}`,
    null,
    { channelId: channel.id }
  );
  setChannelSessionBinding(uid, channel.id, participantKey, conversation.id);
  return String(conversation.id);
}

async function handleIncomingChannelMessage({
  uid,
  channel,
  platform,
  participantKey,
  participantLabel,
  messageText,
  replyTarget,
  rawPayload,
}) {
  const inboundLogPath = appendChannelEvent(uid, channel.id, {
    direction: "inbound",
    platform,
    participant_key: participantKey,
    participant_label: participantLabel,
    message_text: messageText,
    payload: rawPayload,
  });

  const conversationId = getOrCreateChannelConversation(
    uid,
    channel,
    participantKey,
    participantLabel
  );

  const runResult = await runConversationMessage({
    uid,
    conversationId,
    message: messageText,
    source: `${platform}_channel`,
  });

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

router.post("/dingtalk/:channelId", async (req, res) => {
  try {
    const channelId = Number(req.params.channelId);
    if (!Number.isInteger(channelId) || channelId <= 0) {
      return res.status(400).json(buildDingtalkText("无效的 channelId。"));
    }

    const uid = String(req.query.uid || req.body?.uid || "local");
    const channel = getChannelById(channelId, uid);
    ensureEnabledChannel(channel, "dingtalk");

    const incomingText = ensureTextMessage(
      req.body?.text?.content || req.body?.content || req.body?.msg || req.body?.message
    );
    const participantKey = String(
      req.body?.senderStaffId ||
        req.body?.senderId ||
        req.body?.conversationId ||
        req.body?.chatId ||
        "anonymous"
    );
    const participantLabel = String(
      req.body?.senderNick ||
        req.body?.senderStaffId ||
        req.body?.senderId ||
        participantKey
    );

    const result = await handleIncomingChannelMessage({
      uid,
      channel,
      platform: "dingtalk",
      participantKey,
      participantLabel,
      messageText: incomingText,
      replyTarget: {
        conversationId: req.body?.conversationId || null,
        sessionWebhook: req.body?.sessionWebhook || null,
      },
      rawPayload: req.body,
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

    const incomingText = ensureTextMessage(
      req.body?.message?.text ||
        req.body?.edited_message?.text ||
        req.body?.text ||
        req.body?.message
    );
    const chatId =
      req.body?.message?.chat?.id ||
      req.body?.edited_message?.chat?.id ||
      req.body?.chat_id;
    const senderId =
      req.body?.message?.from?.id ||
      req.body?.edited_message?.from?.id ||
      req.body?.from?.id ||
      chatId ||
      "anonymous";
    const participantKey = String(senderId);
    const participantLabel = String(
      req.body?.message?.from?.username ||
        req.body?.edited_message?.from?.username ||
        req.body?.message?.from?.first_name ||
        participantKey
    );

    const result = await handleIncomingChannelMessage({
      uid,
      channel,
      platform: "telegram",
      participantKey,
      participantLabel,
      messageText: incomingText,
      replyTarget: {
        chatId,
      },
      rawPayload: req.body,
    });

    return res.json(buildTelegramDelivery(chatId, result.finalResponse));
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

export default router;
