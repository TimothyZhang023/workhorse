import { Router } from "express";

import { startAgentTaskRun } from "../models/agentEngine.js";
import {
  createAgentTask,
  createSkill,
  deleteAgentTask,
  listTaskRunEvents,
  listTaskRuns,
  listAgentTasks,
  updateAgentTask,
} from "../models/database.js";
import { generateAgentTaskBlueprint } from "../utils/agentTaskGenerator.js";

const router = Router();

function normalizeAcpAgentId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

router.get("/", (req, res) => {
  try {
    const tasks = listAgentTasks(req.uid);
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/runs", (req, res) => {
  try {
    const { taskId, limit } = req.query;
    const runs = listTaskRuns(req.uid, {
      taskId: taskId ? Number(taskId) : undefined,
      limit: limit ? Number(limit) : 20,
    });
    res.json(runs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/runs/:runId/events", (req, res) => {
  try {
    const events = listTaskRunEvents(Number(req.params.runId), req.uid);
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/", (req, res) => {
  try {
    const { name, description, system_prompt, acp_agent_id } = req.body;
    if (!name || !system_prompt) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const task = createAgentTask(
      req.uid,
      name,
      description || "",
      system_prompt,
      [],
      [],
      "",
      normalizeAcpAgentId(acp_agent_id)
    );
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/generate", async (req, res) => {
  try {
    const requirement = req.body?.requirement;
    const autoCreate = Boolean(
      req.body?.auto_create !== undefined
        ? req.body.auto_create
        : req.body?.autoCreate
    );

    const result = await generateAgentTaskBlueprint(req.uid, requirement);

    if (autoCreate) {
      const createdSkills = result.suggested_skills.map((skill) =>
        createSkill(
          req.uid,
          skill.name,
          skill.description,
          skill.prompt,
          [],
          skill.tools || []
        )
      );

      const task = createAgentTask(
        req.uid,
        result.draft.name,
        "",
        result.draft.system_prompt,
        [],
        [],
        "",
        normalizeAcpAgentId(result.draft.acp_agent_id)
      );

      return res.json({
        ...result,
        created_skills: createdSkills,
        task,
      });
    }

    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.put("/:id", (req, res) => {
  try {
    updateAgentTask(req.params.id, req.uid, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    deleteAgentTask(req.params.id, req.uid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 执行 AgentTask
router.post("/:id/run", async (req, res) => {
  try {
    const { message } = req.body;
    const result = await startAgentTaskRun(req.uid, parseInt(req.params.id), {
      initialUserMessage: message,
      triggerSource: "manual",
    });
    res.status(202).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
