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
  deleteLastMessages,
  getDefaultEndpointGroup,
  getEndpointGroups,
  getConversation,
} from '../models/database.js';
import { authMiddleware } from '../middleware/auth.js';
import OpenAI from 'openai';

const router = Router();
router.use(authMiddleware);

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

async function streamWithFallback(uid, model, messages, res) {
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
      const stream = await client.chat.completions.create({
        model: model || 'gpt-4',
        messages,
        stream: true,
      });

      let fullContent = '';
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullContent += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }
      return fullContent;
    } catch (error) {
      lastError = error;
      console.warn(`[Fallback] Endpoint "${ep.name}" failed: ${error.message}. Trying next...`);
      if (endpoints.indexOf(ep) < endpoints.length - 1) {
        res.write(`data: ${JSON.stringify({ notice: `切换到备用端点中...` })}\n\n`);
      }
    }
  }

  // 所有 Endpoint 都失败
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

    const fullContent = await streamWithFallback(uid, model, messages, res);
    if (fullContent === false) return;

    updateMessage(aiMsg.id, uid, fullContent);

    // 首次发言自动设置对话标题
    if (history.length === 1) {
      const title = message.slice(0, 30) + (message.length > 30 ? '...' : '');
      updateConversationTitle(id, uid, title);
      res.write(`data: ${JSON.stringify({ title })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
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
    deleteLastMessages(id, uid, 1);

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

    const fullContent = await streamWithFallback(uid, model, messages, res);
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
