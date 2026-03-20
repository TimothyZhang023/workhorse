import { Router } from "express";

import {
  createAcpAgent,
  deleteAcpAgent,
  listAcpAgents,
  updateAcpAgent,
} from "../models/database.js";
import {
  ACP_AGENT_PRESETS,
  testAcpAgentConnection,
} from "../models/acpAgentManager.js";

const router = Router();

function normalizePreset(preset) {
  const normalized = String(preset || "").trim().toLowerCase();
  return ACP_AGENT_PRESETS[normalized] ? normalized : "";
}

router.get("/templates", (req, res) => {
  res.json(Object.values(ACP_AGENT_PRESETS));
});

router.get("/", (req, res) => {
  try {
    res.json(listAcpAgents(req.uid));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/", (req, res) => {
  try {
    const preset = normalizePreset(req.body?.preset);
    if (!preset) {
      return res.status(400).json({ error: "Unsupported ACP preset" });
    }

    const template = ACP_AGENT_PRESETS[preset];
    const command = String(req.body?.command || template.command || "").trim();
    if (!command) {
      return res.status(400).json({ error: "Missing command" });
    }

    const env = {};
    const envKey = String(template.env_key || "").trim();
    const apiKey = String(req.body?.api_key || "").trim();
    if (envKey && apiKey) {
      env[envKey] = apiKey;
    }

    const agent = createAcpAgent(req.uid, {
      name: String(req.body?.name || template.label).trim() || template.label,
      preset,
      command,
      args: Array.isArray(req.body?.args) ? req.body.args : template.args,
      env,
      agent_prompt: String(req.body?.agent_prompt || "").trim(),
      default_model_id: String(req.body?.default_model_id || "").trim() || null,
      is_enabled: req.body?.is_enabled ?? 1,
    });

    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/:id", (req, res) => {
  try {
    const preset = normalizePreset(req.body?.preset);
    const payload = {
      ...(req.body?.name !== undefined ? { name: String(req.body.name || "").trim() } : {}),
      ...(preset ? { preset } : {}),
      ...(req.body?.command !== undefined
        ? { command: String(req.body.command || "").trim() }
        : {}),
      ...(req.body?.agent_prompt !== undefined
        ? { agent_prompt: String(req.body.agent_prompt || "").trim() }
        : {}),
      ...(req.body?.default_model_id !== undefined
        ? {
            default_model_id:
              String(req.body.default_model_id || "").trim() || null,
          }
        : {}),
      ...(req.body?.last_used_model_id !== undefined
        ? {
            last_used_model_id:
              String(req.body.last_used_model_id || "").trim() || null,
          }
        : {}),
      ...(req.body?.is_enabled !== undefined
        ? { is_enabled: req.body.is_enabled }
        : {}),
    };

    const updated = updateAcpAgent(Number(req.params.id), req.uid, payload);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/:id/test", async (req, res) => {
  try {
    const result = await testAcpAgentConnection(req.uid, Number(req.params.id));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    deleteAcpAgent(Number(req.params.id), req.uid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
