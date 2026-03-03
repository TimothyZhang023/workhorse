import { Router } from 'express';
import {
  createUser,
  getUserByUsername,
  verifyPassword,
  createSession,
  deleteSession,
  getUserByUid,
  getSession
} from '../models/database.js';

const router = Router();

// 注册
router.post('/register', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '请填写用户名和密码' });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: '用户名长度需要3-20个字符' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: '密码长度至少6个字符' });
    }

    const existing = getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    const user = createUser(username, password);
    const session = createSession(user.uid);

    res.json({
      user: { uid: user.uid, username: user.username },
      token: session.token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 登录
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '请填写用户名和密码' });
    }

    const user = getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    if (!verifyPassword(user, password)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const session = createSession(user.uid);

    res.json({
      user: { uid: user.uid, username: user.username },
      token: session.token
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 登出
router.post('/logout', (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      deleteSession(token);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取当前用户信息
router.get('/me', (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: '未登录' });
    }

    const session = getSession(token);
    if (!session) {
      return res.status(401).json({ error: '登录已过期' });
    }

    const user = getUserByUid(session.uid);
    if (!user) {
      return res.status(401).json({ error: '用户不存在' });
    }

    res.json({ uid: user.uid, username: user.username });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
