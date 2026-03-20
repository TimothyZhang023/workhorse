import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

describe("agent task routes", () => {
  let app;
  let authToken;

  beforeAll(async () => {
    const { createApp } = await import("../server/app.js");
    app = createApp();
    authToken = "local-mode-token";
  });

  it("creates and updates orchestrated tasks with ACP agent bindings", async () => {
    const agentRes = await request(app)
      .post("/api/acp-agents")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        name: "Task Route ACP",
        preset: "opencode",
        command: process.execPath,
      })
      .expect(200);

    const taskRes = await request(app)
      .post("/api/agent-tasks")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        name: "外部编排任务",
        system_prompt: "使用外部 agent 执行任务",
        acp_agent_id: agentRes.body.id,
      })
      .expect(200);

    expect(taskRes.body.acp_agent_id).toBe(agentRes.body.id);

    await request(app)
      .put(`/api/agent-tasks/${taskRes.body.id}`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        acp_agent_id: null,
      })
      .expect(200);

    const listRes = await request(app)
      .get("/api/agent-tasks")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    const updated = listRes.body.find((item) => item.id === taskRes.body.id);
    expect(updated).toBeTruthy();
    expect(updated.acp_agent_id).toBeNull();
  });
});
