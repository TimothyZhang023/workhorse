import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import fs from "fs";
import http from "http";
import { createProxyMiddleware } from "http-proxy-middleware";
import { dirname, join } from "path";
import pinoHttp from "pino-http";
import { fileURLToPath } from "url";
import { logger } from "./utils/logger.js";

import { syncCronJobs } from "./models/cronRunner.js";
import { listAllCronJobs } from "./models/database.js";
import accountRoutes from "./routes/account.js";
import adminRoutes from "./routes/admin.js";
import agentTasksRoutes from "./routes/agentTasks.js";
import authRoutes from "./routes/auth.js";
import conversationRoutes from "./routes/conversations.js";
import cronJobsRoutes from "./routes/cronJobs.js";
import endpointRoutes from "./routes/endpoints.js";
import mcpRoutes from "./routes/mcp.js";
import proxyRoutes from "./routes/proxy.js";
import skillsRoutes from "./routes/skills.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function isApiLikePath(pathname = "") {
  return (
    pathname === "/health" ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/v1")
  );
}

export function createApp() {
  const app = express();
  const frontendDevUrl = (process.env.FRONTEND_DEV_URL || "").trim();
  const enableFrontendProxy = Boolean(frontendDevUrl);
  const distDir = join(__dirname, "../dist");

  app.use(pinoHttp({ logger }));
  app.use(cors());
  app.use(cookieParser());
  app.use(express.json({ limit: "20mb" })); // 支持 base64 图片上传
  if (!enableFrontendProxy) {
    app.use(express.static(distDir));
  }

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // 速率限制
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 分钟
    max: 100, // 每个 IP 100 次请求
    message: { error: "请求过于频繁，请稍后再试" },
  });

  const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 分钟
    max: 60, // 每分钟 60 次
    message: { error: "接口调用过于频繁" },
  });

  // API 路由
  app.use("/api/auth", authLimiter, authRoutes);
  app.use("/api/conversations", conversationRoutes);
  app.use("/api/endpoints", endpointRoutes);
  app.use("/api/account", accountRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/mcp", mcpRoutes);
  app.use("/api/skills", skillsRoutes);
  app.use("/api/agent-tasks", agentTasksRoutes);
  app.use("/api/cron-jobs", cronJobsRoutes);

  // OpenAI 兼容代理 (/v1)
  app.use("/v1", apiLimiter, proxyRoutes);

  if (enableFrontendProxy) {
    const frontendProxy = createProxyMiddleware({
      target: frontendDevUrl,
      changeOrigin: true,
      ws: true,
      xfwd: true,
      logLevel: "warn",
    });

    app.use((req, res, next) => {
      if (isApiLikePath(req.path)) {
        return next();
      }
      return frontendProxy(req, res, next);
    });

    app.locals.frontendWsProxy = frontendProxy;
    app.locals.frontendDevUrl = frontendDevUrl;
  } else {
    // 处理 SPA 前端路由
    app.get("*", (req, res) => {
      const indexPath = join(distDir, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.send(
          'Frontend not built. Please run "npm run build" or start dev mode.'
        );
      }
    });
  }

  return app;
}

export function startServer(port = 8000) {
  const app = createApp();
  const server = http.createServer(app);
  const frontendWsProxy = app.locals.frontendWsProxy;

  if (frontendWsProxy) {
    server.on("upgrade", (req, socket, head) => {
      const reqPath = (req.url || "").split("?")[0] || "";
      if (!isApiLikePath(reqPath)) {
        frontendWsProxy.upgrade(req, socket, head);
      }
    });
  }

  server.listen(port, "0.0.0.0", () => {
    const frontendInfo = app.locals.frontendDevUrl
      ? `, frontend proxy -> ${app.locals.frontendDevUrl}`
      : "";
    console.log(`Server running at http://localhost:${port}`);
    if (frontendInfo) {
      console.log(`Mode: single-port dev${frontendInfo}`);
    }

    // Initialize Cron Jobs
    try {
      syncCronJobs(listAllCronJobs());
      console.log("[Scheduler] Initialized all cron jobs");
    } catch (e) {
      console.error("[Scheduler] Failed to initialize cron jobs:", e.message);
    }
  });

  return server;
}
