import request from "supertest";
import { describe, expect, it, beforeAll } from "vitest";

describe("channels endpoints", () => {
  let app;
  let authToken;

  beforeAll(async () => {
    process.env.STANDALONE_MODE = "false";
    const { createApp } = await import("../server/app.js");
    app = createApp();

    authToken = "local-mode-token";
  });

  it("installs an IM extension and lists channels", async () => {
    const installRes = await request(app)
      .post("/api/channels/extensions/telegram/install")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "TG Ops", bot_token: "test-bot-token" })
      .expect(200);

    expect(installRes.body.channel.platform).toBe("telegram");

    const listRes = await request(app)
      .get("/api/channels")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(listRes.body.length).toBeGreaterThan(0);
    expect(listRes.body[0].platform).toBe("telegram");
  });
});
