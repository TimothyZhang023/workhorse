import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

describe("system settings route", () => {
  let app;
  let authToken;

  beforeAll(async () => {
    process.env.STANDALONE_MODE = "false";
    const { createApp } = await import("../server/app.js");
    app = createApp();

    authToken = "local-mode-token";
  });

  it("gets and updates global system markdown", async () => {
    const getRes = await request(app)
      .get("/api/system/settings/global-system-prompt")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(getRes.body.key).toBe("global_system_prompt_markdown");

    const markdown = "# Global Prompt\n\n- Always provide concise output.";

    const putRes = await request(app)
      .put("/api/system/settings/global-system-prompt")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ markdown })
      .expect(200);

    expect(putRes.body.success).toBe(true);

    const getRes2 = await request(app)
      .get("/api/system/settings/global-system-prompt")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(getRes2.body.markdown).toBe(markdown);
  });

  it("preserves markdown formatting without trimming", async () => {
    const markdown = "# Title\n\nline\n";

    await request(app)
      .put("/api/system/settings/global-system-prompt")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ markdown })
      .expect(200);

    const getRes = await request(app)
      .get("/api/system/settings/global-system-prompt")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(getRes.body.markdown.endsWith("\n")).toBe(true);
    expect(getRes.body.markdown).toBe(markdown);
  });
});
