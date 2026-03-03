import { Router } from 'express';
import {
  getConversations,
  createConversation,
  updateConversationTitle,
  updateConversationSystemPrompt,
  deleteConversation,
  getMessages,
  addMessage,
  updateMessage,
  deleteLastAssistantMessage,
  getEndpointGroups,
  getConversation,
  logUsage,
} from '../models/database.js';
import { authMiddleware } from '../middleware/auth.js';
import OpenAI from 'openai';

const router = Router();
router.use(authMiddleware);
const titleSummaryInFlight = new Set();

// ============ 对话 CRUD ============

router.get('/', (req, res) => {
  try {
    res.json(getConversations(req.uid));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { title } = req.body;
    res.json(createConversation(req.uid, title));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, system_prompt } = req.body;
    if (title !== undefined) updateConversationTitle(id, req.uid, title);
    if (system_prompt !== undefined) updateConversationSystemPrompt(id, req.uid, system_prompt);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    deleteConversation(req.params.id, req.uid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/messages', (req, res) => {
  try {
    res.json(getMessages(req.params.id, req.uid));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ 工具函数 ============

/**
 * 构建 OpenAI messages 数组，支持文本和 base64 图片
 */
function buildMessages(history, systemPrompt) {
  const result = [];
  if (systemPrompt && systemPrompt.trim()) {
    result.push({ role: 'system', content: systemPrompt.trim() });
  }
  for (const m of history) {
    if (m.role === 'user' && m.content.includes('[IMAGE_DATA:')) {
      const parts = [];
      const imageRegex = /\[IMAGE_DATA:([^\]]+)\]/g;
      const textContent = m.content.replace(imageRegex, '').trim();
      if (textContent) parts.push({ type: 'text', text: textContent });

      let match;
      const imageRegex2 = /\[IMAGE_DATA:([^\]]+)\]/g;
      while ((match = imageRegex2.exec(m.content)) !== null) {
        const base64Data = match[1];
        const mimeType = base64Data.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: 'auto' },
        });
      }
      result.push({ role: 'user', content: parts });
    } else {
      result.push({ role: m.role, content: m.content });
    }
  }
  return result;
}

/**
 * 获取带 Fallback 的 OpenAI client
 * 1. 优先使用默认 Endpoint
 * 2. 如果失败，自动切换到其他 Endpoint
 */
function getEndpoints(uid) {
  const groups = getEndpointGroups(uid);
  if (!groups.length) return [];
  // 默认的排首位
  return groups.sort((a, b) => b.is_default - a.is_default);
}

async function summarizeConversationTitle(uid, conversationId, preferredModel) {
  const taskKey = `${uid}:${conversationId}`;
  if (titleSummaryInFlight.has(taskKey)) return;
  titleSummaryInFlight.add(taskKey);

  try {
    const conversation = getConversation(conversationId, uid);
    if (!conversation) return;

    // 用户已手动命名时不覆盖
    if (conversation.title && conversation.title.trim() && conversation.title.trim() !== '新对话') {
      return;
    }

    const history = getMessages(conversationId, uid);
    const firstUser = history.find((m) => m.role === 'user');
    const firstAssistant = history.find((m) => m.role === 'assistant' && m.content?.trim());
    if (!firstUser || !firstAssistant) return;

    const userText = extractDisplayText(firstUser.content).slice(0, 400);
    const assistantText = extractDisplayText(firstAssistant.content).slice(0, 500);
    const endpoints = getEndpoints(uid);
    if (!endpoints.length) return;

    for (const ep of endpoints) {
      try {
        const client = new OpenAI({ apiKey: ep.api_key, baseURL: ep.base_url });
        const completion = await client.chat.completions.create({
          model: preferredModel || 'gpt-4o-mini',
          temperature: 0.2,
          max_tokens: 40,
          messages: [
            { role: 'system', content: '你是标题生成助手。请将对话总结为简短中文标题，长度 8-20 字，不要加引号、句号和前缀。' },
            {
              role: 'user',
              content: `用户问题：${userText}\n\n助手回答摘要：${assistantText}\n\n请输出标题：`,
            },
          ],
        });

        const rawTitle = completion.choices?.[0]?.message?.content || '';
        const normalized = rawTitle.replace(/["'“”‘’。！？!?.]/g, '').trim().slice(0, 28);
        if (!normalized) continue;

        updateConversationTitle(conversationId, uid, normalized);
        return;
      } catch (error) {
        console.warn(`[Title Summary] Endpoint "${ep.name}" failed: ${error.message}`);
      }
    }
  } finally {
    titleSummaryInFlight.delete(taskKey);
  }
}

function extractDisplayText(content) {
  return (content || '').replace(/\[IMAGE_DATA:[^\]]+\]/g, '[图片]');
}

async function streamWithFallback(uid, model, messages, res, opts = {}) {
  const endpoints = getEndpoints(uid);
  if (!endpoints.length) {
    res.write(`data: ${JSON.stringify({ error: '请先在设置中配置 API Endpoint' })}\n\n`);
    res.end();
    return false;
  }

  let lastError = null;
  for (const ep of endpoints) {
    try {
      const client = new OpenAI({ apiKey: ep.api_key, baseURL: ep.base_url });

      // 开启 stream usage 统计
      const streamParams = {
        model: model || 'gpt-4',
        messages,
        stream: true,
        stream_options: { include_usage: true },
      };

      const stream = await client.chat.completions.create(streamParams);

      let fullContent = '';
      let promptTokens = 0;
      let completionTokens = 0;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullContent += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
        // 捕获最终 usage 数据
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens || 0;
          completionTokens = chunk.usage.completion_tokens || 0;
        }
      }

      // 记录用量日志
      try {
        logUsage({
          uid,
          conversationId: opts.conversationId,
          model,
          endpointName: ep.name,
          promptTokens,
          completionTokens,
          source: opts.source || 'chat',
        });
      } catch (logErr) {
        console.warn('[Usage] Failed to log usage:', logErr.message);
      }

      return fullContent;
    } catch (error) {
      lastError = error;
      console.warn(`[Fallback] Endpoint "${ep.name}" failed: ${error.message}.`);
      if (endpoints.indexOf(ep) < endpoints.length - 1) {
        res.write(`data: ${JSON.stringify({ notice: '切换到备用端点中...' })}\n\n`);
      }
    }
  }

  res.write(`data: ${JSON.stringify({ error: `所有 API 端点均不可用：${lastError?.message}` })}\n\n`);
  res.end();
  return false;
}


// ============ 流式聊天 ============

router.post('/:id/chat', async (req, res) => {
  const { id } = req.params;
  const { message, model, images } = req.body;
  const uid = req.uid;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // 获取对话（含 system_prompt）
    const conversation = getConversation(id, uid);
    if (!conversation) {
      res.write(`data: ${JSON.stringify({ error: '对话不存在或无权限' })}\n\n`);
      res.end();
      return;
    }

    // 构建存储内容（图片用标记内嵌存储）
    let storedContent = message;
    if (images && images.length > 0) {
      storedContent += '\n' + images.map(img => `[IMAGE_DATA:${img}]`).join('\n');
    }
    addMessage(id, uid, 'user', storedContent);

    const history = getMessages(id, uid);
    const systemPrompt = conversation?.system_prompt || '';
    const messages = buildMessages(history, systemPrompt);

    const aiMsg = addMessage(id, uid, 'assistant', '');

    const fullContent = await streamWithFallback(uid, model, messages, res, { conversationId: id, source: 'chat' });
    if (fullContent === false) return;


    updateMessage(aiMsg.id, uid, fullContent);

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// 异步标题总结（不阻塞聊天）
router.post('/:id/summarize-title', (req, res) => {
  const { id } = req.params;
  const { model } = req.body || {};
  const uid = req.uid;

  const conversation = getConversation(id, uid);
  if (!conversation) {
    return res.status(404).json({ error: '对话不存在或无权限' });
  }

  summarizeConversationTitle(uid, id, model).catch((error) => {
    console.warn(`[Title Summary] Failed for conversation ${id}: ${error.message}`);
  });

  res.status(202).json({ queued: true });
});

// ============ 重新生成 ============

router.post('/:id/regenerate', async (req, res) => {
  const { id } = req.params;
  const { model } = req.body;
  const uid = req.uid;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const deleted = deleteLastAssistantMessage(id, uid);
    if (!deleted) {
      res.write(`data: ${JSON.stringify({ error: '没有可重新生成的 AI 消息' })}\n\n`);
      res.end();
      return;
    }

    const history = getMessages(id, uid);
    if (!history.length) {
      res.write(`data: ${JSON.stringify({ error: '没有可重新生成的消息' })}\n\n`);
      res.end();
      return;
    }

    const conversation = getConversation(id, uid);
    const systemPrompt = conversation?.system_prompt || '';
    const messages = buildMessages(history, systemPrompt);
    const aiMsg = addMessage(id, uid, 'assistant', '');

    const fullContent = await streamWithFallback(uid, model, messages, res, { conversationId: id, source: 'chat' });
    if (fullContent === false) return;


    updateMessage(aiMsg.id, uid, fullContent);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

export default router;
