import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { syncCronJobs } from "../models/cronRunner.js";
import {
  createCronJob,
  deleteCronJob,
  listAllCronJobs,
  listCronJobs,
  updateCronJob,
} from "../models/database.js";

const router = Router();
router.use(authMiddleware);

router.get("/", (req, res) => {
  try {
    const jobs = listCronJobs(req.uid);
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/", (req, res) => {
  try {
    const { taskId, name, cronExpression } = req.body;
    if (!taskId || !name || !cronExpression) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const job = createCronJob(req.uid, taskId, name, cronExpression);
    // Sync scheduler
    syncCronJobs(listAllCronJobs());
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/:id", (req, res) => {
  try {
    updateCronJob(req.params.id, req.uid, req.body);
    // Sync scheduler
    syncCronJobs(listAllCronJobs());
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    deleteCronJob(req.params.id, req.uid);
    // Sync scheduler
    syncCronJobs(listAllCronJobs());
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
