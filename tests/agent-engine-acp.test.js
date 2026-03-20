import { describe, expect, it, vi } from "vitest";

const streamAcpConversationMock = vi.fn();

vi.mock("../server/models/acpAgentManager.js", async () => {
  const actual = await vi.importActual("../server/models/acpAgentManager.js");
  return {
    ...actual,
    streamAcpConversation: streamAcpConversationMock,
  };
});

describe("agentEngine ACP task execution", () => {
  it("routes bound tasks into the ACP runtime", async () => {
    const {
      createAcpAgent,
      createAgentTask,
      createUser,
      getConversation,
      listTaskRunEvents,
    } = await import("../server/models/database.js");
    const { runAgentTask } = await import("../server/models/agentEngine.js");

    streamAcpConversationMock.mockResolvedValueOnce("ACP task result");

    const user = createUser(`user_${Date.now()}_engine_acp`, "password123");
    const agent = createAcpAgent(user.uid, {
      name: "Engine ACP",
      preset: "opencode",
      command: "opencode",
      args: ["acp"],
      env: {},
      is_enabled: 1,
    });
    const task = createAgentTask(
      user.uid,
      "ACP 编排任务",
      "",
      "请输出调研结论",
      [],
      [],
      "",
      agent.id
    );

    const result = await runAgentTask(user.uid, task.id, {
      initialUserMessage: "执行一次 ACP 调研任务",
    });

    expect(result.finalResponse).toBe("ACP task result");
    expect(streamAcpConversationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: user.uid,
        conversationId: String(result.conversationId),
        message: expect.stringContaining("执行一次 ACP 调研任务"),
      })
    );

    const conversation = getConversation(result.conversationId, user.uid);
    expect(conversation.acp_agent_id).toBe(agent.id);

    const events = listTaskRunEvents(result.runId, user.uid);
    expect(events.some((event) => event.event_type === "run_completed")).toBe(
      true
    );
  });
});
