import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

describe("system overview route", () => {
  let app;
  let authToken;

  beforeAll(async () => {
    process.env.STANDALONE_MODE = "false";
    const { createApp } = await import("../server/app.js");
    app = createApp();

    authToken = "local-mode-token";
  });

  it("returns runtime and counts", async () => {
    const res = await request(app)
      .get("/api/system/overview")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.runtime.node).toContain("v");
    expect(typeof res.body.counts.skills).toBe("number");
    expect(Array.isArray(res.body.recommendations)).toBe(true);
  });

  it("clears stored history from the new system endpoint", async () => {
    const createRes = await request(app)
      .post("/api/conversations")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ title: "cleanup target" })
      .expect(200);

    expect(createRes.body.id).toBeTruthy();

    const res = await request(app)
      .delete("/api/system/history")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(typeof res.body.deleted_conversations).toBe("number");
    expect(typeof res.body.deleted_messages).toBe("number");
    expect(typeof res.body.deleted_usage_logs).toBe("number");
  });
});
