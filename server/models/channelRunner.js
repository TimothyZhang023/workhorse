import {
  getChannelById,
  getOrCreateLocalUser,
  listChannels,
} from "./database.js";
import { logger } from "../utils/logger.js";
import {
  handleIncomingChannelMessage,
  normalizeDingtalkInboundPayload,
  normalizeTelegramInboundPayload,
  sendDingtalkSessionMessage,
  sendTelegramTextMessage,
} from "../routes/channelWebhooks.js";

const activeChannelRunners = new Map();

function setRunnerState(controller, patch = {}) {
  controller.state = {
    status: controller.state?.status || "idle",
    lastError: controller.state?.lastError || "",
    updatedAt: controller.state?.updatedAt || "",
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

function getRunnerKey(uid, channelId) {
  return `${String(uid)}:${String(channelId)}`;
}

function getChannelSignature(channel) {
  return JSON.stringify({
    id: channel.id,
    is_enabled: channel.is_enabled,
    platform: channel.platform,
    webhook_url: channel.webhook_url || null,
    bot_token: channel.bot_token || null,
    metadata: channel.metadata || null,
  });
}

function scheduleReconnect(controller, fn, delay = 5000) {
  if (controller.stopped) return;
  setRunnerState(controller, {
    status: "reconnecting",
  });
  clearTimeout(controller.timer);
  controller.retryDelay = Math.min(
    Math.max(Number(controller.retryDelay) || delay, delay) * 2,
    60000
  );
  controller.timer = setTimeout(() => {
    fn().catch((error) => {
      logger.warn(
        { err: error, channelId: controller.channel.id, platform: controller.channel.platform },
        "Channel listener reconnect failed"
      );
      scheduleReconnect(controller, fn, controller.retryDelay);
    });
  }, controller.retryDelay);
}

function scheduleNextTick(controller, fn, delay = 1000) {
  if (controller.stopped) return;
  clearTimeout(controller.timer);
  controller.timer = setTimeout(() => {
    fn().catch((error) => {
      logger.warn(
        { err: error, channelId: controller.channel.id, platform: controller.channel.platform },
        "Scheduled channel tick failed"
      );
      scheduleReconnect(controller, fn, delay);
    });
  }, delay);
}

async function deliverChannelResponse(channel, replyTarget, text) {
  if (channel.platform === "dingtalk") {
    const sessionWebhook = replyTarget?.sessionWebhook;
    if (!sessionWebhook) {
      logger.warn({ channelId: channel.id }, "Missing dingtalk sessionWebhook for delivery");
      return null;
    }
    return sendDingtalkSessionMessage(sessionWebhook, text);
  }

  if (channel.platform === "telegram") {
    const chatId = replyTarget?.chatId;
    if (!chatId) {
      logger.warn({ channelId: channel.id }, "Missing telegram chatId for delivery");
      return null;
    }
    return sendTelegramTextMessage(channel.bot_token, chatId, text);
  }

  return null;
}

async function processChannelPayload({ uid, channel, platform, payload }) {
  const normalized =
    platform === "dingtalk"
      ? normalizeDingtalkInboundPayload(payload)
      : normalizeTelegramInboundPayload(payload);

  const result = await handleIncomingChannelMessage({
    uid,
    channel,
    platform,
    ...normalized,
  });

  await deliverChannelResponse(channel, normalized.replyTarget, result.finalResponse);
  return result;
}

async function registerTelegramWebhook(channel) {
  const webhookUrl = String(channel.webhook_url || "").trim();
  if (!webhookUrl) {
    throw new Error("Telegram webhook 模式缺少 webhook_url");
  }

  const secretToken = String(channel.metadata?.secret_token || "").trim();
  const response = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(channel.bot_token)}/setWebhook`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: webhookUrl,
        ...(secretToken ? { secret_token: secretToken } : {}),
      }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.description || `Telegram setWebhook 失败 (${response.status})`);
  }
}

async function deleteTelegramWebhook(botToken) {
  if (!botToken) return;
  const response = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(botToken)}/deleteWebhook`,
    {
      method: "POST",
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.description || `Telegram deleteWebhook 失败 (${response.status})`);
  }
}

function startTelegramRunner(uid, channel) {
  const controller = {
    uid,
    channel,
    stopped: false,
    timer: null,
    offset: 0,
    retryDelay: 1000,
    state: {
      status: "starting",
      lastError: "",
      updatedAt: new Date().toISOString(),
    },
    stop() {
      controller.stopped = true;
      clearTimeout(controller.timer);
      setRunnerState(controller, { status: "stopped" });
    },
  };

  const connectionMode = String(channel.metadata?.connection_mode || "polling");

  if (connectionMode === "webhook") {
    registerTelegramWebhook(channel)
      .then(() => {
        setRunnerState(controller, { status: "webhook_active", lastError: "" });
        logger.info({ channelId: channel.id }, "Telegram webhook registered");
      })
      .catch((error) => {
        setRunnerState(controller, { status: "error", lastError: error.message });
        logger.warn({ err: error, channelId: channel.id }, "Telegram webhook registration failed");
      });
    return controller;
  }

  const poll = async () => {
    if (controller.stopped) return;

    try {
      if (!controller.offset) {
        await deleteTelegramWebhook(channel.bot_token).catch(() => {});
      }

      setRunnerState(controller, { status: "polling", lastError: "" });
      const response = await fetch(
        `https://api.telegram.org/bot${encodeURIComponent(channel.bot_token)}/getUpdates`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            timeout: 20,
            offset: controller.offset || undefined,
            allowed_updates: ["message", "edited_message"],
          }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.description || `Telegram getUpdates 失败 (${response.status})`);
      }

      for (const update of Array.isArray(data.result) ? data.result : []) {
        controller.offset = Number(update.update_id) + 1;
        await processChannelPayload({
          uid,
          channel,
          platform: "telegram",
          payload: update,
        });
      }

      controller.retryDelay = 1000;
      setRunnerState(controller, { status: "polling", lastError: "" });
      scheduleNextTick(controller, poll, 1000);
    } catch (error) {
      setRunnerState(controller, { status: "error", lastError: error.message });
      logger.warn({ err: error, channelId: channel.id }, "Telegram polling failed");
      scheduleReconnect(controller, poll, 4000);
    }
  };

  poll().catch((error) => {
    logger.warn({ err: error, channelId: channel.id }, "Telegram runner boot failed");
  });
  return controller;
}

async function openDingtalkStreamConnection(channel) {
  const clientId = String(channel.metadata?.client_id || "").trim();
  const clientSecret = String(channel.metadata?.client_secret || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("DingTalk Stream Mode 缺少 client_id 或 client_secret");
  }

  const response = await fetch("https://api.dingtalk.com/v1.0/gateway/connections/open", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      clientId,
      clientSecret,
      subscriptions: [
        {
          topic: "/v1.0/im/bot/messages/get",
          type: "CALLBACK",
        },
      ],
      ua: "workhorse/2.0",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.endpoint || !data?.ticket) {
    throw new Error(data?.message || `DingTalk stream open failed (${response.status})`);
  }
  return data;
}

function buildDingtalkAckFrame(message = {}, dataPayload = { response: null }) {
  return JSON.stringify({
    code: 200,
    message: "OK",
    headers: {
      messageId: message?.headers?.messageId,
      contentType: "application/json",
    },
    data: JSON.stringify(dataPayload),
  });
}

function startDingtalkRunner(uid, channel) {
  const controller = {
    uid,
    channel,
    stopped: false,
    timer: null,
    socket: null,
    retryDelay: 4000,
    state: {
      status: "starting",
      lastError: "",
      updatedAt: new Date().toISOString(),
    },
    stop() {
      controller.stopped = true;
      clearTimeout(controller.timer);
      setRunnerState(controller, { status: "stopped" });
      if (controller.socket && controller.socket.readyState === 1) {
        controller.socket.close();
      }
    },
  };

  const connect = async () => {
    if (controller.stopped) return;
    const { endpoint, ticket } = await openDingtalkStreamConnection(channel);
    if (typeof WebSocket === "undefined") {
      throw new Error("Current Node runtime does not provide WebSocket");
    }

    const ws = new WebSocket(`${endpoint}?ticket=${encodeURIComponent(ticket)}`);
    controller.socket = ws;
    controller.retryDelay = 4000;
    ws.onopen = () => {
      setRunnerState(controller, { status: "stream_active", lastError: "" });
    };

    ws.onmessage = (event) => {
      const raw = String(event.data || "");
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }

      try {
        const systemTopic = payload?.headers?.topic || payload?.topic || "";
        if (systemTopic === "disconnect") {
          return;
        }
        const ackPayload =
          systemTopic === "ping"
            ? {
                opaque: JSON.parse(payload?.data || "{}")?.opaque || "",
              }
            : { response: null };
        ws.send(buildDingtalkAckFrame(payload, ackPayload));
      } catch (error) {
        logger.warn({ err: error, channelId: channel.id }, "Failed to ack dingtalk frame");
      }

      const topic =
        payload?.headers?.topic ||
        payload?.topic ||
        payload?.type ||
        "";
      if (!String(topic).includes("/v1.0/im/bot/messages/get")) {
        return;
      }

      const body =
        typeof payload?.data === "string"
          ? JSON.parse(payload.data)
          : payload?.data || {};

      processChannelPayload({
        uid,
        channel,
        platform: "dingtalk",
        payload: body,
      }).catch((error) => {
        logger.warn({ err: error, channelId: channel.id }, "Failed to process dingtalk stream event");
      });
    };

    ws.onerror = (error) => {
      setRunnerState(controller, {
        status: "error",
        lastError: error?.message || "socket error",
      });
      logger.warn({ err: error, channelId: channel.id }, "DingTalk stream socket error");
    };

    ws.onclose = () => {
      if (controller.stopped) return;
      scheduleReconnect(controller, connect, 4000);
    };
  };

  connect().catch((error) => {
    setRunnerState(controller, { status: "error", lastError: error.message });
    logger.warn({ err: error, channelId: channel.id }, "DingTalk runner boot failed");
    scheduleReconnect(controller, connect, 4000);
  });

  return controller;
}

function startChannelRunner(uid, channel) {
  if (channel.platform === "telegram") {
    return startTelegramRunner(uid, channel);
  }

  const connectionMode = String(channel.metadata?.connection_mode || "");
  if (channel.platform === "dingtalk" && connectionMode === "stream") {
    return startDingtalkRunner(uid, channel);
  }

  return null;
}

export function syncChannelListenersForUid(uid) {
  const channels = listChannels(uid).filter((channel) => Number(channel.is_enabled) === 1);
  const desiredKeys = new Set();

  for (const channel of channels) {
    const key = getRunnerKey(uid, channel.id);
    desiredKeys.add(key);
    const signature = getChannelSignature(channel);
    const existing = activeChannelRunners.get(key);
    if (existing && existing.signature === signature) {
      continue;
    }

    if (existing) {
      existing.controller.stop();
      activeChannelRunners.delete(key);
    }

    const controller = startChannelRunner(uid, channel);
    if (controller) {
      activeChannelRunners.set(key, { signature, controller });
    }
  }

  for (const [key, entry] of activeChannelRunners.entries()) {
    if (!key.startsWith(`${String(uid)}:`)) continue;
    if (desiredKeys.has(key)) continue;
    entry.controller.stop();
    activeChannelRunners.delete(key);
  }
}

export function bootstrapChannelListeners() {
  const localUser = getOrCreateLocalUser();
  syncChannelListenersForUid(localUser.uid);
}

export function getChannelListenerState(uid, channelId) {
  const entry = activeChannelRunners.get(getRunnerKey(uid, channelId));
  if (!entry) return null;
  return {
    active: true,
    platform: entry.controller.channel.platform,
    channelId,
    ...entry.controller.state,
  };
}

export function refreshSingleChannelListener(uid, channelId) {
  const channel = getChannelById(channelId, uid);
  if (!channel) {
    const key = getRunnerKey(uid, channelId);
    const existing = activeChannelRunners.get(key);
    if (existing) {
      existing.controller.stop();
      activeChannelRunners.delete(key);
    }
    return;
  }
  syncChannelListenersForUid(uid);
}
