import { Router } from "express";

import {
  clearAllHistory,
  getAppSetting,
  listAgentTasks,
  listChannels,
  listCronJobs,
  listMcpServers,
  listSkills,
  setAppSetting,
} from "../models/database.js";

const router = Router();

const GLOBAL_SYSTEM_PROMPT_MD_KEY = "global_system_prompt_markdown";

router.get("/settings/global-system-prompt", (req, res) => {
  try {
    return res.json({
      key: GLOBAL_SYSTEM_PROMPT_MD_KEY,
      markdown: getAppSetting(
        req.uid,
        GLOBAL_SYSTEM_PROMPT_MD_KEY,
        process.env.GLOBAL_SYSTEM_PROMPT_MD || ""
      ),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.put("/settings/global-system-prompt", (req, res) => {
  try {
    const markdown = String(req.body?.markdown ?? "");
    if (markdown.length > 20000) {
      return res
        .status(400)
        .json({ error: "markdown too long (max 20000 chars)" });
    }

    const saved = setAppSetting(req.uid, GLOBAL_SYSTEM_PROMPT_MD_KEY, markdown);
    return res.json({ success: true, ...saved });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete("/history", (req, res) => {
  try {
    const result = clearAllHistory(req.uid);
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/overview", async (req, res) => {
  try {
    const [tasks, skills, channels, cronJobs, mcpServers] = await Promise.all([
      Promise.resolve(listAgentTasks(req.uid)),
      Promise.resolve(listSkills(req.uid)),
      Promise.resolve(listChannels(req.uid)),
      Promise.resolve(listCronJobs(req.uid)),
      Promise.resolve(listMcpServers(req.uid)),
    ]);

    const enabledMcpCount = mcpServers.filter((item) => item.is_enabled).length;
    const enabledChannelCount = channels.filter(
      (item) => item.is_enabled
    ).length;

    return res.json({
      runtime: {
        node: process.version,
        platform: process.platform,
        uptime_seconds: Math.floor(process.uptime()),
      },
      counts: {
        tasks: tasks.length,
        skills: skills.length,
        channels: channels.length,
        channels_enabled: enabledChannelCount,
        cron_jobs: cronJobs.length,
        mcp_servers: mcpServers.length,
        mcp_enabled: enabledMcpCount,
      },
      recommendations: [
        enabledMcpCount === 0
          ? "建议先安装 MCP Quickstart 套件，避免任务无工具可用。"
          : "MCP 已配置，可继续优化工具权限与超时。",
        skills.length === 0
          ? "建议安装默认 Skill 模板，提升任务稳定性。"
          : "Skills 已配置，可尝试按场景拆分为更小技能。",
      ],
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
