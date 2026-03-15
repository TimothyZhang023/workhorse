import { Router } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
import { getAllAvailableTools } from "../models/mcpManager.js";
import { getShellEnv } from "../utils/shellEnv.js";
import { buildStaticContextBudget } from "../utils/contextBudget.js";
import { getPreferredEnabledModel } from "../utils/modelSelection.js";

const router = Router();
const execFileAsync = promisify(execFile);

const GLOBAL_SYSTEM_PROMPT_MD_KEY = "global_system_prompt_markdown";
const NETWORK_TARGETS = [
  "https://github.com",
  "https://www.google.com",
  "https://www.alipay.com",
];

async function withTimeout(promise, ms, fallbackValue) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallbackValue), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function inspectCommand(binary, args = ["--version"]) {
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      env: getShellEnv(),
      timeout: 5000,
      maxBuffer: 1024 * 128,
    });
    const output = String(stdout || stderr || "").trim().split("\n")[0] || "ok";
    return {
      name: binary,
      installed: true,
      version: output,
    };
  } catch (error) {
    return {
      name: binary,
      installed: false,
      version: "",
      error: error.code === "ENOENT" ? "未安装" : error.message,
    };
  }
}

async function inspectPython() {
  const p3 = await inspectCommand("python3");
  if (p3.installed) {
    return { ...p3, name: "Python" };
  }
  const p = await inspectCommand("python");
  if (p.installed && p.version.startsWith("Python 3")) {
    return { ...p, name: "Python" };
  }
  return {
    name: "Python",
    installed: false,
    version: "",
    error: p3.installed ? "" : p3.error,
  };
}
async function inspectNetworkTarget(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    });
    return {
      target: url.replace(/^https?:\/\//, ""),
      reachable: true,
      status: response.status,
    };
  } catch (error) {
    return {
      target: url.replace(/^https?:\/\//, ""),
      reachable: false,
      status: 0,
      error: error?.message || "网络不可达",
    };
  }
}

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

import { getUpdateStatus } from "../services/updateChecker.js";

router.get("/overview", async (req, res) => {
  try {
    const update = getUpdateStatus();
    const [tasks, skills, channels, cronJobs, mcpServers, commandChecks, networkChecks] =
      await Promise.all([
      Promise.resolve(listAgentTasks(req.uid)),
      Promise.resolve(listSkills(req.uid)),
      Promise.resolve(listChannels(req.uid)),
      Promise.resolve(listCronJobs(req.uid)),
      Promise.resolve(listMcpServers(req.uid)),
        Promise.all([
          inspectCommand("node"),
          inspectCommand("npm"),
          inspectCommand("brew"),
          inspectPython(),
        ]),
        Promise.all(NETWORK_TARGETS.map((url) => inspectNetworkTarget(url))),
      ]);

    const enabledMcpCount = mcpServers.filter((item) => item.is_enabled).length;
    const enabledChannelCount = channels.filter(
      (item) => item.is_enabled
    ).length;
    const enabledSkills = skills.filter((item) => Number(item.is_enabled) === 1);
    const globalMarkdown = getAppSetting(
      req.uid,
      GLOBAL_SYSTEM_PROMPT_MD_KEY,
      process.env.GLOBAL_SYSTEM_PROMPT_MD || ""
    );
    const preferredModel = getPreferredEnabledModel(req.uid);
    const mcpTools = await withTimeout(getAllAvailableTools(req.uid), 6000, []);
    const contextBudget = buildStaticContextBudget({
      globalMarkdown,
      skills: enabledSkills,
      tools: Array.isArray(mcpTools) ? mcpTools : [],
      contextWindow: preferredModel?.generation_config?.context_window,
    });

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
      health: {
        commands: commandChecks,
        network: networkChecks,
      },
      context_budget: {
        ...contextBudget,
        active_model: preferredModel
          ? {
              model_id: preferredModel.model_id,
              display_name: preferredModel.display_name,
            }
          : null,
      },
      recommendations: [
        enabledMcpCount === 0
          ? "建议先安装 MCP Quickstart 套件，避免任务无工具可用。"
          : "MCP 已配置，可继续优化工具权限与超时。",
        skills.length === 0
          ? "建议安装默认 Skill 模板，提升任务稳定性。"
          : "Skills 已配置，可尝试按场景拆分为更小技能。",
        contextBudget.static_percentage >= 70
          ? "静态上下文已接近压缩阈值，建议收敛 Skills 或工具 schema。"
          : "当前静态上下文预算健康，可继续扩展任务记忆。",
      ],
      update,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
