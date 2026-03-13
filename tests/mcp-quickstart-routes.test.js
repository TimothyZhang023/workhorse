import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

describe("mcp quickstart routes", () => {
  let app;
  let authToken;

  beforeAll(async () => {
    process.env.STANDALONE_MODE = "false";
    const { createApp } = await import("../server/app.js");
    app = createApp();

    authToken = "local-mode-token";
  });

  it("lists quickstart bundles and installs starter", async () => {
    const bundlesRes = await request(app)
      .get("/api/mcp/quickstart/bundles")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(bundlesRes.body.find((item) => item.id === "starter")).toBeTruthy();

    const installRes = await request(app)
      .post("/api/mcp/quickstart/install")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ bundle_id: "starter" })
      .expect(200);

    expect(installRes.body.installed.length).toBeGreaterThan(0);
  });

  it("validates mcp payload", async () => {
    const invalidRes = await request(app)
      .post("/api/mcp/validate")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "", type: "stdio" })
      .expect(200);

    expect(invalidRes.body.valid).toBe(false);

    const validRes = await request(app)
      .post("/api/mcp/validate")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "x", type: "sse", url: "https://example.com/sse" })
      .expect(200);

    expect(validRes.body.valid).toBe(true);
  });

  it("enforces mcp payload rules on create endpoint", async () => {
    const missingCommand = await request(app)
      .post("/api/mcp")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "bad-stdio", type: "stdio" })
      .expect(400);

    expect(missingCommand.body.error).toContain("command is required");

    const missingUrl = await request(app)
      .post("/api/mcp")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "bad-sse", type: "sse" })
      .expect(400);

    expect(missingUrl.body.error).toContain("url is required");
  });
});
