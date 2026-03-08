import { CronExpressionParser } from "cron-parser";
import cron from "node-cron";
import { logger } from "../utils/logger.js";
import { runAgentTask } from "./agentEngine.js";
import { updateCronJob } from "./database.js";

const activeCronJobs = new Map(); // key: jobId, value: { job, task_id }

export function getNextRunAt(cronExpression, options = {}) {
  return CronExpressionParser.parse(cronExpression, options)
    .next()
    .toISOString();
}

/**
 * Initializes all enabled cron jobs from the database.
 */
export async function initCronRunner() {
  logger.info("[CronRunner] Initializing cron scheduler...");
  // Use a hardcoded loop for now to find all users' cron jobs
  // In a real app, you might want a specific table scan.
  // We'll use a direct query to list all jobs across users for the scheduler.
  // (Assuming database.js doesn't have listAllCronJobs, I'll use listCronJobs with a dummy uid check if needed or add it to database.js)

  // For now, let's assume we can get all.
  // Actually, I'll add a helper to database.js to list ALL cron jobs.
}

/**
 * Syncs the scheduler with the database state.
 */
export function syncCronJobs(allCronJobs) {
  const currentIds = new Set(allCronJobs.map((j) => j.id));

  // Stop jobs that are no longer in the list or disabled
  for (const [id, info] of activeCronJobs.entries()) {
    const dbJob = allCronJobs.find((j) => j.id === id);
    if (!currentIds.has(id) || (dbJob && !dbJob.is_enabled)) {
      info.job.stop();
      activeCronJobs.delete(id);
      logger.info({ jobId: id }, "[CronRunner] Stopped cron job");
    }
  }

  // Start/Update jobs
  for (const dbJob of allCronJobs) {
    if (!dbJob.is_enabled) continue;

    const existing = activeCronJobs.get(dbJob.id);
    if (
      existing &&
      existing.cron_expression === dbJob.cron_expression &&
      existing.task_id === dbJob.task_id
    ) {
      continue; // No change
    }

    if (existing) {
      existing.job.stop();
    }

    try {
      const task = cron.schedule(dbJob.cron_expression, async () => {
        logger.info(
          { jobId: dbJob.id, taskId: dbJob.task_id },
          "[CronRunner] Executing scheduled task"
        );

        try {
          updateCronJob(dbJob.id, dbJob.uid, { last_status: "running" });
          await runAgentTask(dbJob.uid, dbJob.task_id, {
            initialUserMessage: `[CRON] Automated run triggered by rule: ${dbJob.name}`,
          });

          const nextRun = getNextRunAt(dbJob.cron_expression);
          updateCronJob(dbJob.id, dbJob.uid, {
            last_run: new Date().toISOString(),
            last_status: "success",
            next_run: nextRun,
          });
        } catch (e) {
          logger.error(
            { jobId: dbJob.id, err: e.message },
            "[CronRunner] Task execution failed"
          );
          updateCronJob(dbJob.id, dbJob.uid, {
            last_run: new Date().toISOString(),
            last_status: "failed",
          });
        }
      });

      activeCronJobs.set(dbJob.id, {
        job: task,
        cron_expression: dbJob.cron_expression,
        task_id: dbJob.task_id,
      });

      const nextRun = getNextRunAt(dbJob.cron_expression);
      updateCronJob(dbJob.id, dbJob.uid, { next_run: nextRun });

      logger.info(
        { jobId: dbJob.id, cron: dbJob.cron_expression },
        "[CronRunner] Scheduled/Updated cron job"
      );
    } catch (e) {
      logger.error(
        { jobId: dbJob.id, err: e.message },
        "[CronRunner] Failed to schedule cron job"
      );
    }
  }
}
