import { Router } from "express";
import OpenAI from "openai";

import {
  addModel,
  createEndpointGroup,
  deleteEndpointGroup,
  deleteModel,
  getEndpointGroup,
  getEndpointGroups,
  getModels,
  PRESET_MODELS,
  replaceModels,
  setDefaultEndpointGroup,
  updateModelsEnabled,
  updateModel,
  updateEndpointGroup,
} from "../models/database.js";
import {
  getEnabledModelCatalog,
  getGlobalModelSettings,
  saveGlobalModelSettings,
} from "../utils/modelSelection.js";

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

function normalizeExportedModel(model = {}) {
  return {
    model_id: String(model.model_id || "").trim(),
    display_name: String(model.display_name || model.model_id || "").trim(),
    is_enabled: Number(model.is_enabled) === 1 ? 1 : 0,
    source: String(model.source || "manual").trim() || "manual",
    generation_config:
      model.generation_config &&
      typeof model.generation_config === "object" &&
      !Array.isArray(model.generation_config)
        ? model.generation_config
        : {},
  };
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
    const enabledModels = getEnabledModelCatalog(req.uid);
    if (enabledModels.length > 0) {
      return res.json(
        enabledModels.map((model) => ({
          id: model.id,
          model_id: model.model_id,
          display_name: model.display_name,
          is_enabled: model.is_enabled,
          endpoint_id: model.endpoint_id,
          endpoint_name: model.endpoint_name,
          endpoint_provider: model.endpoint_provider,
          generation_config: model.generation_config || {},
        }))
      );
    }

    const hasPresetEnabledEndpoint = getEndpointGroups(req.uid).some(
      (endpoint) => Number(endpoint.use_preset_models) === 1
    );
    if (hasPresetEnabledEndpoint) {
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

router.get("/settings/model-policy", (req, res) => {
  try {
    return res.json(getGlobalModelSettings(req.uid));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.put("/settings/model-policy", (req, res) => {
  try {
    const primaryModel = String(req.body?.primary_model || "").trim();
    const fallbackModels = Array.isArray(req.body?.fallback_models)
      ? req.body.fallback_models
      : [];

    return res.json(
      saveGlobalModelSettings(req.uid, {
        primary_model: primaryModel,
        fallback_models: fallbackModels,
      })
    );
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/export-config", (req, res) => {
  try {
    const endpoints = getEndpointGroups(req.uid).map((endpoint) => ({
      name: endpoint.name,
      provider: endpoint.provider || "openai_compatible",
      base_url: endpoint.base_url,
      is_default: Number(endpoint.is_default) === 1 ? 1 : 0,
      use_preset_models: Number(endpoint.use_preset_models) === 1 ? 1 : 0,
      models: getModels(endpoint.id, req.uid).map(normalizeExportedModel),
    }));

    return res.json({
      version: 1,
      exported_at: new Date().toISOString(),
      global_model_policy: getGlobalModelSettings(req.uid),
      endpoints,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/import-config", (req, res) => {
  try {
    const payload = req.body || {};
    const importedEndpoints = Array.isArray(payload?.endpoints) ? payload.endpoints : [];
    const importedPolicy = payload?.global_model_policy || {};
    const existingEndpoints = getEndpointGroups(req.uid);

    const results = [];
    for (const item of importedEndpoints) {
      const name = String(item?.name || "").trim();
      const provider = normalizeProvider(item?.provider);
      const baseUrl = resolveBaseUrl(provider, item?.base_url);
      if (!name || !baseUrl) {
        continue;
      }

      const models = Array.isArray(item?.models)
        ? item.models.map(normalizeExportedModel).filter((model) => model.model_id)
        : [];
      let endpoint = existingEndpoints.find(
        (existing) =>
          String(existing.name || "").trim() === name &&
          String(existing.provider || "openai_compatible") === provider &&
          String(existing.base_url || "").trim() === baseUrl
      );

      if (endpoint) {
        updateEndpointGroup(
          endpoint.id,
          req.uid,
          name,
          provider,
          baseUrl,
          undefined,
          Number(item?.use_preset_models) === 1
        );
        replaceModels(endpoint.id, req.uid, models);
        endpoint = getEndpointGroup(endpoint.id, req.uid);
        results.push({ status: "updated", endpoint_id: endpoint.id, name });
      } else {
        endpoint = createEndpointGroup(
          req.uid,
          name,
          provider,
          baseUrl,
          "",
          Number(item?.is_default) === 1,
          Number(item?.use_preset_models) === 1
        );
        replaceModels(endpoint.id, req.uid, models);
        results.push({ status: "created", endpoint_id: endpoint.id, name });
      }

      if (Number(item?.is_default) === 1 && endpoint?.id) {
        setDefaultEndpointGroup(endpoint.id, req.uid);
      }
    }

    saveGlobalModelSettings(req.uid, {
      primary_model: String(importedPolicy?.primary_model || "").trim(),
      fallback_models: Array.isArray(importedPolicy?.fallback_models)
        ? importedPolicy.fallback_models
        : [],
    });

    return res.json({
      success: true,
      imported: results,
      global_model_policy: getGlobalModelSettings(req.uid),
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
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
    const normalizedName = String(name || "").trim();
    const normalizedApiKey = String(api_key || "").trim();
    const normalizedProvider = normalizeProvider(provider);
    const resolvedBaseUrl = resolveBaseUrl(normalizedProvider, base_url);
    if (!normalizedName || !resolvedBaseUrl || !normalizedApiKey) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const group = createEndpointGroup(
      req.uid,
      normalizedName,
      normalizedProvider,
      resolvedBaseUrl,
      normalizedApiKey,
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
    const normalizedName = String(name || "").trim();
    const normalizedApiKey =
      api_key === undefined || api_key === null ? undefined : String(api_key).trim();
    const normalizedProvider = normalizeProvider(provider);
    const resolvedBaseUrl = resolveBaseUrl(normalizedProvider, base_url);
    if (!normalizedName || !resolvedBaseUrl) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    updateEndpointGroup(
      id,
      req.uid,
      normalizedName,
      normalizedProvider,
      resolvedBaseUrl,
      normalizedApiKey,
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
        is_enabled: 0,
        source: "remote",
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
    const { model_id, display_name, is_enabled, generation_config } = req.body;
    if (!String(model_id || "").trim()) {
      return res.status(400).json({ error: "model_id is required" });
    }

    const model = addModel(id, req.uid, String(model_id).trim(), display_name || model_id, {
      is_enabled,
      source: "manual",
      generation_config:
        generation_config && typeof generation_config === "object"
          ? generation_config
          : {},
    });
    res.json(model);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/models/:id", (req, res) => {
  try {
    updateModel(req.params.id, req.uid, req.body || {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/:id/models/batch", (req, res) => {
  try {
    const { id } = req.params;
    const modelIds = Array.isArray(req.body?.model_ids) ? req.body.model_ids : [];
    const isEnabled = Number(req.body?.is_enabled) === 1 ? 1 : 0;
    const result = updateModelsEnabled(id, req.uid, modelIds, isEnabled);
    res.json({ success: true, ...result });
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
