import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("skills templates routes", () => {
  let app;
  let authToken;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cw-skills-test-"));

  beforeAll(async () => {
    process.env.STANDALONE_MODE = "false";
    const { createApp } = await import("../server/app.js");
    app = createApp();

    authToken = "local-mode-token";
  });

  afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("lists and installs skill template", async () => {
    const listRes = await request(app)
      .get("/api/skills/templates?query=PRD")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(listRes.body.length).toBeGreaterThan(0);

    const installRes = await request(app)
      .post(`/api/skills/templates/${listRes.body[0].id}/install`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(installRes.body.skill.id).toBeTruthy();
  });

  it("validates and imports skills in batch", async () => {
    const validateRes = await request(app)
      .post("/api/skills/validate")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "", prompt: "short" })
      .expect(200);

    expect(validateRes.body.valid).toBe(false);

    const importRes = await request(app)
      .post("/api/skills/import")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        skills: [
          {
            name: "Daily Report",
            prompt: "请先汇总再输出结论，最后给行动项。",
            tools: ["memory", "memory"],
          },
          { name: "", prompt: "bad" },
        ],
      })
      .expect(200);

    expect(importRes.body.results[0].status).toBe("created");
    expect(importRes.body.results[1].status).toBe("invalid");
  });

  it("installs and refreshes skills from a git repository", async () => {
    const repoDir = path.join(tempRoot, "skill-repo");
    fs.mkdirSync(path.join(repoDir, "reviewer"), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, "reviewer", "SKILL.md"),
      "# Reviewer\n\nReview code changes and return concise findings."
    );

    execFileSync("git", ["init"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    execFileSync("git", ["config", "user.name", "Skill Test"], {
      cwd: repoDir,
    });
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const repoUrl = `file://${repoDir}`;

    const firstInstall = await request(app)
      .post("/api/skills/install/git")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ repo_url: repoUrl })
      .expect(200);

    expect(firstInstall.body.updated).toBe(false);
    expect(firstInstall.body.installed_count).toBe(1);
    expect(firstInstall.body.installed[0].source_type).toBe("git");

    fs.writeFileSync(
      path.join(repoDir, "reviewer", "SKILL.md"),
      "# Reviewer\n\nReview code changes and return structured findings with severity."
    );
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "update"], { cwd: repoDir });

    const secondInstall = await request(app)
      .post("/api/skills/install/git")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ repo_url: repoUrl })
      .expect(200);

    expect(secondInstall.body.updated).toBe(true);
    expect(secondInstall.body.installed[0].prompt).toContain(
      "structured findings"
    );
  });

  it("installs valid zip skills and rejects invalid zip packages", async () => {
    const validZipPath = path.join(tempRoot, "valid-skills.zip");
    const invalidZipPath = path.join(tempRoot, "invalid-skills.zip");

    execFileSync("python3", [
      "-c",
      `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as archive:
    archive.writestr("planner/SKILL.md", "# Planner\\n\\nPlan tasks and output milestones.")
      `,
      validZipPath,
    ]);
    execFileSync("python3", [
      "-c",
      `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as archive:
    archive.writestr("README.md", "not a skill package")
      `,
      invalidZipPath,
    ]);

    const validZip = fs.readFileSync(validZipPath).toString("base64");
    const validRes = await request(app)
      .post("/api/skills/install/zip")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ file_name: "valid-skills.zip", zip_base64: validZip })
      .expect(200);

    expect(validRes.body.installed_count).toBe(1);
    expect(validRes.body.installed[0].source_type).toBe("zip");

    const invalidZip = fs.readFileSync(invalidZipPath).toString("base64");
    const invalidRes = await request(app)
      .post("/api/skills/install/zip")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ file_name: "invalid-skills.zip", zip_base64: invalidZip })
      .expect(400);

    expect(invalidRes.body.error).toContain("SKILL.md");
  });
});
