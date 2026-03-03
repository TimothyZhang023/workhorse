import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { adminMiddleware } from '../middleware/admin.js';
import {
    listAllUsers,
    updateUserRole,
    adminDeleteUser,
} from '../models/database.js';

const router = Router();

// 所有 admin 路由都需要登录且是管理员
router.use(authMiddleware);
router.use(adminMiddleware);

// 获取所有用户列表
router.get('/users', (req, res) => {
    try {
        const users = listAllUsers();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 修改用户角色
router.put('/users/:uid/role', (req, res) => {
    try {
        const { uid } = req.params;
        const { role } = req.body;

        if (role !== 'admin' && role !== 'user') {
            return res.status(400).json({ error: '无效的角色类型' });
        }

        // 防止管理员取消自己的管理员权限（如果需要这种保护）
        if (uid === req.uid && role === 'user') {
            return res.status(400).json({ error: '不能取消自己的管理员权限' });
        }

        updateUserRole(uid, role);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 管理员删除用户
router.delete('/users/:uid', (req, res) => {
    try {
        const { uid } = req.params;

        if (uid === req.uid) {
            return res.status(400).json({ error: '不能删除自己' });
        }

        adminDeleteUser(uid);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
