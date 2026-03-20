import { describe, expect, it } from "vitest";

import {
  createAcpAgent,
  createChannel,
  createConversation,
  createUser,
  setAppSetting,
} from "../server/models/database.js";
import { buildConversationSystemPrompt } from "../server/models/agentConversation.js";

describe("workspace agent prompts", () => {
  it("injects main, channel, and ACP agent prompts into conversation system prompts", () => {
    const user = createUser(`agent_prompt_${Date.now()}`, "password123");

    setAppSetting(user.uid, "main_agent_prompt", "你是 main agent。");
    const mainConversation = createConversation(user.uid, "main", null, {});
    expect(buildConversationSystemPrompt(user.uid, mainConversation)).toContain(
      "你是 main agent。"
    );

    const channel = createChannel(user.uid, {
      name: "telegram",
      platform: "telegram",
      agent_prompt: "你是渠道 agent。",
      is_enabled: 1,
    });
    const channelConversation = createConversation(user.uid, "channel", null, {
      channelId: channel.id,
    });
    expect(
      buildConversationSystemPrompt(user.uid, channelConversation)
    ).toContain("你是渠道 agent。");

    const acpAgent = createAcpAgent(user.uid, {
      name: "acp",
      preset: "opencode",
      command: "opencode",
      args: ["acp"],
      env: {},
      agent_prompt: "你是 ACP agent。",
      is_enabled: 1,
    });
    const acpConversation = createConversation(user.uid, "acp", null, {
      acpAgentId: acpAgent.id,
    });
    expect(buildConversationSystemPrompt(user.uid, acpConversation)).toContain(
      "你是 ACP agent。"
    );
  });
});
