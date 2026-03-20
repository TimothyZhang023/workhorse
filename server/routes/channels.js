import { Router } from "express";

import {
  createChannel,
  deleteChannel,
  listChannels,
  updateChannel,
} from "../models/database.js";
import {
  getChannelListenerState,
  refreshSingleChannelListener,
  syncChannelListenersForUid,
} from "../models/channelRunner.js";

const router = Router();


const CHANNEL_EXTENSION_CATALOG = {
  dingtalk: {
    platform: "dingtalk",
    name: "DingTalk Bot",
    metadata: {
      docs: "https://open-dingtalk.github.io/developerpedia/docs/learn/bot/stream/bot-stream-overview/",
      connection_modes: ["stream"],
      default_connection_mode: "stream",
      required_credentials: ["client_id", "client_secret"],
      supported_events: ["task.run.completed", "task.run.failed"],
    },
  },
  wecom: {
    platform: "wecom",
    name: "WeCom Bot",
    metadata: {
      docs: "https://developer.work.weixin.qq.com/document/path/91770",
      supported_events: ["task.run.completed", "task.run.failed", "cron.tick"],
    },
  },
  telegram: {
    platform: "telegram",
    name: "Telegram Bot",
    metadata: {
      docs: "https://core.telegram.org/bots/api",
      connection_modes: ["polling", "webhook"],
      default_connection_mode: "polling",
      required_credentials: ["bot_token"],
      supported_events: ["task.run.completed", "task.run.failed", "agent.alert"],
    },
  },
  discord: {
    platform: "discord",
    name: "Discord Webhook",
    metadata: {
      docs: "https://discord.com/developers/docs/resources/webhook",
      supported_events: ["task.run.completed", "task.run.failed"],
    },
  },
};

router.get("/extensions", (req, res) => {
  res.json(Object.values(CHANNEL_EXTENSION_CATALOG));
});

router.post("/extensions/:platform/install", (req, res) => {
  try {
    const template = CHANNEL_EXTENSION_CATALOG[req.params.platform];
    if (!template) {
      return res.status(404).json({ error: "Unsupported channel extension" });
    }

    const channel = createChannel(req.uid, {
      name: req.body?.name || template.name,
      platform: template.platform,
      webhook_url: req.body?.webhook_url,
      bot_token: req.body?.bot_token,
      metadata: {
        ...template.metadata,
        ...(req.body?.metadata || {}),
      },
      agent_prompt: req.body?.agent_prompt,
      is_enabled: req.body?.is_enabled ?? 1,
    });
    refreshSingleChannelListener(req.uid, channel.id);

    res.json({
      extension: template,
      channel,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/", (req, res) => {
  try {
    res.json(
      listChannels(req.uid).map((channel) => ({
        ...channel,
        listener_state: getChannelListenerState(req.uid, channel.id),
      }))
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/", (req, res) => {
  try {
    const {
      name,
      platform,
      agent_prompt,
      webhook_url,
      bot_token,
      metadata,
      is_enabled,
    } =
      req.body || {};
    if (!name || !platform) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const channel = createChannel(req.uid, {
      name,
      platform,
      agent_prompt,
      webhook_url,
      bot_token,
      metadata,
      is_enabled,
    });
    refreshSingleChannelListener(req.uid, channel.id);

    res.json(channel);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/:id", (req, res) => {
  try {
    const channelId = Number(req.params.id);
    updateChannel(channelId, req.uid, req.body || {});
    refreshSingleChannelListener(req.uid, channelId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    const channelId = Number(req.params.id);
    deleteChannel(channelId, req.uid);
    syncChannelListenersForUid(req.uid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
