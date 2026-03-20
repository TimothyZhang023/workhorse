import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

describe("system settings routes", () => {
  let app;
  let authToken;

  beforeAll(async () => {
    const { createApp } = await import("../server/app.js");
    app = createApp();
    authToken = "local-mode-token";
  });

  it("reads and updates the main agent prompt independently from the global prompt", async () => {
    const initialRes = await request(app)
      .get("/api/system/settings/main-agent-prompt")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(initialRes.body.key).toBe("main_agent_prompt");

    await request(app)
      .put("/api/system/settings/main-agent-prompt")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        markdown: "你是 main agent，要优先做本地执行。",
      })
      .expect(200);

    const mainPromptRes = await request(app)
      .get("/api/system/settings/main-agent-prompt")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(mainPromptRes.body.markdown).toBe("你是 main agent，要优先做本地执行。");

    const globalPromptRes = await request(app)
      .get("/api/system/settings/global-system-prompt")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(globalPromptRes.body.key).toBe("global_system_prompt_markdown");
  });
});
