import { getSession } from '../models/database.js';

export function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: '请先登录' });
  }

  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }

  req.uid = session.uid;
  req.token = token;
  next();
}

export function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;

  if (token) {
    const session = getSession(token);
    if (session) {
      req.uid = session.uid;
      req.token = token;
    }
  }

  next();
}
