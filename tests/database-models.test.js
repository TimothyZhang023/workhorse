import {
  createAcpAgent,
  createAgentTask,
  createApiKey,
  createEndpointGroup,
  createConversation,
  createUser,
  deleteAcpAgent,
  deleteEndpointGroup,
  createChannel,
  deleteChannel,
  getAcpAgent,
  getConversation,
  getDefaultEndpointGroup,
  getEndpointGroups,
  listChannels,
  listAcpAgents,
  listApiKeys,
  listAgentTasks,
  updateAcpAgent,
  updateAcpAgentLastUsedModel,
  revokeApiKey,
  updateConversationAcpModel,
  updateConversationAcpSession,
  updateChannel,
  updateAgentTask,
  updateEndpointGroup,
  verifyApiKey,
} from "../server/models/database.js";

describe("Database Models - Endpoint Groups", () => {
  it("creates, reads, updates and deletes endpoint groups correctly", () => {
    const user = createUser(`user_${Date.now()}`, "password123");

    const ep1 = createEndpointGroup(
      user.uid,
      "Group 1",
      "openai",
      "https://api.example.com",
      "key-123",
      true,
      true
    );
    expect(ep1.id).toBeGreaterThan(0);
    expect(ep1.name).toBe("Group 1");

    const groups = getEndpointGroups(user.uid);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Group 1");
    expect(groups[0].provider).toBe("openai");
    expect(groups[0].api_key).toBe("key-123"); // Assert decryption works

    updateEndpointGroup(
      ep1.id,
      user.uid,
      "Group 1 Updated",
      "openrouter",
      "https://api.updated.com",
      "key-456",
      false
    );

    let defaultGroup = getDefaultEndpointGroup(user.uid);
    expect(defaultGroup.name).toBe("Group 1 Updated");
    expect(defaultGroup.provider).toBe("openrouter");
    expect(defaultGroup.base_url).toBe("https://api.updated.com");
    expect(defaultGroup.api_key).toBe("key-456");
    expect(defaultGroup.use_preset_models).toBe(0);

    const ep2 = createEndpointGroup(
      user.uid,
      "Group 2",
      "gemini",
      "https://api2.example.com",
      "key-789",
      true,
      true
    );

    const allGroups = getEndpointGroups(user.uid);
    expect(allGroups).toHaveLength(2);

    defaultGroup = getDefaultEndpointGroup(user.uid);
    expect(defaultGroup.id).toBe(ep2.id);

    deleteEndpointGroup(ep1.id, user.uid);
    expect(getEndpointGroups(user.uid)).toHaveLength(1);
  });
});


describe("Database Models - Channels", () => {
  it("creates, updates and deletes channels", () => {
    const user = createUser(`user_${Date.now()}_channel`, "password123");

    const channel = createChannel(user.uid, {
      name: "Ops Telegram",
      platform: "telegram",
      bot_token: "bot-token",
      metadata: { room: "ops" },
      is_enabled: 1,
    });

    expect(channel.id).toBeGreaterThan(0);

    const channels = listChannels(user.uid);
    expect(channels).toHaveLength(1);
    expect(channels[0].metadata.room).toBe("ops");
    expect(channels[0].agent_prompt).toBe("");

    updateChannel(channel.id, user.uid, {
      is_enabled: 0,
      name: "Ops TG",
      agent_prompt: "只处理告警消息",
    });
    const updated = listChannels(user.uid)[0];
    expect(updated.name).toBe("Ops TG");
    expect(updated.is_enabled).toBe(0);
    expect(updated.agent_prompt).toBe("只处理告警消息");

    deleteChannel(channel.id, user.uid);
    expect(listChannels(user.uid)).toHaveLength(0);
  });
});

describe("Database Models - ACP Agents", () => {
  it("creates ACP agents, persists prompts, and prefers last used model for new conversations", () => {
    const user = createUser(`user_${Date.now()}_acp`, "password123");

    const agent = createAcpAgent(user.uid, {
      name: "OpenCode Main",
      preset: "opencode",
      command: "opencode",
      args: ["acp"],
      env: {
        OPENCODE_API_KEY: "test-key",
      },
      agent_prompt: "优先走工程执行路径",
      default_model_id: "test-model",
      is_enabled: 1,
    });

    expect(agent.id).toBeGreaterThan(0);
    expect(agent.env_keys).toEqual(["OPENCODE_API_KEY"]);
    expect(agent.default_model_id).toBe("test-model");

    const listed = listAcpAgents(user.uid);
    expect(listed).toHaveLength(1);
    expect(listed[0].preset).toBe("opencode");
    expect(listed[0].has_env).toBe(true);
    expect(listed[0].default_model_id).toBe("test-model");
    expect(listed[0].agent_prompt).toBe("优先走工程执行路径");

    const detailed = getAcpAgent(agent.id, user.uid, { includeSecrets: true });
    expect(detailed.env.OPENCODE_API_KEY).toBe("test-key");
    expect(detailed.agent_prompt).toBe("优先走工程执行路径");

    updateAcpAgent(agent.id, user.uid, {
      agent_prompt: "保持简洁直接",
      default_model_id: "gpt-5",
    });
    updateAcpAgentLastUsedModel(agent.id, user.uid, "o4-mini");

    const updatedAgent = getAcpAgent(agent.id, user.uid, {
      includeSecrets: true,
    });
    expect(updatedAgent.agent_prompt).toBe("保持简洁直接");
    expect(updatedAgent.default_model_id).toBe("gpt-5");
    expect(updatedAgent.last_used_model_id).toBe("o4-mini");

    const fallbackConversation = createConversation(user.uid, "ACP 默认模型", null, {
      acpAgentId: agent.id,
    });
    expect(fallbackConversation.acp_model_id).toBe("o4-mini");

    const conversation = createConversation(user.uid, "ACP 会话", null, {
      acpAgentId: agent.id,
      acpModelId: "session-model",
      systemPrompt: "会话级补充提示词",
    });
    expect(conversation.acp_agent_id).toBe(agent.id);
    expect(conversation.acp_model_id).toBe("session-model");
    expect(conversation.system_prompt).toBe("会话级补充提示词");

    updateConversationAcpSession(conversation.id, user.uid, "session-123");
    updateConversationAcpModel(conversation.id, user.uid, "other-model");
    const updatedConversation = getConversation(conversation.id, user.uid);
    expect(updatedConversation.acp_session_id).toBe("session-123");
    expect(updatedConversation.acp_model_id).toBe("other-model");

    deleteAcpAgent(agent.id, user.uid);
    expect(listAcpAgents(user.uid)).toHaveLength(0);
    expect(getConversation(conversation.id, user.uid).acp_agent_id).toBeNull();
    expect(getConversation(conversation.id, user.uid).acp_model_id).toBeNull();
  });
});

describe("Database Models - Agent Tasks", () => {
  it("persists ACP agent binding for orchestrated tasks", () => {
    const user = createUser(`user_${Date.now()}_task_binding`, "password123");
    const agent = createAcpAgent(user.uid, {
      name: "Task ACP",
      preset: "opencode",
      command: "opencode",
      args: ["acp"],
      env: {},
      is_enabled: 1,
    });

    const task = createAgentTask(
      user.uid,
      "绑定 ACP 的任务",
      "",
      "执行一次外部 agent 调研",
      [],
      [],
      "",
      agent.id
    );

    expect(task.acp_agent_id).toBe(agent.id);
    expect(listAgentTasks(user.uid)[0].acp_agent_id).toBe(agent.id);

    updateAgentTask(task.id, user.uid, {
      acp_agent_id: null,
    });

    expect(listAgentTasks(user.uid)[0].acp_agent_id).toBeNull();
  });
});
