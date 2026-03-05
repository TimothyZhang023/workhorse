import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import fs from "fs";
import { dirname, join } from "path";
import pinoHttp from "pino-http";
import { fileURLToPath } from "url";
import { logger } from "./utils/logger.js";

import accountRoutes from "./routes/account.js";
import adminRoutes from "./routes/admin.js";
import authRoutes from "./routes/auth.js";
import conversationRoutes from "./routes/conversations.js";
import endpointRoutes from "./routes/endpoints.js";
import proxyRoutes from "./routes/proxy.js";
import mcpRoutes from "./routes/mcp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createApp() {
  const app = express();

  app.use(pinoHttp({ logger }));
  app.use(cors());
  app.use(cookieParser());
  app.use(express.json({ limit: "20mb" })); // 支持 base64 图片上传
  app.use(express.static(join(__dirname, "../dist")));

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

  // OpenAI 兼容代理 (/v1)
  app.use("/v1", apiLimiter, proxyRoutes);

  // 处理 SPA 前端路由
  app.get("*", (req, res) => {
    const indexPath = join(__dirname, "../dist/index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.send(
        'Frontend not built. Please run "npm run build" or use "start_all.bat" to build the frontend.'
      );
    }
  });

  return app;
}

export function startServer(port = 8866) {
  const app = createApp();

  app.listen(port, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${port}`);
  });

  return app;
}
