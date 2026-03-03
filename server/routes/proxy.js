/**
 * OpenAI 兼容 API 代理
 * 
 * 让外部工具（Cursor / Cline / VS Code 插件 / Open WebUI）连接 Timo，
 * 使用 Timo 管理的 API Endpoint 和模型。
 * 
 * 鉴权：Bearer <Timo API Key>（在用量统计 → API Keys 中创建）
 * Base URL: http://your-timo-host:8866/v1
 * 
 * 支持接口：
 *   GET  /v1/models              - 列出可用模型
 *   POST /v1/chat/completions    - 聊天补全（流式 / 非流式）
 */

import { Router } from 'express';
import OpenAI from 'openai';
import {
    verifyApiKey,
    getDefaultEndpointGroup,
    getEndpointGroups,
    PRESET_MODELS,
    logUsage,
} from '../models/database.js';

const router = Router();

// API Key 鉴权中间件
function proxyAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({
            error: { message: 'API Key 不能为空，请在 Timo 的设置 → API Keys 中创建', type: 'auth_error' }
        });
    }

    const uid = verifyApiKey(token);
    if (!uid) {
        return res.status(401).json({
            error: { message: '无效或已吊销的 API Key', type: 'invalid_request_error' }
        });
    }

    req.uid = uid;
    next();
}

router.use(proxyAuth);

// GET /v1/models - 列出可用模型
router.get('/models', (req, res) => {
    try {
        const models = PRESET_MODELS.map(m => ({
            id: m.model_id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'timo',
        }));
        res.json({ object: 'list', data: models });
    } catch (error) {
        res.status(500).json({ error: { message: error.message } });
    }
});

// POST /v1/chat/completions - 核心代理接口
router.post('/chat/completions', async (req, res) => {
    const {
        model,
        messages,
        stream = false,
        temperature,
        max_tokens,
        top_p,
        frequency_penalty,
        presence_penalty,
        stop,
    } = req.body;

    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: { message: 'messages 是必填字段', type: 'invalid_request_error' } });
    }

    try {
        // 获取所有 Endpoint，默认优先
        const endpoints = getEndpointGroups(req.uid).sort((a, b) => b.is_default - a.is_default);
        if (!endpoints.length) {
            return res.status(400).json({ error: { message: '请先在 Timo 中配置 API Endpoint', type: 'invalid_request_error' } });
        }

        let lastError = null;
        for (const ep of endpoints) {
            try {
                const client = new OpenAI({ apiKey: ep.api_key, baseURL: ep.base_url });

                const params = {
                    model: model || 'gpt-4',
                    messages,
                    stream,
                    ...(temperature !== undefined && { temperature }),
                    ...(max_tokens !== undefined && { max_tokens }),
                    ...(top_p !== undefined && { top_p }),
                    ...(frequency_penalty !== undefined && { frequency_penalty }),
                    ...(presence_penalty !== undefined && { presence_penalty }),
                    ...(stop !== undefined && { stop }),
                };

                if (stream) {
                    // 流式：直接透传 SSE
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Transfer-Encoding', 'chunked');
                    res.setHeader('x-timo-endpoint', ep.name);

                    params.stream_options = { include_usage: true };
                    const streamResp = await client.chat.completions.create(params);
                    let promptTokens = 0;
                    let completionTokens = 0;

                    for await (const chunk of streamResp) {
                        if (chunk.usage) {
                            promptTokens = chunk.usage.prompt_tokens || 0;
                            completionTokens = chunk.usage.completion_tokens || 0;
                        }
                        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    }
                    res.write('data: [DONE]\n\n');
                    res.end();

                    // 记录用量
                    logUsage({ uid: req.uid, model: model || 'gpt-4', endpointName: ep.name, promptTokens, completionTokens, source: 'proxy' });
                    return;
                } else {
                    // 非流式
                    const completion = await client.chat.completions.create(params);
                    res.setHeader('x-timo-endpoint', ep.name);
                    res.json(completion);

                    // 记录用量
                    const usage = completion.usage || {};
                    logUsage({ uid: req.uid, model: model || 'gpt-4', endpointName: ep.name, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, source: 'proxy' });
                    return;
                }
            } catch (error) {
                lastError = error;
                console.warn(`[Proxy Fallback] Endpoint "${ep.name}" failed: ${error.message}`);
            }
        }

        res.status(502).json({ error: { message: `所有 API 端点均不可用：${lastError?.message}`, type: 'server_error' } });
    } catch (error) {
        res.status(500).json({ error: { message: error.message, type: 'server_error' } });
    }
});

export default router;
