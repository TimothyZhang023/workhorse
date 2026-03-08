import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
  createSkill,
  deleteSkill,
  listSkills,
  updateSkill,
} from "../models/database.js";

const router = Router();
router.use(authMiddleware);

router.get("/", (req, res) => {
  try {
    const skills = listSkills(req.uid);
    res.json(skills);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/", (req, res) => {
  try {
    const { name, description, prompt, examples, tools } = req.body;
    if (!name || !prompt) {
      return res.status(400).json({ error: "Missing required fields" });
    }
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
