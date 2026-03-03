import { verifyAccessToken } from '../utils/jwt.js';

export function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: '请先登录' });
  }

  const decoded = verifyAccessToken(token);
  if (!decoded) {
    return res.status(401).json({ error: '登录已过期或无效，请重新登录' });
  }

  req.uid = decoded.uid;
  req.user = decoded; // 包含 role, username 等
  req.token = token;
  next();
}

export function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (token) {
    const decoded = verifyAccessToken(token);
    if (decoded) {
      req.uid = decoded.uid;
      req.user = decoded;
      req.token = token;
    }
  }

  next();
}
