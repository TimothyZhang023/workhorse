import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import pinoHttp from "pino-http";
import { logger } from "./utils/logger.js";

import { syncCronJobs } from "./models/cronRunner.js";
import { listAllCronJobs } from "./models/database.js";
import { bootstrapChannelListeners } from "./models/channelRunner.js";
// import accountRoutes from "./routes/account.js"; -- User deleted these for standalone mode
// import adminRoutes from "./routes/admin.js";
import agentTasksRoutes from "./routes/agentTasks.js";
// import authRoutes from "./routes/auth.js";
import conversationRoutes from "./routes/conversations.js";
import cronJobsRoutes from "./routes/cronJobs.js";
import channelsRoutes from "./routes/channels.js";
import channelWebhooksRoutes from "./routes/channelWebhooks.js";
import endpointRoutes from "./routes/endpoints.js";
import mcpRoutes from "./routes/mcp.js";
import proxyRoutes from "./routes/proxy.js";
import skillsRoutes from "./routes/skills.js";
import systemRoutes from "./routes/system.js";

import { authMiddleware } from "./middleware/auth.js";

export function createApp() {
  const app = express();

  app.use(pinoHttp({ logger }));
  app.use(cors());
  app.use(cookieParser());
  app.use(express.json({ limit: "20mb" })); // 支持 base64 图片上传

  app.get("/health", async (req, res) => {
    try {
      const { getUpdateStatus } = await import("./services/updateChecker.js");
      res.json({ status: "ok", update: getUpdateStatus() });
    } catch {
      res.json({ status: "ok" });
    }
  });

  const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 60,
    message: { error: "接口调用过于频繁" },
  });

  // Apply Auth Middleware to all API routes
  app.use("/api", authMiddleware);

  // API 路由
  app.use("/api/conversations", conversationRoutes);
  app.use("/api/endpoints", endpointRoutes);
  app.use("/api/mcp", mcpRoutes);
  app.use("/api/skills", skillsRoutes);
  app.use("/api/agent-tasks", agentTasksRoutes);
  app.use("/api/cron-jobs", cronJobsRoutes);
  app.use("/api/channels", channelsRoutes);
  app.use("/api/channel-webhooks", channelWebhooksRoutes);
  app.use("/api/system", systemRoutes);

  // OpenAI 兼容代理 (/v1)
  app.use("/v1", apiLimiter, proxyRoutes);

  app.use((err, req, res, next) => {
    console.error("Test Error Handler Caught Exception:", err.stack || err);
    res.status(500).json({ error: err.message });
  });

  return app;
}

export function startServer(port = 12621) {
  const app = createApp();
  const server = http.createServer(app);

  server.listen(port, "127.0.0.1", async () => {
    console.log(`Server running at http://127.0.0.1:${port}`);

    try {
      syncCronJobs(listAllCronJobs());
      console.log("[Scheduler] Initialized all cron jobs");
    } catch (e) {
      console.error("[Scheduler] Failed to initialize cron jobs:", e.message);
    }

    try {
      bootstrapChannelListeners();
      console.log("[Channels] Initialized channel listeners");
    } catch (e) {
      console.error("[Channels] Failed to initialize channel listeners:", e.message);
    }

    try {
      const { startUpdateChecker } = await import("./services/updateChecker.js");
      startUpdateChecker();
      console.log("[Update] Background update checker started");
    } catch (e) {
      console.error("[Update] Failed to start update checker:", e.message);
    }
  });

  return server;
}
