import crypto from "crypto";
import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { decrypt, encrypt } from "../utils/crypto.js";
import { createDatabaseClient } from "./dbClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 确保数据目录存在
const dataDir = join(__dirname, "../../data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || join(dataDir, "chat.db");
const db = createDatabaseClient({ dbPath });

// 初始化数据库表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    title TEXT NOT NULL,
    system_prompt TEXT DEFAULT '',
    tool_names TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    uid TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS endpoint_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT DEFAULT 'openai_compatible',
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    use_preset_models INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint_group_id INTEGER NOT NULL,
    uid TEXT NOT NULL,
    model_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 1,
    FOREIGN KEY (endpoint_group_id) REFERENCES endpoint_groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    conversation_id INTEGER,
    model TEXT NOT NULL,
    endpoint_name TEXT,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    source TEXT DEFAULT 'chat',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT UNIQUE NOT NULL,
    key_prefix TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    last_used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    secret TEXT,
    events TEXT DEFAULT '[]', -- JSON 数组：['user.registration', 'chat.usage_threshold']
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_uid ON conversations(uid);
  CREATE INDEX IF NOT EXISTS idx_messages_uid ON messages(uid);
  CREATE INDEX IF NOT EXISTS idx_endpoint_groups_uid ON endpoint_groups(uid);
  CREATE INDEX IF NOT EXISTS idx_models_uid ON models(uid);
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_uid ON usage_logs(uid);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
  CREATE INDEX IF NOT EXISTS idx_webhooks_uid ON webhooks(uid);

  CREATE TABLE IF NOT EXISTS mcp_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    command TEXT,
    args TEXT,
    url TEXT,
    env TEXT,     -- JSON 对象：{"API_KEY": "..."}
    headers TEXT, -- JSON 对象：{"X-Custom": "value"}
    auth TEXT,    -- JSON 对象：{"type": "bearer", "token": "..."}
    is_enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(uid) REFERENCES users(uid) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    prompt TEXT NOT NULL,
    examples TEXT, -- JSON 数组: [{"thought": "...", "action": "..."}]
    tools TEXT,    -- JSON 数组 of strings (MCP tool names)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(uid) REFERENCES users(uid) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS agent_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    system_prompt TEXT NOT NULL,
    skill_ids TEXT, -- JSON 数组 of skill IDs
    tool_names TEXT, -- JSON 数组 of tool names (mcp)
    model_id TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(uid) REFERENCES users(uid) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cron_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    task_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    next_run DATETIME,
    last_run DATETIME,
    last_status TEXT, -- 'success', 'failed', 'running'
    is_enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(uid) REFERENCES users(uid) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS task_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    task_id INTEGER NOT NULL,
    cron_job_id INTEGER,
    conversation_id INTEGER,
    trigger_source TEXT DEFAULT 'manual',
    status TEXT DEFAULT 'running',
    initial_message TEXT,
    final_response TEXT,
    error_message TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(uid) REFERENCES users(uid) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE,
    FOREIGN KEY(cron_job_id) REFERENCES cron_jobs(id) ON DELETE SET NULL,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS task_run_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    uid TEXT NOT NULL,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(run_id) REFERENCES task_runs(id) ON DELETE CASCADE,
    FOREIGN KEY(uid) REFERENCES users(uid) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_mcp_servers_uid ON mcp_servers(uid);
  CREATE INDEX IF NOT EXISTS idx_skills_uid ON skills(uid);
  CREATE INDEX IF NOT EXISTS idx_agent_tasks_uid ON agent_tasks(uid);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_uid ON cron_jobs(uid);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_task_id ON cron_jobs(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_runs_uid ON task_runs(uid);
  CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_runs_cron_job_id ON task_runs(cron_job_id);
  CREATE INDEX IF NOT EXISTS idx_task_runs_started_at ON task_runs(started_at);
  CREATE INDEX IF NOT EXISTS idx_task_run_events_run_id ON task_run_events(run_id);
`);

try {
  db.prepare(
    "ALTER TABLE conversations ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL"
  ).run();
} catch (e) {
  /* column already exists */
}

// 运行时迁移：添加 provider 列（已存在时忽略）
try {
  db.prepare(
    "ALTER TABLE endpoint_groups ADD COLUMN provider TEXT DEFAULT 'openai_compatible'"
  ).run();
} catch (e) {
  /* column already exists */
}

// 运行时迁移：加密现有的已存储 API Keys
try {
  const allGroups = db.prepare("SELECT id, api_key FROM endpoint_groups").all();
  for (const group of allGroups) {
    if (group.api_key && !group.api_key.includes(":")) {
      const encrypted = encrypt(group.api_key);
      db.prepare("UPDATE endpoint_groups SET api_key = ? WHERE id = ?").run(
        encrypted,
        group.id
      );
    }
  }
} catch (e) {
  console.error(
    "[DB Migration] Failed to encrypt existing API keys:",
    e.message
  );
}

// 全局预设模型列表（仅作兜底，建议用户通过"同步模型"拉取真实列表）
export const PRESET_MODELS = [{ model_id: "default", display_name: "Default" }];

// MCP 动态迁移
try {
  db.prepare("ALTER TABLE mcp_servers ADD COLUMN headers TEXT").run();
} catch (e) {
  /* column already exists */
}
try {
  db.prepare("ALTER TABLE mcp_servers ADD COLUMN auth TEXT").run();
} catch (e) {
  /* column already exists */
}
try {
  db.prepare("ALTER TABLE mcp_servers ADD COLUMN env TEXT").run();
} catch (e) {
  /* column already exists */
}

try {
  db.prepare("ALTER TABLE agent_tasks ADD COLUMN model_id TEXT").run();
} catch (e) {
  /* column already exists */
}

export function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
}

export function createUser(username, password) {
  const uid = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);

  // 检查是否是第一个用户，如果是，则设为 admin
  const userCount = db
    .prepare("SELECT COUNT(*) as count FROM users")
    .get().count;
  const role = userCount === 0 ? "admin" : "user";

  const result = db
    .prepare(
      `
    INSERT INTO users (uid, username, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)
  `
    )
    .run(uid, username, passwordHash, salt, role);

  return { id: result.lastInsertRowid, uid, username, role };
}

export function getUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}

export function getUserByUid(uid) {
  return db.prepare("SELECT * FROM users WHERE uid = ?").get(uid);
}

export function verifyPassword(user, password) {
  const hash = hashPassword(password, user.salt);
  return hash === user.password_hash;
}

// ============ 用户管理 (Admin Only) ============

export function listAllUsers() {
  return db
    .prepare(
      "SELECT uid, username, role, created_at FROM users ORDER BY created_at DESC"
    )
    .all();
}

export function updateUserRole(uid, role) {
  db.prepare("UPDATE users SET role = ? WHERE uid = ?").run(role, uid);
}

export function adminDeleteUser(uid) {
  db.prepare("DELETE FROM sessions WHERE uid = ?").run(uid);
  db.prepare("DELETE FROM messages WHERE uid = ?").run(uid);
  db.prepare("DELETE FROM conversations WHERE uid = ?").run(uid);
  db.prepare("DELETE FROM endpoint_groups WHERE uid = ?").run(uid);
  db.prepare("DELETE FROM api_keys WHERE uid = ?").run(uid);
  db.prepare("DELETE FROM usage_logs WHERE uid = ?").run(uid);
  db.prepare("DELETE FROM users WHERE uid = ?").run(uid);
}

// ============ 会话管理 (Refresh Tokens) ============

export function createRefreshToken(uid, token) {
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000
  ).toISOString(); // 7天过期

  db.prepare(
    `
    INSERT INTO sessions (uid, token, expires_at) VALUES (?, ?, ?)
  `
  ).run(uid, token, expiresAt);

  return { token, expiresAt };
}

export function getRefreshToken(token) {
  return db
    .prepare(
      `
    SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')
  `
    )
    .get(token);
}

export function deleteSession(token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function cleanExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

// ============ 对话管理 ============

// 运行时迁移：添加 system_prompt 列（已存在时忽略）
try {
  db.prepare(
    'ALTER TABLE conversations ADD COLUMN system_prompt TEXT DEFAULT ""'
  ).run();
} catch (e) {
  /* column already exists */
}

try {
  db.prepare("ALTER TABLE conversations ADD COLUMN tool_names TEXT").run();
} catch (e) {
  /* column already exists */
}

function parseJsonArray(rawValue, fallbackValue = []) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallbackValue;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function normalizeConversationRow(row) {
  if (!row) return row;

  return {
    ...row,
    tool_names:
      row.tool_names === null || row.tool_names === undefined
        ? null
        : parseJsonArray(row.tool_names, []),
  };
}

export function getConversations(uid) {
  return db
    .prepare(
      `
    SELECT id, title, system_prompt, created_at, updated_at
         , tool_names
    FROM conversations
    WHERE uid = ?
    ORDER BY updated_at DESC
  `
    )
    .all(uid)
    .map(normalizeConversationRow);
}

export function createConversation(uid, title = "新对话", toolNames = null) {
  const result = db
    .prepare(
      `
    INSERT INTO conversations (uid, title, tool_names) VALUES (?, ?, ?)
  `
    )
    .run(
      uid,
      title,
      Array.isArray(toolNames) ? JSON.stringify(toolNames) : null
    );
  return {
    id: result.lastInsertRowid,
    title,
    system_prompt: "",
    tool_names: Array.isArray(toolNames) ? toolNames : null,
  };
}

export function updateConversationTitle(id, uid, title) {
  db.prepare(
    `
    UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND uid = ?
  `
  ).run(title, id, uid);
}

export function updateConversationSystemPrompt(id, uid, systemPrompt) {
  db.prepare(
    `
    UPDATE conversations SET system_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND uid = ?
  `
  ).run(systemPrompt, id, uid);
}

export function updateConversationToolNames(id, uid, toolNames) {
  db.prepare(
    `
    UPDATE conversations SET tool_names = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND uid = ?
  `
  ).run(
    Array.isArray(toolNames) ? JSON.stringify(toolNames) : null,
    id,
    uid
  );
}

export function deleteConversation(id, uid) {
  db.prepare("DELETE FROM messages WHERE conversation_id = ? AND uid = ?").run(
    id,
    uid
  );
  db.prepare("DELETE FROM conversations WHERE id = ? AND uid = ?").run(id, uid);
}

export function clearAllHistory(uid) {
  const tx = db.transaction(() => {
    const deletedMessages = db
      .prepare("DELETE FROM messages WHERE uid = ?")
      .run(uid).changes;
    const deletedConversations = db
      .prepare("DELETE FROM conversations WHERE uid = ?")
      .run(uid).changes;
    const deletedUsageLogs = db
      .prepare("DELETE FROM usage_logs WHERE uid = ?")
      .run(uid).changes;
    return {
      deleted_messages: deletedMessages,
      deleted_conversations: deletedConversations,
      deleted_usage_logs: deletedUsageLogs,
    };
  });
  return tx();
}

export function getConversation(id, uid) {
  return normalizeConversationRow(
    db.prepare("SELECT * FROM conversations WHERE id = ? AND uid = ?").get(
      id,
      uid
    )
  );
}

// ============ 消息管理 ============

export function getMessages(conversationId, uid) {
  return db
    .prepare(
      `
    SELECT id, role, content, created_at
    FROM messages
    WHERE conversation_id = ? AND uid = ?
    ORDER BY id ASC
  `
    )
    .all(conversationId, uid);
}

export function addMessage(conversationId, uid, role, content) {
  const result = db
    .prepare(
      `
    INSERT INTO messages (conversation_id, uid, role, content) VALUES (?, ?, ?, ?)
  `
    )
    .run(conversationId, uid, role, content);

  db.prepare(
    `
    UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND uid = ?
  `
  ).run(conversationId, uid);

  return { id: result.lastInsertRowid };
}

export function updateMessage(id, uid, content) {
  db.prepare(
    `
    UPDATE messages SET content = ? WHERE id = ? AND uid = ?
  `
  ).run(content, id, uid);
}

export function deleteLastMessages(conversationId, uid, count = 1) {
  const rows = db
    .prepare(
      `
    SELECT id FROM messages
    WHERE conversation_id = ? AND uid = ?
    ORDER BY id DESC
    LIMIT ?
  `
    )
    .all(conversationId, uid, count);
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    db.prepare(
      `DELETE FROM messages WHERE id IN (${ids.map(() => "?").join(",")})`
    ).run(...ids);
  }
}

export function deleteLastAssistantMessage(conversationId, uid) {
  const row = db
    .prepare(
      `
    SELECT id FROM messages
    WHERE conversation_id = ? AND uid = ? AND role = 'assistant'
    ORDER BY id DESC
    LIMIT 1
  `
    )
    .get(conversationId, uid);
  if (!row) return false;

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM messages WHERE id = ?").run(row.id);
    db.prepare(
      `
    UPDATE conversations
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND uid = ?
  `
    ).run(conversationId, uid);
  });

  tx();
  return true;
}

// ============ Endpoint 组管理 ============

export function getEndpointGroups(uid) {
  return db
    .prepare(
      `
    SELECT id, name, provider, base_url, api_key, is_default, use_preset_models, created_at, updated_at
    FROM endpoint_groups
    WHERE uid = ?
    ORDER BY is_default DESC, created_at ASC
  `
    )
    .all(uid)
    .map((eg) => ({
      ...eg,
      provider: eg.provider || "openai_compatible",
      api_key: eg.api_key ? decrypt(eg.api_key) : "",
    }));
}

export function getDefaultEndpointGroup(uid) {
  const eg = db
    .prepare(
      `
    SELECT id, name, provider, base_url, api_key, is_default, use_preset_models
    FROM endpoint_groups
    WHERE uid = ? AND is_default = 1
  `
    )
    .get(uid);
  if (eg && eg.api_key) eg.api_key = decrypt(eg.api_key);
  if (eg) eg.provider = eg.provider || "openai_compatible";
  return eg;
}

export function getEndpointGroup(id, uid) {
  const eg = db
    .prepare(
      `
    SELECT id, name, provider, base_url, api_key, is_default, use_preset_models, created_at, updated_at
    FROM endpoint_groups
    WHERE id = ? AND uid = ?
  `
    )
    .get(id, uid);
  if (eg && eg.api_key) eg.api_key = decrypt(eg.api_key);
  if (eg) eg.provider = eg.provider || "openai_compatible";
  return eg;
}

export function createEndpointGroup(
  uid,
  name,
  provider,
  baseUrl,
  apiKey,
  isDefault = false,
  usePresetModels = true
) {
  if (isDefault) {
    db.prepare("UPDATE endpoint_groups SET is_default = 0 WHERE uid = ?").run(
      uid
    );
  }
  const encryptedKey = encrypt(apiKey);
  const result = db
    .prepare(
      `
    INSERT INTO endpoint_groups (uid, name, provider, base_url, api_key, is_default, use_preset_models) VALUES (?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      uid,
      name,
      provider,
      baseUrl,
      encryptedKey,
      isDefault ? 1 : 0,
      usePresetModels !== false ? 1 : 0
    );
  return {
    id: result.lastInsertRowid,
    name,
    provider,
    base_url: baseUrl,
    api_key: apiKey,
    is_default: isDefault ? 1 : 0,
    use_preset_models: usePresetModels !== false ? 1 : 0,
  };
}

export function updateEndpointGroup(
  id,
  uid,
  name,
  provider,
  baseUrl,
  apiKey,
  usePresetModels
) {
  const existing = db
    .prepare(
      `
    SELECT api_key, use_preset_models, provider FROM endpoint_groups WHERE id = ? AND uid = ?
  `
    )
    .get(id, uid);
  if (!existing) {
    throw new Error("Endpoint not found");
  }

  // 编辑时允许不传 apiKey，默认保留原值。
  const encryptedKey = apiKey ? encrypt(apiKey) : existing.api_key;
  const presetFlag =
    usePresetModels === undefined
      ? existing.use_preset_models
      : usePresetModels
      ? 1
      : 0;

  db.prepare(
    `
    UPDATE endpoint_groups SET name = ?, provider = ?, base_url = ?, api_key = ?, use_preset_models = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND uid = ?
  `
  ).run(
    name,
    provider || existing.provider || "openai_compatible",
    baseUrl,
    encryptedKey,
    presetFlag,
    id,
    uid
  );
}

export function setDefaultEndpointGroup(id, uid) {
  db.prepare("UPDATE endpoint_groups SET is_default = 0 WHERE uid = ?").run(
    uid
  );
  db.prepare(
    "UPDATE endpoint_groups SET is_default = 1 WHERE id = ? AND uid = ?"
  ).run(id, uid);
}

export function deleteEndpointGroup(id, uid) {
  db.prepare("DELETE FROM models WHERE endpoint_group_id = ? AND uid = ?").run(
    id,
    uid
  );
  db.prepare("DELETE FROM endpoint_groups WHERE id = ? AND uid = ?").run(
    id,
    uid
  );
}

// ============ 模型管理 ============

export function getModels(endpointGroupId, uid) {
  return db
    .prepare(
      `
    SELECT id, model_id, display_name, is_enabled
    FROM models
    WHERE endpoint_group_id = ? AND uid = ?
  `
    )
    .all(endpointGroupId, uid);
}

export function addModel(endpointGroupId, uid, modelId, displayName) {
  const result = db
    .prepare(
      `
    INSERT INTO models (endpoint_group_id, uid, model_id, display_name) VALUES (?, ?, ?, ?)
  `
    )
    .run(endpointGroupId, uid, modelId, displayName);
  return { id: result.lastInsertRowid };
}

export function replaceModels(endpointGroupId, uid, models) {
  const deleteStmt = db.prepare(
    "DELETE FROM models WHERE endpoint_group_id = ? AND uid = ?"
  );
  const insertStmt = db.prepare(
    `
    INSERT INTO models (endpoint_group_id, uid, model_id, display_name) VALUES (?, ?, ?, ?)
  `
  );

  const tx = db.transaction((items) => {
    deleteStmt.run(endpointGroupId, uid);
    for (const item of items) {
      insertStmt.run(
        endpointGroupId,
        uid,
        item.model_id,
        item.display_name || item.model_id
      );
    }
  });

  tx(models);
}

export function deleteModel(id, uid) {
  db.prepare("DELETE FROM models WHERE id = ? AND uid = ?").run(id, uid);
}

// ============ 用量统计 ============

export function logUsage({
  uid,
  conversationId,
  model,
  endpointName,
  promptTokens,
  completionTokens,
  source = "chat",
}) {
  db.prepare(
    `
    INSERT INTO usage_logs (uid, conversation_id, model, endpoint_name, prompt_tokens, completion_tokens, total_tokens, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    uid,
    conversationId ?? null,
    model,
    endpointName ?? "",
    promptTokens ?? 0,
    completionTokens ?? 0,
    (promptTokens ?? 0) + (completionTokens ?? 0),
    source
  );
}

export function getUsageSummary(uid, days = 30) {
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const rows = db
    .prepare(
      `
    SELECT
      DATE(created_at) AS date,
      model,
      endpoint_name,
      SUM(prompt_tokens) AS prompt_tokens,
      SUM(completion_tokens) AS completion_tokens,
      SUM(total_tokens) AS total_tokens,
      COUNT(*) AS requests
    FROM usage_logs
    WHERE uid = ? AND created_at >= ?
    GROUP BY DATE(created_at), model
    ORDER BY date DESC
  `
    )
    .all(uid, since);
  return rows;
}

export function getUsageTotals(uid, days = 30) {
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  return db
    .prepare(
      `
    SELECT
      SUM(total_tokens) AS total_tokens,
      SUM(prompt_tokens) AS prompt_tokens,
      SUM(completion_tokens) AS completion_tokens,
      COUNT(*) AS total_requests,
      COUNT(DISTINCT model) AS models_used,
      COUNT(DISTINCT DATE(created_at)) AS active_days
    FROM usage_logs
    WHERE uid = ? AND created_at >= ?
  `
    )
    .get(uid, since);
}

export function getUsageByModel(uid, days = 30) {
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
  return db
    .prepare(
      `
    SELECT model, SUM(total_tokens) AS total_tokens, COUNT(*) AS requests
    FROM usage_logs
    WHERE uid = ? AND created_at >= ?
    GROUP BY model
    ORDER BY total_tokens DESC
  `
    )
    .all(uid, since);
}

// ============ API Key 管理 ============

import { createHash, randomBytes } from "node:crypto";

function hashKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

export function createApiKey(uid, name) {
  const rawKey = "cw-" + randomBytes(24).toString("base64url");
  const prefix = rawKey.slice(0, 12);
  const hash = hashKey(rawKey);
  db.prepare(
    `
    INSERT INTO api_keys (uid, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)
  `
  ).run(uid, name, hash, prefix);
  return { key: rawKey, prefix, name };
}

export function listApiKeys(uid) {
  return db
    .prepare(
      `
    SELECT id, name, key_prefix, is_active, last_used_at, created_at
    FROM api_keys WHERE uid = ? ORDER BY created_at DESC
  `
    )
    .all(uid);
}

export function revokeApiKey(id, uid) {
  db.prepare("UPDATE api_keys SET is_active = 0 WHERE id = ? AND uid = ?").run(
    id,
    uid
  );
}

export function deleteApiKey(id, uid) {
  db.prepare("DELETE FROM api_keys WHERE id = ? AND uid = ?").run(id, uid);
}

export function verifyApiKey(rawKey) {
  const hash = hashKey(rawKey);
  const row = db
    .prepare(
      `
    SELECT uid FROM api_keys WHERE key_hash = ? AND is_active = 1
  `
    )
    .get(hash);
  if (row) {
    db.prepare(
      "UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE key_hash = ?"
    ).run(hash);
    return row.uid;
  }
  return null;
}

// ============ Webhooks ============

export function createWebhook(uid, name, url, events = []) {
  const result = db
    .prepare(
      `
    INSERT INTO webhooks (uid, name, url, events) VALUES (?, ?, ?, ?)
  `
    )
    .run(uid, name, url, JSON.stringify(events));
  return { id: result.lastInsertRowid, uid, name, url, events };
}

export function listWebhooks(uid) {
  return db
    .prepare("SELECT * FROM webhooks WHERE uid = ?")
    .all(uid)
    .map((w) => ({
      ...w,
      events: JSON.parse(w.events || "[]"),
    }));
}

export function deleteWebhook(id, uid) {
  db.prepare("DELETE FROM webhooks WHERE id = ? AND uid = ?").run(id, uid);
}

export function updateWebhookStatus(id, uid, isActive) {
  db.prepare("UPDATE webhooks SET is_active = ? WHERE id = ? AND uid = ?").run(
    isActive ? 1 : 0,
    id,
    uid
  );
}

export async function triggerWebhooks(event, payload) {
  const hooks = db
    .prepare("SELECT * FROM webhooks WHERE is_active = 1 AND events LIKE ?")
    .all(`%${event}%`)
    .map((w) => ({
      ...w,
      events: JSON.parse(w.events || "[]"),
    }))
    .filter((w) => w.events.includes(event));

  for (const hook of hooks) {
    try {
      await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(hook.secret && {
            "X-CW-Secret": hook.secret,
            "X-Timo-Secret": hook.secret,
          }),
        },
        body: JSON.stringify({
          event,
          timestamp: new Date().toISOString(),
          payload,
        }),
      });
    } catch (e) {
      console.error(`[Webhook] Failed to trigger ${hook.name}: ${e.message}`);
    }
  }
}

// ============ MCP 管理 ============

export function listMcpServers(uid) {
  return db
    .prepare("SELECT * FROM mcp_servers WHERE uid = ? ORDER BY created_at DESC")
    .all(uid)
    .map((s) => ({
      ...s,
      args: s.args ? JSON.parse(s.args) : [],
      env: s.env ? JSON.parse(s.env) : {},
      headers: s.headers ? JSON.parse(s.headers) : {},
      auth: s.auth ? JSON.parse(decrypt(s.auth)) : null,
    }));
}

export function getMcpServer(id, uid) {
  const s = db
    .prepare("SELECT * FROM mcp_servers WHERE id = ? AND uid = ?")
    .get(id, uid);
  if (s) {
    s.args = s.args ? JSON.parse(s.args) : [];
    s.env = s.env ? JSON.parse(s.env) : {};
    s.headers = s.headers ? JSON.parse(s.headers) : {};
    s.auth = s.auth ? JSON.parse(decrypt(s.auth)) : null;
  }
  return s;
}

export function createMcpServer(
  uid,
  name,
  type,
  command,
  args,
  url,
  isEnabled = 1,
  env = {},
  headers = {},
  auth = null
) {
  const encryptedAuth = auth ? encrypt(JSON.stringify(auth)) : null;
  const result = db
    .prepare(
      `
    INSERT INTO mcp_servers (uid, name, type, command, args, url, is_enabled, env, headers, auth)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      uid,
      name,
      type,
      command || null,
      args ? JSON.stringify(args) : "[]",
      url || null,
      isEnabled,
      JSON.stringify(env || {}),
      JSON.stringify(headers || {}),
      encryptedAuth
    );

  return {
    id: result.lastInsertRowid,
    uid,
    name,
    type,
    command,
    args: args || [],
    url,
    is_enabled: isEnabled,
    env,
    headers,
    auth,
  };
}

export function updateMcpServer(id, uid, updates) {
  const current = getMcpServer(id, uid);
  if (!current) throw new Error("MCP Server not found");

  const name = updates.name !== undefined ? updates.name : current.name;
  const type = updates.type !== undefined ? updates.type : current.type;
  const command =
    updates.command !== undefined ? updates.command : current.command;
  const args = updates.args !== undefined ? updates.args : current.args;
  const url = updates.url !== undefined ? updates.url : current.url;
  const isEnabled =
    updates.is_enabled !== undefined ? updates.is_enabled : current.is_enabled;
  const env = updates.env !== undefined ? updates.env : current.env;
  const headers =
    updates.headers !== undefined ? updates.headers : current.headers;
  const auth = updates.auth !== undefined ? updates.auth : current.auth;

  const encryptedAuth = auth
    ? encrypt(JSON.stringify(auth))
    : current.auth
    ? encrypt(JSON.stringify(current.auth))
    : null;

  db.prepare(
    `
    UPDATE mcp_servers 
    SET name = ?, type = ?, command = ?, args = ?, url = ?, is_enabled = ?, env = ?, headers = ?, auth = ?
    WHERE id = ? AND uid = ?
  `
  ).run(
    name,
    type,
    command || null,
    JSON.stringify(args || []),
    url || null,
    isEnabled ? 1 : 0,
    JSON.stringify(env || {}),
    JSON.stringify(headers || {}),
    encryptedAuth,
    id,
    uid
  );
}

export function deleteMcpServer(id, uid) {
  db.prepare("DELETE FROM mcp_servers WHERE id = ? AND uid = ?").run(id, uid);
}

// ============ Skills 管理 ============

export function listSkills(uid) {
  return db
    .prepare("SELECT * FROM skills WHERE uid = ? ORDER BY created_at DESC")
    .all(uid)
    .map((s) => ({
      ...s,
      examples: s.examples ? JSON.parse(s.examples) : [],
      tools: s.tools ? JSON.parse(s.tools) : [],
    }));
}

export function createSkill(
  uid,
  name,
  description,
  prompt,
  examples = [],
  tools = []
) {
  const result = db
    .prepare(
      `
    INSERT INTO skills (uid, name, description, prompt, examples, tools)
    VALUES (?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      uid,
      name,
      description,
      prompt,
      JSON.stringify(examples),
      JSON.stringify(tools)
    );

  return {
    id: result.lastInsertRowid,
    uid,
    name,
    description,
    prompt,
    examples,
    tools,
  };
}

export function updateSkill(id, uid, updates) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(updates)) {
    if (["name", "description", "prompt", "examples", "tools"].includes(key)) {
      fields.push(`${key} = ?`);
      values.push(typeof value === "object" ? JSON.stringify(value) : value);
    }
  }
  if (fields.length === 0) return;
  fields.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id, uid);

  db.prepare(
    `UPDATE skills SET ${fields.join(", ")} WHERE id = ? AND uid = ?`
  ).run(...values);
}

export function deleteSkill(id, uid) {
  db.prepare("DELETE FROM skills WHERE id = ? AND uid = ?").run(id, uid);
}

// ============ Agent Tasks 管理 ============

export function listAgentTasks(uid) {
  return db
    .prepare("SELECT * FROM agent_tasks WHERE uid = ? ORDER BY created_at DESC")
    .all(uid)
    .map((t) => ({
      ...t,
      skill_ids: t.skill_ids ? JSON.parse(t.skill_ids) : [],
      tool_names: t.tool_names ? JSON.parse(t.tool_names) : [],
      model_id: t.model_id || "",
    }));
}

export function getAgentTask(id, uid) {
  const t = db
    .prepare("SELECT * FROM agent_tasks WHERE id = ? AND uid = ?")
    .get(id, uid);
  if (t) {
    t.skill_ids = t.skill_ids ? JSON.parse(t.skill_ids) : [];
    t.tool_names = t.tool_names ? JSON.parse(t.tool_names) : [];
    t.model_id = t.model_id || "";
  }
  return t;
}

export function createAgentTask(
  uid,
  name,
  description,
  systemPrompt,
  skillIds = [],
  toolNames = [],
  modelId = ""
) {
  const result = db
    .prepare(
      `
    INSERT INTO agent_tasks (uid, name, description, system_prompt, skill_ids, tool_names, model_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      uid,
      name,
      description,
      systemPrompt,
      JSON.stringify(skillIds),
      JSON.stringify(toolNames),
      modelId
    );

  return {
    id: result.lastInsertRowid,
    uid,
    name,
    description,
    system_prompt: systemPrompt,
    skill_ids: skillIds,
    tool_names: toolNames,
    model_id: modelId,
  };
}

export function updateAgentTask(id, uid, updates) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(updates)) {
    if (
      [
        "name",
        "description",
        "system_prompt",
        "skill_ids",
        "tool_names",
        "is_active",
        "model_id",
      ].includes(key)
    ) {
      fields.push(`${key} = ?`);
      values.push(typeof value === "object" ? JSON.stringify(value) : value);
    }
  }
  if (fields.length === 0) return;
  fields.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id, uid);

  db.prepare(
    `UPDATE agent_tasks SET ${fields.join(", ")} WHERE id = ? AND uid = ?`
  ).run(...values);
}

export function deleteAgentTask(id, uid) {
  db.prepare("DELETE FROM agent_tasks WHERE id = ? AND uid = ?").run(id, uid);
}

// ============ Task Runs / Timeline ============

export function createTaskRun({
  uid,
  taskId,
  cronJobId = null,
  conversationId = null,
  triggerSource = "manual",
  status = "running",
  initialMessage = "",
}) {
  const startedAt = new Date().toISOString();
  const result = db
    .prepare(
      `
    INSERT INTO task_runs (
      uid, task_id, cron_job_id, conversation_id, trigger_source, status, initial_message, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      uid,
      taskId,
      cronJobId,
      conversationId,
      triggerSource,
      status,
      initialMessage,
      startedAt
    );

  return getTaskRun(result.lastInsertRowid, uid);
}

export function getTaskRun(id, uid) {
  return db
    .prepare(
      `
    SELECT
      tr.*,
      at.name AS task_name,
      cj.name AS cron_job_name,
      c.title AS conversation_title
    FROM task_runs tr
    JOIN agent_tasks at ON at.id = tr.task_id
    LEFT JOIN cron_jobs cj ON cj.id = tr.cron_job_id
    LEFT JOIN conversations c ON c.id = tr.conversation_id
    WHERE tr.id = ? AND tr.uid = ?
  `
    )
    .get(id, uid);
}

export function listTaskRuns(
  uid,
  { taskId, cronJobId, triggerSource, limit = 20 } = {}
) {
  const filters = ["tr.uid = ?"];
  const values = [uid];

  if (taskId) {
    filters.push("tr.task_id = ?");
    values.push(taskId);
  }
  if (cronJobId) {
    filters.push("tr.cron_job_id = ?");
    values.push(cronJobId);
  }
  if (triggerSource) {
    filters.push("tr.trigger_source = ?");
    values.push(triggerSource);
  }

  let sql = `
    SELECT
      tr.*,
      at.name AS task_name,
      cj.name AS cron_job_name,
      c.title AS conversation_title
    FROM task_runs tr
    JOIN agent_tasks at ON at.id = tr.task_id
    LEFT JOIN cron_jobs cj ON cj.id = tr.cron_job_id
    LEFT JOIN conversations c ON c.id = tr.conversation_id
    WHERE ${filters.join(" AND ")}
    ORDER BY COALESCE(tr.started_at, tr.created_at) DESC, tr.id DESC
  `;

  if (limit && Number(limit) > 0) {
    sql += " LIMIT ?";
    values.push(Number(limit));
  }

  return db.prepare(sql).all(...values);
}

export function updateTaskRun(id, uid, updates) {
  if (!id) return;

  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(updates)) {
    if (
      [
        "cron_job_id",
        "conversation_id",
        "status",
        "initial_message",
        "final_response",
        "error_message",
        "started_at",
        "finished_at",
      ].includes(key)
    ) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return;
  values.push(id, uid);

  db.prepare(`UPDATE task_runs SET ${fields.join(", ")} WHERE id = ? AND uid = ?`).run(
    ...values
  );
}

export function addTaskRunEvent(
  runId,
  uid,
  eventType,
  title,
  content = "",
  metadata = null
) {
  const result = db
    .prepare(
      `
    INSERT INTO task_run_events (run_id, uid, event_type, title, content, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      runId,
      uid,
      eventType,
      title,
      content,
      metadata ? JSON.stringify(metadata) : null
    );

  return result.lastInsertRowid;
}

export function listTaskRunEvents(runId, uid) {
  return db
    .prepare(
      `
    SELECT *
    FROM task_run_events
    WHERE run_id = ? AND uid = ?
    ORDER BY created_at ASC, id ASC
  `
    )
    .all(runId, uid)
    .map((event) => ({
      ...event,
      metadata: event.metadata ? JSON.parse(event.metadata) : null,
    }));
}

// ============ Cron Jobs 管理 ============

export function listCronJobs(uid) {
  return db
    .prepare("SELECT * FROM cron_jobs WHERE uid = ? ORDER BY created_at DESC")
    .all(uid);
}

export function createCronJob(uid, taskId, name, cronExpression) {
  const result = db
    .prepare(
      `
    INSERT INTO cron_jobs (uid, task_id, name, cron_expression)
    VALUES (?, ?, ?, ?)
  `
    )
    .run(uid, taskId, name, cronExpression);

  return {
    id: result.lastInsertRowid,
    uid,
    task_id: taskId,
    name,
    cron_expression: cronExpression,
  };
}

export function updateCronJob(id, uid, updates) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(updates)) {
    if (
      [
        "name",
        "cron_expression",
        "next_run",
        "last_run",
        "last_status",
        "is_enabled",
        "task_id",
      ].includes(key)
    ) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return;
  fields.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id, uid);

  db.prepare(
    `UPDATE cron_jobs SET ${fields.join(", ")} WHERE id = ? AND uid = ?`
  ).run(...values);
}

export function listAllCronJobs() {
  return db.prepare("SELECT * FROM cron_jobs").all();
}

export function deleteCronJob(id, uid) {
  db.prepare("DELETE FROM cron_jobs WHERE id = ? AND uid = ?").run(id, uid);
}

export default db;
