import { Router } from "express";

import {
  createMcpServer,
  createSkill,
  getMcpServer,
  getSkill,
  listMcpServers,
  listSkills,
} from "../models/database.js";
import {
  areInstallSpecsEqual,
  buildInstallShare,
  buildSharedMcpSpec,
  buildSharedSkillSpec,
  decodeInstallBundle,
} from "../utils/installShare.js";

const router = Router();

function validateImportedMcpSpec(spec = {}) {
  const name = String(spec.name || "").trim();
  const type = String(spec.type || "").trim();
  const command = String(spec.command || "").trim();
  const url = String(spec.url || "").trim();

  if (!name) {
    throw new Error("MCP 安装包缺少名称");
  }
  if (!["stdio", "sse"].includes(type)) {
    throw new Error("MCP 安装包类型无效");
  }
  if (type === "stdio" && !command) {
    throw new Error("stdio MCP 安装包缺少命令");
  }
  if (type === "sse" && !url) {
    throw new Error("sse MCP 安装包缺少 URL");
  }
}

function validateImportedSkillSpec(spec = {}) {
  const name = String(spec.name || "").trim();
  const prompt = String(spec.prompt || "").trim();
  if (!name) {
    throw new Error("Skill 安装包缺少名称");
  }
  if (!prompt) {
    throw new Error("Skill 安装包缺少 prompt");
  }
}

router.get("/mcp/:id", (req, res) => {
  try {
    const server = getMcpServer(Number(req.params.id), req.uid);
    if (!server) {
      return res.status(404).json({ error: "MCP 节点不存在" });
    }

    const spec = buildSharedMcpSpec(server);
    return res.json({
      name: spec.name,
      ...buildInstallShare("mcp", spec),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/skills/:id", (req, res) => {
  try {
    const skill = getSkill(Number(req.params.id), req.uid);
    if (!skill) {
      return res.status(404).json({ error: "Skill 不存在" });
    }

    const spec = buildSharedSkillSpec(skill);
    return res.json({
      name: spec.name,
      ...buildInstallShare("skill", spec),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/import", (req, res) => {
  try {
    const token = String(req.body?.bundle || "").trim();
    if (!token) {
      return res.status(400).json({ error: "bundle is required" });
    }

    const bundle = decodeInstallBundle(token);

    if (bundle.kind === "mcp") {
      validateImportedMcpSpec(bundle.spec);
      const nextSpec = buildSharedMcpSpec(bundle.spec);
      const existing = listMcpServers(req.uid).find((item) =>
        areInstallSpecsEqual(buildSharedMcpSpec(item), nextSpec)
      );

      if (existing) {
        return res.json({
          kind: "mcp",
          status: "existing",
          server: existing,
        });
      }

      const server = createMcpServer(
        req.uid,
        nextSpec.name,
        nextSpec.type,
        nextSpec.command,
        nextSpec.args,
        nextSpec.url,
        nextSpec.is_enabled,
        nextSpec.env,
        nextSpec.headers,
        nextSpec.auth
      );

      return res.json({
        kind: "mcp",
        status: "created",
        server,
      });
    }

    validateImportedSkillSpec(bundle.spec);
    const nextSpec = buildSharedSkillSpec(bundle.spec);
    const existing = listSkills(req.uid).find((item) =>
      areInstallSpecsEqual(buildSharedSkillSpec(item), nextSpec)
    );

    if (existing) {
      return res.json({
        kind: "skill",
        status: "existing",
        skill: existing,
      });
    }

    const skill = createSkill(
      req.uid,
      nextSpec.name,
      nextSpec.description,
      nextSpec.prompt,
      nextSpec.examples,
      nextSpec.tools,
      {
        is_enabled: nextSpec.is_enabled,
        source_type: "share",
        source_location: "workhorse://install",
        source_item_path: nextSpec.name,
        source_refreshed_at: new Date().toISOString(),
      }
    );

    return res.json({
      kind: "skill",
      status: "created",
      skill,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

export default router;
