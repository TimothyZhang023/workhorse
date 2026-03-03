import { Router } from 'express';
import {
  getConversations,
  createConversation,
  updateConversationTitle,
  deleteConversation,
  getMessages,
  addMessage,
  updateMessage,
  getDefaultEndpointGroup
} from '../models/database.js';
import { authMiddleware } from '../middleware/auth.js';
import OpenAI from 'openai';

const router = Router();

// 所有路由需要认证
router.use(authMiddleware);

// 获取所有对话
router.get('/', (req, res) => {
  try {
    const conversations = getConversations(req.uid);
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 创建新对话
router.post('/', (req, res) => {
  try {
    const { title } = req.body;
    const conversation = createConversation(req.uid, title);
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新对话标题
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;
    updateConversationTitle(id, req.uid, title);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除对话
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    deleteConversation(id, req.uid);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取对话的消息
router.get('/:id/messages', (req, res) => {
  try {
    const { id } = req.params;
    const messages = getMessages(id, req.uid);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 流式聊天
router.post('/:id/chat', async (req, res) => {
  const { id } = req.params;
  const { message, model } = req.body;
  const uid = req.uid;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const endpointGroup = getDefaultEndpointGroup(uid);
    if (!endpointGroup) {
      res.write(`data: ${JSON.stringify({ error: '请先在设置中配置 API Endpoint' })}\n\n`);
      res.end();
      return;
    }

    const client = new OpenAI({
      apiKey: endpointGroup.api_key,
      baseURL: endpointGroup.base_url,
    });

    addMessage(id, uid, 'user', message);

    const history = getMessages(id, uid);
    const messages = history.map(m => ({ role: m.role, content: m.content }));

    const aiMsg = addMessage(id, uid, 'assistant', '');

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

    updateMessage(aiMsg.id, uid, fullContent);

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

export default router;
