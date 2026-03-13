import { Router } from "express";
import OpenAI from "openai";

import {
  addModel,
  createEndpointGroup,
  deleteEndpointGroup,
  deleteModel,
  getDefaultEndpointGroup,
  getEndpointGroup,
  getEndpointGroups,
  getModels,
  PRESET_MODELS,
  replaceModels,
  setDefaultEndpointGroup,
  updateEndpointGroup,
} from "../models/database.js";

const router = Router();

const SUPPORTED_PROVIDERS = new Set([
  "openai_compatible",
  "openai",
  "gemini",
  "openrouter",
]);

const DEFAULT_BASE_URL_BY_PROVIDER = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openrouter: "https://openrouter.ai/api/v1",
};

function normalizeProvider(provider) {
  const normalized = String(provider || "openai_compatible").toLowerCase();
  return SUPPORTED_PROVIDERS.has(normalized) ? normalized : "openai_compatible";
}

function resolveBaseUrl(provider, baseUrl) {
  const trimmed = String(baseUrl || "").trim();
  if (trimmed) {
    return trimmed;
  }
  return DEFAULT_BASE_URL_BY_PROVIDER[provider] || "";
}

function normalizeBaseUrlCandidates(baseUrl) {
  const trimmed = String(baseUrl || "").replace(/\/+$/, "");
  const candidates = [trimmed];

  if (!trimmed.endsWith("/v1")) {
    candidates.push(`${trimmed}/v1`);
  }
  if (!trimmed.endsWith("/api/v1")) {
    candidates.push(`${trimmed}/api/v1`);
  }

  return [...new Set(candidates)];
}

function normalizeOpenRouterBaseCandidates(baseUrl) {
  const trimmed = String(baseUrl || "").replace(/\/+$/, "");
  const variants = new Set([
    trimmed,
    trimmed.replace(/\/models$/i, ""),
    trimmed.replace(/\/chat\/completions$/i, ""),
    trimmed.replace(/\/completions$/i, ""),
  ]);

  const candidates = [];
  for (const item of variants) {
    if (!item) continue;
    candidates.push(item);
    if (!item.endsWith("/api/v1")) {
      candidates.push(`${item.replace(/\/+$/, "")}/api/v1`);
    }
  }

  return [...new Set(candidates)];
}

async function fetchRemoteModels(endpoint) {
  if (endpoint.provider === "openrouter") {
    const candidates = normalizeOpenRouterBaseCandidates(endpoint.base_url);
    let lastStatus = null;
    let lastError = null;

    for (const baseURL of candidates) {
      try {
        const response = await fetch(`${baseURL}/models`, {
          headers: {
            Authorization: `Bearer ${endpoint.api_key}`,
          },
        });
        if (!response.ok) {
          lastStatus = response.status;
          if (response.status === 404) {
            continue;
          }
          throw new Error(`OpenRouter 获取模型失败: HTTP ${response.status}`);
        }
        const payload = await response.json();
        return {
          models: Array.isArray(payload?.data) ? payload.data : [],
          baseURL,
        };
      } catch (error) {
        lastError = error;
        continue;
      }
    }

    if (lastError && !lastStatus) {
      throw lastError;
    }
    throw new Error(`OpenRouter 获取模型失败: HTTP ${lastStatus || 404}`);
  }

  if (
    endpoint.provider === "gemini" &&
    endpoint.base_url.includes("generativelanguage.googleapis.com") &&
    !endpoint.base_url.includes("/openai")
  ) {
    const baseURL = endpoint.base_url.replace(/\/+$/, "");
    const separator = baseURL.includes("?") ? "&" : "?";
    const response = await fetch(
      `${baseURL}/models${separator}key=${encodeURIComponent(endpoint.api_key)}`
    );
    if (!response.ok) {
      throw new Error(`Gemini 获取模型失败: HTTP ${response.status}`);
    }
    const payload = await response.json();
    return {
      models: Array.isArray(payload?.models)
        ? payload.models.map((item) => ({
            id: String(item.name || "").replace(/^models\//, ""),
          }))
        : [],
      baseURL,
    };
  }

  const candidates = normalizeBaseUrlCandidates(endpoint.base_url);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const client = new OpenAI({
        apiKey: endpoint.api_key,
        baseURL: candidate,
      });
      const response = await client.models.list();
      return {
        models: Array.isArray(response?.data) ? response.data : [],
        baseURL: candidate,
      };
    } catch (error) {
      lastError = error;
      const status = error?.status || error?.cause?.status;
      if (status && status !== 404) {
        break;
      }
    }
  }

  throw lastError || new Error("获取远程模型列表失败");
}

// 获取预设模型列表 (无需认证)
router.get("/preset-models", (req, res) => {
  res.json(PRESET_MODELS);
});



// 获取前端可用的模型列表 (必须放在 /:id 之前)
router.get("/available/models", (req, res) => {
  try {
    const defaultGroup = getDefaultEndpointGroup(req.uid);
    if (!defaultGroup) {
      return res.json([]);
    }

    const models = getModels(defaultGroup.id, req.uid);
    if (models.length > 0) {
      return res.json(models);
    }

    // 数据库没有模型时，预设模式才回退到写死列表
    if (defaultGroup.use_preset_models) {
      return res.json(PRESET_MODELS);
    }

    res.json([]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有 endpoint 组
router.get("/", (req, res) => {
  try {
    const groups = getEndpointGroups(req.uid);
    const safeGroups = groups.map((g) => ({
      id: g.id,
      name: g.name,
      provider: g.provider || "openai_compatible",
      base_url: g.base_url,
      is_default: g.is_default,
      use_preset_models: g.use_preset_models,
      created_at: g.created_at,
      updated_at: g.updated_at,
      api_key_preview: g.api_key ? g.api_key.slice(0, 8) + "..." : "",
    }));
    res.json(safeGroups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取单个 endpoint 组
router.get("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const group = getEndpointGroup(id, req.uid);
    if (!group) {
      return res.status(404).json({ error: "Endpoint not found" });
    }
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 创建 endpoint 组
router.post("/", (req, res) => {
  try {
    const { name, provider, base_url, api_key, is_default, use_preset_models } =
      req.body;
    const normalizedProvider = normalizeProvider(provider);
    const resolvedBaseUrl = resolveBaseUrl(normalizedProvider, base_url);
    if (!name || !resolvedBaseUrl || !api_key) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const group = createEndpointGroup(
      req.uid,
      name,
      normalizedProvider,
      resolvedBaseUrl,
      api_key,
      is_default,
      use_preset_models
    );
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新 endpoint 组
router.put("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { name, provider, base_url, api_key, use_preset_models } = req.body;
    const normalizedProvider = normalizeProvider(provider);
    const resolvedBaseUrl = resolveBaseUrl(normalizedProvider, base_url);
    if (!name || !resolvedBaseUrl) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    updateEndpointGroup(
      id,
      req.uid,
      name,
      normalizedProvider,
      resolvedBaseUrl,
      api_key,
      use_preset_models
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 设置默认
router.put("/:id/default", (req, res) => {
  try {
    const { id } = req.params;
    setDefaultEndpointGroup(id, req.uid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除 endpoint 组
router.delete("/:id", (req, res) => {
  try {
    const { id } = req.params;
    deleteEndpointGroup(id, req.uid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取模型列表
router.get("/:id/models", (req, res) => {
  try {
    const { id } = req.params;
    const models = getModels(id, req.uid);
    res.json(models);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 同步模型列表到数据库
router.post("/:id/models/sync", async (req, res) => {
  try {
    const { id } = req.params;
    const endpoint = getEndpointGroup(id, req.uid);
    if (!endpoint) {
      return res.status(404).json({ error: "Endpoint not found" });
    }

    const { models: remoteModels, baseURL } = await fetchRemoteModels(endpoint);

    const normalizedModels = remoteModels
      .map((model) => ({
        model_id: model.id,
        display_name: model.id,
      }))
      .filter((model) => !!model.model_id);

    replaceModels(id, req.uid, normalizedModels);

    res.json({
      success: true,
      count: normalizedModels.length,
      base_url_used: baseURL,
      models: getModels(id, req.uid),
    });
  } catch (error) {
    res.status(500).json({
      error: error?.message || "同步模型列表失败",
    });
  }
});

// 添加模型
router.post("/:id/models", (req, res) => {
  try {
    const { id } = req.params;
    const { model_id, display_name } = req.body;
    const model = addModel(id, req.uid, model_id, display_name);
    res.json(model);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除模型
router.delete("/models/:id", (req, res) => {
  try {
    const { id } = req.params;
    deleteModel(id, req.uid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
