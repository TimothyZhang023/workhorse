import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

const runAgentTaskMock = vi.fn();

vi.mock("../server/models/agentEngine.js", async () => {
  const actual = await vi.importActual("../server/models/agentEngine.js");
  return {
    ...actual,
    runAgentTask: runAgentTaskMock,
  };
});

describe("channel-webhooks dingtalk", () => {
  let app;
  let authToken;
  let installedChannel;
  let createdTask;

  beforeAll(async () => {
    process.env.STANDALONE_MODE = "false";

    const { createApp } = await import("../server/app.js");
    app = createApp();

    authToken = "local-mode-token";

    const installRes = await request(app)
      .post("/api/channels/extensions/dingtalk/install")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "Ops Ding", bot_token: "ding-secret" })
      .expect(200);
    installedChannel = installRes.body.channel;

    const createTaskRes = await request(app)
      .post("/api/agent-tasks")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        name: "daily-ops",
        description: "daily ops",
        system_prompt: "do ops",
        skill_ids: [],
        tool_names: [],
      })
      .expect(200);
    createdTask = createTaskRes.body;
  });

  it("executes agent task from /run command", async () => {
    runAgentTaskMock.mockResolvedValueOnce({
      runId: 11,
      conversationId: 22,
      finalResponse: "任务完成",
    });

    const res = await request(app)
      .post(
        `/api/channel-webhooks/dingtalk/${installedChannel.id}?uid=${encodeURIComponent(
          installedChannel.uid
        )}&token=ding-secret`
      )
      .send({ text: { content: `/run ${createdTask.id} 生成今天巡检摘要` } })
      .expect(200);

    expect(runAgentTaskMock).toHaveBeenCalledWith(installedChannel.uid, createdTask.id, {
      initialUserMessage: "生成今天巡检摘要",
      triggerSource: "dingtalk",
    });
    expect(res.body.msgtype).toBe("text");
    expect(res.body.text.content).toContain("任务已执行");
  });

  it("rejects webhook calls with invalid token", async () => {
    const res = await request(app)
      .post(
        `/api/channel-webhooks/dingtalk/${installedChannel.id}?uid=${encodeURIComponent(
          installedChannel.uid
        )}&token=bad-token`
      )
      .send({ text: { content: `/run ${createdTask.id}` } })
      .expect(401);

    expect(res.body.text.content).toContain("token 校验失败");
  });

  it("returns usage guidance when command format is invalid", async () => {
    const res = await request(app)
      .post(
        `/api/channel-webhooks/dingtalk/${installedChannel.id}?uid=${encodeURIComponent(
          installedChannel.uid
        )}&token=ding-secret`
      )
      .send({ text: { content: "hello" } })
      .expect(200);

    expect(res.body.text.content).toContain("命令格式错误");
  });

  it("returns help message for /help command", async () => {
    const res = await request(app)
      .post(
        `/api/channel-webhooks/dingtalk/${installedChannel.id}?uid=${encodeURIComponent(
          installedChannel.uid
        )}&token=ding-secret`
      )
      .send({ text: { content: "/help" } })
      .expect(200);

    expect(res.body.text.content).toContain("可用命令");
  });

  it("supports fuzzy task name matching", async () => {
    runAgentTaskMock.mockResolvedValueOnce({
      runId: 33,
      conversationId: 44,
      finalResponse: "done",
    });

    await request(app)
      .post(
        `/api/channel-webhooks/dingtalk/${installedChannel.id}?uid=${encodeURIComponent(
          installedChannel.uid
        )}&token=ding-secret`
      )
      .send({ text: { content: "/run daily 继续执行" } })
      .expect(200);

    expect(runAgentTaskMock).toHaveBeenCalledWith(installedChannel.uid, createdTask.id, {
      initialUserMessage: "继续执行",
      triggerSource: "dingtalk",
    });
  });
});
