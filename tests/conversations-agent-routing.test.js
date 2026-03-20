import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addMessage, getOrCreateLocalUser } from "../server/models/database.js";

const streamConversationAgentMock = vi.fn();
const streamAcpConversationMock = vi.fn();
const getConversationAcpModelsMock = vi.fn();
const setConversationAcpModelMock = vi.fn();

vi.mock("../server/models/agentConversation.js", async () => {
  const actual = await vi.importActual("../server/models/agentConversation.js");
  return {
    ...actual,
    streamConversationAgent: streamConversationAgentMock,
  };
});

vi.mock("../server/models/acpAgentManager.js", async () => {
  const actual = await vi.importActual("../server/models/acpAgentManager.js");
  return {
    ...actual,
    streamAcpConversation: streamAcpConversationMock,
    getConversationAcpModels: getConversationAcpModelsMock,
    setConversationAcpModel: setConversationAcpModelMock,
    cancelAcpConversation: vi.fn(async () => ({ stopped: true })),
  };
});

describe("conversation agent routing", () => {
  let app;
  let authToken;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    const { createApp } = await import("../server/app.js");
    app = createApp();
    authToken = "local-mode-token";
  });

  it("passes conversation tool restrictions into the agent runtime", async () => {
    streamConversationAgentMock.mockResolvedValueOnce("runtime result");

    const createRes = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        title: "agent runtime tools",
        tool_names: ["shell_execute"],
      })
      .expect(200);

    const conversationId = String(createRes.body.id);

    await request(app)
      .post(`/api/conversations/${conversationId}/chat`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ message: "hello runtime" })
      .expect(200);

    expect(streamConversationAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId,
        allowedToolNames: ["shell_execute"],
      })
    );
  });

  it("routes ACP-bound conversations into the ACP runtime", async () => {
    streamAcpConversationMock.mockResolvedValueOnce("acp result");

    const createRes = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        title: "acp runtime",
        acp_agent_id: 9,
      })
      .expect(200);

    const conversationId = String(createRes.body.id);

    await request(app)
      .post(`/api/conversations/${conversationId}/chat`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ message: "hello acp" })
      .expect(200);

    expect(streamAcpConversationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId,
        message: "hello acp",
      })
    );
    expect(streamConversationAgentMock).not.toHaveBeenCalled();
  });

  it("supports ACP conversation regenerate and edit replay", async () => {
    streamAcpConversationMock
      .mockResolvedValueOnce("initial acp result")
      .mockResolvedValueOnce("regen acp result")
      .mockResolvedValueOnce("edit acp result");

    const createRes = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        title: "acp replay",
        acp_agent_id: 10,
      })
      .expect(200);

    const conversationId = String(createRes.body.id);

    await request(app)
      .post(`/api/conversations/${conversationId}/chat`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ message: "hello acp replay" })
      .expect(200);

    await request(app)
      .post(`/api/conversations/${conversationId}/regenerate`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({})
      .expect(200);

    const messagesRes = await request(app)
      .get(`/api/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    const userMessage = messagesRes.body.find((item) => item.role === "user");
    expect(userMessage).toBeTruthy();

    await request(app)
      .put(`/api/conversations/${conversationId}/messages/${userMessage.id}`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ content: "edited acp replay" })
      .expect(200);

    expect(streamAcpConversationMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        conversationId,
        message: "hello acp replay",
        history: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "hello acp replay" }),
        ]),
      })
    );
    expect(streamAcpConversationMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        conversationId,
        message: "edited acp replay",
      })
    );
  });

  it("supports querying and switching ACP session models", async () => {
    getConversationAcpModelsMock.mockResolvedValueOnce({
      session_id: "session-1",
      current_model_id: "test-model",
      supports_switching: true,
      available_models: [{ model_id: "test-model", name: "Test Model" }],
    });
    setConversationAcpModelMock.mockResolvedValueOnce({
      session_id: "session-1",
      current_model_id: "other-model",
      supports_switching: true,
      available_models: [{ model_id: "other-model", name: "Other Model" }],
    });

    const createRes = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        title: "acp models",
        acp_agent_id: 11,
      })
      .expect(200);

    const conversationId = String(createRes.body.id);

    const modelsRes = await request(app)
      .get(`/api/conversations/${conversationId}/acp-models`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(modelsRes.body.current_model_id).toBe("test-model");

    const switchRes = await request(app)
      .post(`/api/conversations/${conversationId}/acp-model`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ model_id: "other-model" })
      .expect(200);
    expect(switchRes.body.current_model_id).toBe("other-model");
    expect(setConversationAcpModelMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        id: Number(conversationId),
        acp_agent_id: 11,
      }),
      "other-model"
    );
  });

  it("reports context budget and supports manual compact", async () => {
    const createRes = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        title: "compact me",
        context_window: 4096,
      })
      .expect(200);

    const conversationId = String(createRes.body.id);
    const user = getOrCreateLocalUser();
    const longChunk = "这是一个很长的历史片段，用于制造上下文压力。".repeat(180);

    for (let index = 0; index < 18; index += 1) {
      addMessage(conversationId, user.uid, index % 2 === 0 ? "user" : "assistant", `${index}:${longChunk}`);
    }

    const budgetRes = await request(app)
      .get(`/api/conversations/${conversationId}/context-budget`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(budgetRes.body.compact_required).toBe(true);
    expect(budgetRes.body.remaining_percentage).toBeLessThan(50);

    const compactRes = await request(app)
      .post(`/api/conversations/${conversationId}/compact`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({})
      .expect(200);

    expect(compactRes.body.compacted).toBe(true);
    expect(compactRes.body.compacted_messages).toBeGreaterThanOrEqual(1);

    const messagesRes = await request(app)
      .get(`/api/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(
      messagesRes.body.some(
        (item) =>
          item.role === "assistant" &&
          String(item.content || "").includes("[CONTEXT_COMPACTED:")
      )
    ).toBe(true);
  });
});
