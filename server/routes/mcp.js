import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import {
    createMcpServer,
    deleteMcpServer,
    getMcpServer,
    listMcpServers,
    updateMcpServer,
} from "../models/database.js";
import { disconnectMcpServer } from "../models/mcpManager.js";

const router = Router();
router.use(authMiddleware);

// 获取用户配置的所有 MCP Server
router.get("/", (req, res) => {
    try {
        const servers = listMcpServers(req.uid);
        res.json(servers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 添加新的 MCP Server
router.post("/", (req, res) => {
    try {
        const { name, type, command, args, url, is_enabled } = req.body;

        if (!name || !type) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        if (type !== 'stdio' && type !== 'sse') {
            return res.status(400).json({ error: "Type must be stdio or sse" });
        }

        const server = createMcpServer(
            req.uid,
            name,
            type,
            command,
            args,
            url,
            is_enabled
        );
        res.json(server);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 更新 MCP Server
router.put("/:id", (req, res) => {
    try {
        const updates = req.body;
        updateMcpServer(req.params.id, req.uid, updates);
        // Drop existing connection so next call reconnects with new config
        disconnectMcpServer(req.uid, Number(req.params.id)).catch(console.error);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 删除 MCP Server
router.delete("/:id", (req, res) => {
    try {
        // Drop connection before deleting from DB
        disconnectMcpServer(req.uid, Number(req.params.id)).catch(console.error);
        deleteMcpServer(req.params.id, req.uid);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
