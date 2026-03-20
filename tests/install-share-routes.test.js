import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createMcpServer,
  createSkill,
  getOrCreateLocalUser,
  listMcpServers,
  listSkills,
} from "../server/models/database.js";

describe("install share routes", () => {
  let app;
  let authToken;
  let uid;

  beforeAll(async () => {
    const { createApp } = await import("../server/app.js");
    app = createApp();
    authToken = "local-mode-token";
    uid = getOrCreateLocalUser().uid;
  });

  it("exports and imports MCP install bundles through a deep link payload", async () => {
    const server = createMcpServer(
      uid,
      "GitHub MCP Shared",
      "stdio",
      "npx",
      ["-y", "@modelcontextprotocol/server-github"],
      "",
      1,
      { GITHUB_TOKEN: "secret-value" },
      {},
      null
    );

    const exportRes = await request(app)
      .get(`/api/install-share/mcp/${server.id}`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(exportRes.body.kind).toBe("mcp");
    expect(exportRes.body.share_url).toContain("workhorse://install?bundle=");
    expect(exportRes.body.commands.macos).toContain("open 'workhorse://install");

    const importRes = await request(app)
      .post("/api/install-share/import")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ bundle: exportRes.body.bundle })
      .expect(200);

    expect(importRes.body.kind).toBe("mcp");
    expect(importRes.body.status).toBe("existing");
    expect(importRes.body.server.id).toBe(server.id);

    const allServers = listMcpServers(uid);
    const sharedServer = allServers.find((item) => item.id === server.id);
    expect(sharedServer.env.GITHUB_TOKEN).toBe("secret-value");
  });

  it("exports and imports skill install bundles and avoids duplicates", async () => {
    const skill = createSkill(
      uid,
      "Reviewer Share",
      "Review code changes",
      "Return findings grouped by severity and file.",
      [{ input: "diff", output: "findings" }],
      ["memory"],
      { is_enabled: 1 }
    );

    const exportRes = await request(app)
      .get(`/api/install-share/skills/${skill.id}`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(exportRes.body.kind).toBe("skill");
    expect(exportRes.body.name).toBe("Reviewer Share");
    expect(exportRes.body.commands.linux).toContain("xdg-open");

    const importRes = await request(app)
      .post("/api/install-share/import")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ bundle: exportRes.body.bundle })
      .expect(200);

    expect(importRes.body.kind).toBe("skill");
    expect(importRes.body.status).toBe("existing");
    expect(importRes.body.skill.id).toBe(skill.id);

    const allSkills = listSkills(uid).filter((item) => item.name === "Reviewer Share");
    expect(allSkills).toHaveLength(1);
  });

  it("rejects malformed install bundles", async () => {
    const response = await request(app)
      .post("/api/install-share/import")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ bundle: "bad-token" })
      .expect(400);

    expect(response.body.error).toContain("安装链接无效");
  });
});
