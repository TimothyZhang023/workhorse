import { Router } from "express";

import {
  createSkill,
  deleteSkill,
  listSkills,
  updateSkill,
} from "../models/database.js";
import {
  getDefaultSkillTemplate,
  listDefaultSkillTemplates,
  searchDefaultSkillTemplates,
} from "../utils/defaultSkillCatalog.js";
import { generateSkillDraft } from "../utils/skillGenerator.js";

const router = Router();


function normalizeTools(tools) {
  if (!Array.isArray(tools)) {
    return [];
  }

  return [...new Set(tools.map((item) => String(item || "").trim()).filter(Boolean))];
}

function validateSkillPayload(payload = {}) {
  const errors = [];
  const name = String(payload.name || "").trim();
  const prompt = String(payload.prompt || "").trim();
  const tools = normalizeTools(payload.tools);

  if (!name) {
    errors.push("name is required");
  }
  if (name.length > 64) {
    errors.push("name is too long (<=64)");
  }
  if (!prompt) {
    errors.push("prompt is required");
  }
  if (prompt.length < 10) {
    errors.push("prompt is too short (>=10)");
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized: {
      ...payload,
      name,
      prompt,
      tools,
    },
  };
}

router.get("/", (req, res) => {
  try {
    const skills = listSkills(req.uid);
    res.json(skills);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/templates", (req, res) => {
  try {
    const query = String(req.query?.query || "").trim();
    if (query) {
      return res.json(searchDefaultSkillTemplates(query, 12));
    }

    return res.json(listDefaultSkillTemplates());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/templates/:templateId/install", (req, res) => {
  try {
    const template = getDefaultSkillTemplate(req.params.templateId);
    if (!template) {
      return res.status(404).json({ error: "Skill template not found" });
    }

    const validation = validateSkillPayload(template);
    if (!validation.valid) {
      return res.status(400).json(validation);
    }

    const skill = createSkill(
      req.uid,
      validation.normalized.name,
      template.description,
      validation.normalized.prompt,
      template.examples,
      validation.normalized.tools
    );

    return res.json({ template, skill });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/validate", (req, res) => {
  try {
    return res.json(validateSkillPayload(req.body || {}));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/import", (req, res) => {
  try {
    const items = Array.isArray(req.body?.skills) ? req.body.skills : [];
    if (items.length === 0) {
      return res.status(400).json({ error: "skills is required" });
    }

    const results = items.map((item) => {
      const validation = validateSkillPayload(item);
      if (!validation.valid) {
        return { status: "invalid", name: item?.name, errors: validation.errors };
      }

      const skill = createSkill(
        req.uid,
        validation.normalized.name,
        item.description,
        validation.normalized.prompt,
        item.examples,
        validation.normalized.tools
      );
      return { status: "created", skill };
    });

    return res.json({ results });
  } catch (error) {
    return res.status(500).json({ error: error.message });
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

    const result = await generateSkillDraft(req.uid, requirement);

    if (autoCreate) {
      const skill = createSkill(
        req.uid,
        result.draft.name,
        result.draft.description,
        result.draft.prompt,
        result.draft.examples,
        result.draft.tools
      );

      return res.json({
        ...result,
        skill,
      });
    }

    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post("/", (req, res) => {
  try {
    const validation = validateSkillPayload(req.body || {});
    if (!validation.valid) {
      return res.status(400).json({ error: validation.errors.join("; ") });
    }

    const { name, description, prompt, examples, tools } = validation.normalized;
    const skill = createSkill(
      req.uid,
      name,
      description,
      prompt,
      examples,
      tools
    );
    res.json(skill);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/:id", (req, res) => {
  try {
    updateSkill(req.params.id, req.uid, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    deleteSkill(req.params.id, req.uid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
