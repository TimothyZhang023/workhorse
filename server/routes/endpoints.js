import { Router } from 'express';
import {
  getEndpointGroups,
  getEndpointGroup,
  createEndpointGroup,
  updateEndpointGroup,
  setDefaultEndpointGroup,
  deleteEndpointGroup,
  getModels,
  addModel,
  deleteModel,
  getDefaultEndpointGroup,
  PRESET_MODELS
} from '../models/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// 获取预设模型列表 (无需认证)
router.get('/preset-models', (req, res) => {
  res.json(PRESET_MODELS);
});

router.use(authMiddleware);

// 获取前端可用的模型列表 (必须放在 /:id 之前)
router.get('/available/models', (req, res) => {
  try {
    const defaultGroup = getDefaultEndpointGroup(req.uid);
    if (!defaultGroup) {
      return res.json([]);
    }

    // 如果使用预设模型，返回预设列表
    if (defaultGroup.use_preset_models) {
      return res.json(PRESET_MODELS);
    }

    // 否则返回用户自定义模型
    const models = getModels(defaultGroup.id, req.uid);
    res.json(models);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有 endpoint 组
router.get('/', (req, res) => {
  try {
    const groups = getEndpointGroups(req.uid);
    const safeGroups = groups.map(g => ({
      id: g.id,
      name: g.name,
      base_url: g.base_url,
      is_default: g.is_default,
      use_preset_models: g.use_preset_models,
      created_at: g.created_at,
      updated_at: g.updated_at,
      api_key_preview: g.api_key ? g.api_key.slice(0, 8) + '...' : ''
    }));
    res.json(safeGroups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取单个 endpoint 组
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const group = getEndpointGroup(id, req.uid);
    if (!group) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 创建 endpoint 组
router.post('/', (req, res) => {
  try {
    const { name, base_url, api_key, is_default, use_preset_models } = req.body;
    if (!name || !base_url || !api_key) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const group = createEndpointGroup(req.uid, name, base_url, api_key, is_default, use_preset_models);
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新 endpoint 组
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, base_url, api_key, use_preset_models } = req.body;
    if (!name || !base_url) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    updateEndpointGroup(id, req.uid, name, base_url, api_key, use_preset_models);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 设置默认
router.put('/:id/default', (req, res) => {
  try {
    const { id } = req.params;
    setDefaultEndpointGroup(id, req.uid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除 endpoint 组
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    deleteEndpointGroup(id, req.uid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取模型列表
router.get('/:id/models', (req, res) => {
  try {
    const { id } = req.params;
    const models = getModels(id, req.uid);
    res.json(models);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 添加模型
router.post('/:id/models', (req, res) => {
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
router.delete('/models/:id', (req, res) => {
  try {
    const { id } = req.params;
    deleteModel(id, req.uid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
