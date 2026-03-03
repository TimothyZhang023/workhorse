import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
    getUsageSummary,
    getUsageTotals,
    getUsageByModel,
    createApiKey,
    listApiKeys,
    revokeApiKey,
    deleteApiKey,
    createWebhook,
    listWebhooks,
    deleteWebhook,
    updateWebhookStatus,
} from '../models/database.js';

const router = Router();
router.use(authMiddleware);

// ============ 用量统计 ============

router.get('/summary', (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const [totals, byModel, daily] = [
            getUsageTotals(req.uid, days),
            getUsageByModel(req.uid, days),
            getUsageSummary(req.uid, days),
        ];
        res.json({ totals, byModel, daily });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ API Key 管理 ============

router.get('/api-keys', (req, res) => {
    try {
        res.json(listApiKeys(req.uid));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/api-keys', (req, res) => {
    try {
        const { name } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: '请输入 API Key 名称' });
        const result = createApiKey(req.uid, name.trim());
        res.json(result); // 返回明文 key（只此一次）
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/api-keys/:id/revoke', (req, res) => {
    try {
        revokeApiKey(req.params.id, req.uid);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/api-keys/:id', (req, res) => {
    try {
        deleteApiKey(req.params.id, req.uid);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ Webhooks ============

router.get('/webhooks', (req, res) => {
    try {
        res.json(listWebhooks(req.uid));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/webhooks', (req, res) => {
    try {
        const { name, url, events } = req.body;
        if (!name || !url) return res.status(400).json({ error: '必须填写名称和 URL' });
        const result = createWebhook(req.uid, name, url, events || []);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/webhooks/:id/status', (req, res) => {
    try {
        const { isActive } = req.body;
        updateWebhookStatus(req.params.id, req.uid, isActive);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/webhooks/:id', (req, res) => {
    try {
        deleteWebhook(req.params.id, req.uid);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
