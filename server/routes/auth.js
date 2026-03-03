import { Router } from 'express';
import {
  createUser,
  getUserByUsername,
  verifyPassword,
  createRefreshToken,
  getRefreshToken,
  deleteSession,
  getUserByUid,
  triggerWebhooks,
} from '../models/database.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { authMiddleware } from '../middleware/auth.js';

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
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    createRefreshToken(user.uid, refreshToken);

    // 异步触发 Webhook
    triggerWebhooks('user.registration', { uid: user.uid, username: user.username });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7天
    });

    res.json({
      user: { uid: user.uid, username: user.username, role: user.role },
      token: accessToken
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

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    createRefreshToken(user.uid, refreshToken);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7天
    });

    res.json({
      user: { uid: user.uid, username: user.username, role: user.role },
      token: accessToken
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 登出
router.post('/logout', (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      deleteSession(refreshToken);
    }
    res.clearCookie('refreshToken');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 刷新 Token
router.post('/refresh', (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) return res.status(401).json({ error: '缺失 Refresh Token' });

    const session = getRefreshToken(refreshToken);
    if (!session) return res.status(401).json({ error: '无效的会话' });

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) return res.status(401).json({ error: 'RefreshToken 已过期' });

    const user = getUserByUid(decoded.uid);
    if (!user) return res.status(401).json({ error: '用户不存在' });

    const accessToken = generateAccessToken(user);
    res.json({ token: accessToken });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// 获取当前用户信息
router.get('/me', authMiddleware, (req, res) => {
  try {
    const user = getUserByUid(req.uid);
    if (!user) {
      return res.status(401).json({ error: '用户不存在' });
    }

    res.json({ uid: user.uid, username: user.username, role: user.role });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
