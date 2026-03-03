import { getUserByUid } from '../models/database.js';

export function adminMiddleware(req, res, next) {
    const uid = req.uid;
    if (!uid) {
        return res.status(401).json({ error: '未登录' });
    }

    const user = getUserByUid(uid);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: '权限不足，仅管理员可执行此操作' });
    }

    next();
}
