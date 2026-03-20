import crypto from "crypto";
import fs from "fs";
import os from "os";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { decrypt, encrypt } from "../utils/crypto.js";
import { createDatabaseClient } from "./dbClient.js";

const dataDir = process.env.WORKHORSE_DATA_DIR || join(os.homedir(), ".workhorse");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const modelsDir = join(dataDir, "models");
if (!fs.existsSync(modelsDir)) {
  fs.mkdirSync(modelsDir, { recursive: true });
}
const tmpDir = join(dataDir, "tmp");
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || join(dataDir, "chat.db");
const db = createDatabaseClient({ dbPath });

// 性能优化配置：开启 WAL 模式和 Normal 同步
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");

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
    channel_id INTEGER,
    acp_agent_id INTEGER,
    acp_session_id TEXT,
    acp_model_id TEXT,
    context_window INTEGER,
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
    is_hidden INTEGER DEFAULT 0,
    is_archived INTEGER DEFAULT 0,
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
    source TEXT DEFAULT 'remote',
    generation_config TEXT DEFAULT '{}',
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

  CREATE INDEX IF NOT EXISTS idx_conversations_uid ON conversations(uid);
  CREATE INDEX IF NOT EXISTS idx_messages_uid ON messages(uid);
  CREATE INDEX IF NOT EXISTS idx_endpoint_groups_uid ON endpoint_groups(uid);
  CREATE INDEX IF NOT EXISTS idx_models_uid ON models(uid);
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_uid ON usage_logs(uid);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_composite_stats ON usage_logs(uid, created_at, model);

  -- 核心外键与查询优化索引
  CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_list_v2 ON conversations(uid, updated_at DESC);

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
    is_enabled INTEGER DEFAULT 1,
    source_type TEXT,
    source_location TEXT,
    source_item_path TEXT,
    source_refreshed_at DATETIME,
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
    acp_agent_id INTEGER,
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


  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    setting_value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(uid, setting_key),
    FOREIGN KEY(uid) REFERENCES users(uid) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    agent_prompt TEXT DEFAULT '',
    webhook_url TEXT,
    bot_token TEXT,
    metadata TEXT,
    is_enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(uid) REFERENCES users(uid) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS acp_agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    name TEXT NOT NULL,
    preset TEXT NOT NULL,
    command TEXT NOT NULL,
    args TEXT DEFAULT '[]',
    env TEXT,
    agent_prompt TEXT DEFAULT '',
    default_model_id TEXT,
    last_used_model_id TEXT,
    is_enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(uid) REFERENCES users(uid) ON DELETE CASCADE
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
  CREATE INDEX IF NOT EXISTS idx_task_run_events_timeline ON task_run_events(run_id, created_at, id);
  CREATE INDEX IF NOT EXISTS idx_task_runs_conversation_id ON task_runs(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_channels_uid ON channels(uid);
  CREATE INDEX IF NOT EXISTS idx_acp_agents_uid ON acp_agents(uid);
  CREATE INDEX IF NOT EXISTS idx_app_settings_uid_key ON app_settings(uid, setting_key);
`);

try {
  db.prepare(
    "ALTER TABLE conversations ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL"
  ).run();
} catch (e) {
  /* column already exists */
}

try {
  db.prepare("ALTER TABLE conversations ADD COLUMN channel_id INTEGER").run();
} catch (e) {
  /* column already exists */
}

try {
  db.prepare("ALTER TABLE conversations ADD COLUMN acp_agent_id INTEGER").run();
} catch (e) {
  /* column already exists */
}

try {
  db.prepare("ALTER TABLE conversations ADD COLUMN acp_session_id TEXT").run();
} catch (e) {
  /* column already exists */
}

try {
  db.prepare("ALTER TABLE conversations ADD COLUMN acp_model_id TEXT").run();
} catch (e) {
  /* column already exists */
}

try {
  db.prepare("ALTER TABLE acp_agents ADD COLUMN default_model_id TEXT").run();
} catch (e) {
  /* column already exists */
}

for (const statement of [
  "ALTER TABLE channels ADD COLUMN agent_prompt TEXT DEFAULT ''",
  "ALTER TABLE acp_agents ADD COLUMN agent_prompt TEXT DEFAULT ''",
  "ALTER TABLE acp_agents ADD COLUMN last_used_model_id TEXT",
]) {
  try {
    db.prepare(statement).run();
  } catch (e) {
    /* column already exists */
  }
}

// 运行时迁移：添加 provider 列（已存在时忽略）
try {
  db.prepare(
    "ALTER TABLE endpoint_groups ADD COLUMN provider TEXT DEFAULT 'openai_compatible'"
  ).run();
} catch (e) {
  /* column already exists */
}

for (const statement of [
  "ALTER TABLE skills ADD COLUMN source_type TEXT",
  "ALTER TABLE skills ADD COLUMN source_location TEXT",
  "ALTER TABLE skills ADD COLUMN source_item_path TEXT",
  "ALTER TABLE skills ADD COLUMN source_refreshed_at DATETIME",
  "ALTER TABLE skills ADD COLUMN is_enabled INTEGER DEFAULT 1",
  "ALTER TABLE models ADD COLUMN source TEXT DEFAULT 'remote'",
  "ALTER TABLE models ADD COLUMN generation_config TEXT DEFAULT '{}'",
]) {
  try {
    db.prepare(statement).run();
  } catch (e) {
    /* column already exists */
  }
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_skills_source_lookup
    ON skills(uid, source_type, source_location)
  `);
} catch (e) {
  console.error(
    "[DB Migration] Failed to create idx_skills_source_lookup:",
    e.message
  );
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

try {
  db.prepare("ALTER TABLE agent_tasks ADD COLUMN acp_agent_id INTEGER").run();
} catch (e) {
  /* column already exists */
}

try {
  db.prepare("ALTER TABLE channels ADD COLUMN metadata TEXT").run();
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

export function getAppSetting(uid, key, fallbackValue = "") {
  const row = db
    .prepare(
      "SELECT setting_value FROM app_settings WHERE uid = ? AND setting_key = ?"
    )
    .get(uid, key);

  return row?.setting_value ?? fallbackValue;
}

export function setAppSetting(uid, key, value) {
  db.prepare(
    `
    INSERT INTO app_settings (uid, setting_key, setting_value)
    VALUES (?, ?, ?)
    ON CONFLICT(uid, setting_key)
    DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
  `
  ).run(uid, key, value);

  return {
    uid,
    key,
    value,
  };
}

export function getOrCreateLocalUser() {
  const existing = getUserByUsername("local");
  if (existing) {
    return {
      uid: existing.uid,
      username: existing.username,
      role: existing.role,
    };
  }

  const created = createUser("local", crypto.randomBytes(24).toString("hex"));
  updateUserRole(created.uid, "admin");

  // 初始化默认接入点
  const endpointCount = db
    .prepare("SELECT COUNT(*) as count FROM endpoint_groups WHERE uid = ?")
    .get(created.uid).count;
  if (endpointCount === 0) {
    createEndpointGroup(
      created.uid,
      "OpenAI Compatible",
      "openai_compatible",
      "https://api.openai.com/v1",
      "",
      true,
      true
    );
  }

  return { ...created, role: "admin" };
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

try {
  db.prepare("ALTER TABLE messages ADD COLUMN is_hidden INTEGER DEFAULT 0").run();
} catch (e) {}

try {
  db.prepare("ALTER TABLE messages ADD COLUMN is_archived INTEGER DEFAULT 0").run();
} catch (e) {}

try {
  db.prepare("ALTER TABLE conversations ADD COLUMN context_window INTEGER").run();
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

function parseJsonObject(rawValue, fallbackValue = {}) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallbackValue;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function normalizeConversationRow(row) {
  if (!row) return row;

  const parsedContextWindow = Number(row.context_window);
  const parsedAcpAgentId = Number(row.acp_agent_id);

  return {
    ...row,
    channel_id:
      row.channel_id === null || row.channel_id === undefined
        ? null
        : Number(row.channel_id),
    acp_agent_id:
      Number.isFinite(parsedAcpAgentId) && parsedAcpAgentId > 0
        ? Math.round(parsedAcpAgentId)
        : null,
    acp_session_id: row.acp_session_id || null,
    acp_model_id: row.acp_model_id || null,
    context_window:
      Number.isFinite(parsedContextWindow) && parsedContextWindow > 0
        ? Math.round(parsedContextWindow)
        : null,
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
         , channel_id
         , acp_agent_id
         , acp_session_id
         , acp_model_id
         , context_window
         , tool_names
    FROM conversations
    WHERE uid = ?
    ORDER BY updated_at DESC
  `
    )
    .all(uid)
    .map(normalizeConversationRow);
}

export function createConversation(uid, title = "新对话", toolNames = null, options = {}) {
  const parsedContextWindow = Number(options?.contextWindow);
  const contextWindow =
    Number.isFinite(parsedContextWindow) && parsedContextWindow > 0
      ? Math.round(parsedContextWindow)
      : null;
  const parsedChannelId = Number(options?.channelId);
  const channelId =
    Number.isFinite(parsedChannelId) && parsedChannelId > 0
      ? Math.round(parsedChannelId)
      : null;
  const parsedAcpAgentId = Number(options?.acpAgentId);
  const acpAgentId =
    Number.isFinite(parsedAcpAgentId) && parsedAcpAgentId > 0
      ? Math.round(parsedAcpAgentId)
      : null;
  const acpAgent = acpAgentId ? getAcpAgent(acpAgentId, uid) : null;
  const acpModelId =
    String(
      options?.acpModelId ||
        acpAgent?.last_used_model_id ||
        acpAgent?.default_model_id ||
        ""
    ).trim() || null;
  const systemPrompt = String(options?.systemPrompt || "").trim();
  const result = db
    .prepare(
      `
    INSERT INTO conversations (uid, title, system_prompt, tool_names, context_window, channel_id, acp_agent_id, acp_session_id, acp_model_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      uid,
      title,
      systemPrompt,
      Array.isArray(toolNames) ? JSON.stringify(toolNames) : null,
      contextWindow,
      channelId,
      acpAgentId,
      null,
      acpModelId
    );
  return {
    id: result.lastInsertRowid,
    title,
    system_prompt: systemPrompt,
    channel_id: channelId,
    acp_agent_id: acpAgentId,
    acp_session_id: null,
    acp_model_id: acpModelId,
    context_window: contextWindow,
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
  ).run(Array.isArray(toolNames) ? JSON.stringify(toolNames) : null, id, uid);
}

export function updateConversationContextWindow(id, uid, contextWindow) {
  const parsedContextWindow = Number(contextWindow);
  const normalizedValue =
    Number.isFinite(parsedContextWindow) && parsedContextWindow > 0
      ? Math.round(parsedContextWindow)
      : null;

  db.prepare(
    `
    UPDATE conversations SET context_window = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND uid = ?
  `
  ).run(normalizedValue, id, uid);
}

export function updateConversationAcpSession(id, uid, sessionId) {
  db.prepare(
    `
    UPDATE conversations SET acp_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND uid = ?
  `
  ).run(sessionId || null, id, uid);
}

export function updateConversationAcpModel(id, uid, modelId) {
  db.prepare(
    `
    UPDATE conversations SET acp_model_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND uid = ?
  `
  ).run(String(modelId || "").trim() || null, id, uid);
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
    db
      .prepare("SELECT * FROM conversations WHERE id = ? AND uid = ?")
      .get(id, uid)
  );
}

// ============ 消息管理 ============

export function getMessages(conversationId, uid) {
  return db
    .prepare(
      `
    SELECT id, role, content, is_hidden, is_archived, created_at
    FROM messages
    WHERE conversation_id = ? AND uid = ?
    ORDER BY id ASC
  `
    )
    .all(conversationId, uid);
}

export function addMessage(conversationId, uid, role, content, options = {}) {
  const { is_hidden = 0, is_archived = 0 } = options;
  const result = db
    .prepare(
      `
    INSERT INTO messages (conversation_id, uid, role, content, is_hidden, is_archived) VALUES (?, ?, ?, ?, ?, ?)
  `
    )
    .run(conversationId, uid, role, content, is_hidden ? 1 : 0, is_archived ? 1 : 0);

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
    ORDER BY created_at ASC, id ASC
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
  try {
    const filePath = getModelConfigFilePath(id);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  } catch {
    // ignore model file cleanup failure
  }
}

// ============ 模型管理 ============

function getModelConfigFilePath(endpointGroupId) {
  return join(modelsDir, `endpoint-${Number(endpointGroupId)}.json`);
}

function normalizeStoredModel(rawModel = {}, fallbackId = 0) {
  const parsedId = Number(rawModel?.id);
  const id = Number.isInteger(parsedId) && parsedId > 0 ? parsedId : fallbackId;

  return {
    id,
    model_id: String(rawModel?.model_id || "").trim(),
    display_name: String(
      rawModel?.display_name || rawModel?.model_id || `Model ${id}`
    ).trim(),
    is_enabled: Number(rawModel?.is_enabled) === 1 ? 1 : 0,
    source: String(rawModel?.source || "manual").trim() || "manual",
    generation_config:
      rawModel?.generation_config &&
      typeof rawModel.generation_config === "object" &&
      !Array.isArray(rawModel.generation_config)
        ? rawModel.generation_config
        : {},
  };
}

function readModelConfigFile(endpointGroupId) {
  const filePath = getModelConfigFilePath(endpointGroupId);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const models = Array.isArray(payload?.models) ? payload.models : [];
    return {
      ...payload,
      models: models
        .map((item, index) => normalizeStoredModel(item, index + 1))
        .filter((item) => item.model_id),
    };
  } catch {
    return null;
  }
}

function writeModelConfigFile(endpointGroupId, uid, models = []) {
  const filePath = getModelConfigFilePath(endpointGroupId);
  const normalizedModels = models
    .map((item, index) => normalizeStoredModel(item, index + 1))
    .filter((item) => item.model_id);
  const payload = {
    version: 1,
    uid: String(uid || "").trim(),
    endpoint_group_id: Number(endpointGroupId),
    updated_at: new Date().toISOString(),
    models: normalizedModels,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return normalizedModels;
}

function loadModelsFromDatabaseLegacy(endpointGroupId, uid) {
  return db
    .prepare(
      `
    SELECT id, model_id, display_name, is_enabled, source, generation_config
    FROM models
    WHERE endpoint_group_id = ? AND uid = ?
  `
    )
    .all(endpointGroupId, uid)
    .map((model) =>
      normalizeStoredModel(
        {
          ...model,
          source: model.source || "remote",
          generation_config: parseJsonObject(model.generation_config, {}),
        },
        Number(model.id)
      )
    )
    .filter((item) => item.model_id);
}

function loadModelsFromStore(endpointGroupId, uid) {
  const fromFile = readModelConfigFile(endpointGroupId);
  if (fromFile && String(fromFile.uid || "") === String(uid || "")) {
    return fromFile.models;
  }

  const legacyModels = loadModelsFromDatabaseLegacy(endpointGroupId, uid);
  if (legacyModels.length > 0) {
    return writeModelConfigFile(endpointGroupId, uid, legacyModels);
  }

  return [];
}

function findModelRecordById(uid, id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return null;
  }

  const files = fs
    .readdirSync(modelsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(modelsDir, entry.name));

  for (const filePath of files) {
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (String(payload?.uid || "") !== String(uid || "")) {
        continue;
      }
      const endpointGroupId =
        Number(payload?.endpoint_group_id) ||
        Number(
          String(basename(filePath)).replace(/^endpoint-/, "").replace(/\.json$/, "")
        );
      const models = Array.isArray(payload?.models) ? payload.models : [];
      const index = models.findIndex((item) => Number(item?.id) === numericId);
      if (index >= 0) {
        return {
          endpointGroupId,
          models: models.map((item, idx) => normalizeStoredModel(item, idx + 1)),
          index,
        };
      }
    } catch {
      // ignore malformed model files
    }
  }

  return null;
}

function getAllModelFiles() {
  return fs
    .readdirSync(modelsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(modelsDir, entry.name));
}

function allocateNextModelId(uid) {
  let maxId = 0;
  for (const filePath of getAllModelFiles()) {
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (String(payload?.uid || "") !== String(uid || "")) {
        continue;
      }
      const models = Array.isArray(payload?.models) ? payload.models : [];
      for (const model of models) {
        const currentId = Number(model?.id);
        if (Number.isInteger(currentId) && currentId > maxId) {
          maxId = currentId;
        }
      }
    } catch {
      // ignore malformed model files
    }
  }
  return maxId + 1;
}

export function getModels(endpointGroupId, uid) {
  return loadModelsFromStore(endpointGroupId, uid);
}

export function addModel(
  endpointGroupId,
  uid,
  modelId,
  displayName,
  options = {}
) {
  const {
    is_enabled = 1,
    source = "manual",
    generation_config = {},
  } = options || {};
  const existing = loadModelsFromStore(endpointGroupId, uid);
  const nextId = allocateNextModelId(uid);
  const nextModel = normalizeStoredModel(
    {
      id: nextId,
      model_id: modelId,
      display_name: displayName,
      is_enabled: is_enabled ? 1 : 0,
      source: source || "manual",
      generation_config: generation_config || {},
    },
    nextId
  );
  const nextModels = [...existing, nextModel];
  writeModelConfigFile(endpointGroupId, uid, nextModels);

  return {
    ...nextModel,
  };
}

export function replaceModels(endpointGroupId, uid, models) {
  const existing = loadModelsFromStore(endpointGroupId, uid);
  const existingManualModels = existing.filter(
    (item) => String(item.source || "manual") !== "remote"
  );
  const existingRemoteByModelId = new Map(
    existing
      .filter((item) => String(item.source || "manual") === "remote")
      .map((item) => [String(item.model_id), item])
  );
  let nextId = allocateNextModelId(uid);
  const incoming = Array.isArray(models) ? models : [];
  const nextRemoteModels = incoming
    .map((item) => {
      const normalizedModelId = String(item?.model_id || "").trim();
      const existingRemote = existingRemoteByModelId.get(normalizedModelId);

      // 如果模型已存在，保留其原有的启用状态、显示名称和配置，避免同步时被覆盖
      const mergedData = existingRemote
        ? {
            ...item,
            is_enabled: existingRemote.is_enabled,
            display_name: existingRemote.display_name,
            generation_config: existingRemote.generation_config,
          }
        : item;

      const normalized = normalizeStoredModel(
        {
          ...mergedData,
          id: Number(existingRemote?.id) > 0 ? Number(existingRemote.id) : nextId++,
          source: item?.source || "remote",
        },
        nextId
      );
      return normalized;
    })
    .filter((item) => item.model_id);

  writeModelConfigFile(endpointGroupId, uid, [
    ...existingManualModels,
    ...nextRemoteModels,
  ]);
}

export function updateModel(id, uid, updates = {}) {
  const record = findModelRecordById(uid, id);
  if (!record) {
    throw new Error("Model not found");
  }
  const current = record.models[record.index];

  const nextModelId =
    updates.model_id !== undefined ? updates.model_id : current.model_id;
  const nextDisplayName =
    updates.display_name !== undefined
      ? updates.display_name
      : current.display_name;
  const nextIsEnabled =
    updates.is_enabled !== undefined ? updates.is_enabled : current.is_enabled;
  const nextSource =
    updates.source !== undefined ? updates.source : current.source || "manual";
  const nextGenerationConfig =
    updates.generation_config !== undefined
      ? updates.generation_config
      : current.generation_config || {};

  record.models[record.index] = normalizeStoredModel(
    {
      id: current.id,
      model_id: nextModelId,
      display_name: nextDisplayName,
      is_enabled: nextIsEnabled ? 1 : 0,
      source: nextSource || "manual",
      generation_config: nextGenerationConfig || {},
    },
    current.id
  );

  writeModelConfigFile(record.endpointGroupId, uid, record.models);
}

export function updateModelsEnabled(endpointGroupId, uid, modelIds = [], isEnabled = 0) {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(modelIds) ? modelIds : [])
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  );

  if (!normalizedIds.length) {
    return { updated: 0 };
  }

  const existing = loadModelsFromStore(endpointGroupId, uid);
  let updated = 0;
  const nextModels = existing.map((item) => {
    if (!normalizedIds.includes(Number(item.id))) {
      return item;
    }
    if (Number(item.is_enabled) === (isEnabled ? 1 : 0)) {
      return item;
    }
    updated += 1;
    return {
      ...item,
      is_enabled: isEnabled ? 1 : 0,
    };
  });

  writeModelConfigFile(endpointGroupId, uid, nextModels);
  return { updated };
}

export function deleteModel(id, uid) {
  const record = findModelRecordById(uid, id);
  if (!record) return;
  const nextModels = record.models.filter((item) => Number(item.id) !== Number(id));
  writeModelConfigFile(record.endpointGroupId, uid, nextModels);
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
      args ? (typeof args === "string" ? args : JSON.stringify(args)) : "[]",
      url || null,
      isEnabled ? 1 : 0,
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

export function updateMcpServersEnabled(uid, serverIds = [], isEnabled = 0) {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(serverIds) ? serverIds : [])
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  );

  if (!normalizedIds.length) {
    return { updated: 0 };
  }

  const placeholders = normalizedIds.map(() => "?").join(",");
  const result = db
    .prepare(
      `UPDATE mcp_servers SET is_enabled = ? WHERE uid = ? AND id IN (${placeholders})`
    )
    .run(isEnabled ? 1 : 0, uid, ...normalizedIds);

  return { updated: result.changes };
}

export function deleteMcpServers(uid, serverIds = []) {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(serverIds) ? serverIds : [])
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  );

  if (!normalizedIds.length) {
    return { deleted: 0 };
  }

  const placeholders = normalizedIds.map(() => "?").join(",");
  const result = db
    .prepare(`DELETE FROM mcp_servers WHERE uid = ? AND id IN (${placeholders})`)
    .run(uid, ...normalizedIds);

  return { deleted: result.changes };
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
      is_enabled: Number(s.is_enabled) === 0 ? 0 : 1,
    }));
}

export function getSkill(id, uid) {
  const skill = db
    .prepare("SELECT * FROM skills WHERE id = ? AND uid = ?")
    .get(id, uid);

  if (!skill) {
    return null;
  }

  return {
    ...skill,
    examples: skill.examples ? JSON.parse(skill.examples) : [],
    tools: skill.tools ? JSON.parse(skill.tools) : [],
    is_enabled: Number(skill.is_enabled) === 0 ? 0 : 1,
  };
}

export function createSkill(
  uid,
  name,
  description,
  prompt,
  examples = [],
  tools = [],
  source = {}
) {
  const {
    is_enabled = 1,
    source_type = null,
    source_location = null,
    source_item_path = null,
    source_refreshed_at = null,
  } = source || {};
  const result = db
    .prepare(
      `
    INSERT INTO skills (
      uid,
      name,
      description,
      prompt,
      examples,
      tools,
      is_enabled,
      source_type,
      source_location,
      source_item_path,
      source_refreshed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      uid,
      name,
      description,
      prompt,
      JSON.stringify(examples),
      JSON.stringify(tools),
      is_enabled ? 1 : 0,
      source_type,
      source_location,
      source_item_path,
      source_refreshed_at
    );

  return {
    id: result.lastInsertRowid,
    uid,
    name,
    description,
    prompt,
    examples,
    tools,
    is_enabled: is_enabled ? 1 : 0,
    source_type,
    source_location,
    source_item_path,
    source_refreshed_at,
  };
}

export function updateSkill(id, uid, updates) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(updates)) {
    if (
      ["name", "description", "prompt", "examples", "tools", "is_enabled"].includes(
        key
      )
    ) {
      fields.push(`${key} = ?`);
      let val = typeof value === "object" ? JSON.stringify(value) : value;
      if (key === "is_enabled") {
        val = value ? 1 : 0;
      }
      values.push(val);
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

export function updateSkillsEnabled(uid, skillIds = [], isEnabled = 0) {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(skillIds) ? skillIds : [])
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  );

  if (!normalizedIds.length) {
    return { updated: 0 };
  }

  const placeholders = normalizedIds.map(() => "?").join(",");
  const result = db
    .prepare(
      `UPDATE skills SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE uid = ? AND id IN (${placeholders})`
    )
    .run(isEnabled ? 1 : 0, uid, ...normalizedIds);

  return { updated: result.changes };
}

export function deleteSkills(uid, skillIds = []) {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(skillIds) ? skillIds : [])
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  );

  if (!normalizedIds.length) {
    return { deleted: 0 };
  }

  const placeholders = normalizedIds.map(() => "?").join(",");
  const result = db
    .prepare(`DELETE FROM skills WHERE uid = ? AND id IN (${placeholders})`)
    .run(uid, ...normalizedIds);

  return { deleted: result.changes };
}

export function deleteSkillsBySource(uid, sourceType, sourceLocation) {
  db.prepare(
    "DELETE FROM skills WHERE uid = ? AND source_type = ? AND source_location = ?"
  ).run(uid, sourceType, sourceLocation);
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
      acp_agent_id: t.acp_agent_id || null,
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
    t.acp_agent_id = t.acp_agent_id || null;
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
  modelId = "",
  acpAgentId = null
) {
  const parsedAcpAgentId = Number(acpAgentId);
  const normalizedAcpAgentId =
    Number.isFinite(parsedAcpAgentId) && parsedAcpAgentId > 0
      ? Math.round(parsedAcpAgentId)
      : null;
  const result = db
    .prepare(
      `
    INSERT INTO agent_tasks (uid, name, description, system_prompt, skill_ids, tool_names, model_id, acp_agent_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      uid,
      name,
      description,
      systemPrompt,
      JSON.stringify(skillIds),
      JSON.stringify(toolNames),
      modelId,
      normalizedAcpAgentId
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
    acp_agent_id: normalizedAcpAgentId,
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
        "acp_agent_id",
      ].includes(key)
    ) {
      fields.push(`${key} = ?`);
      let val = typeof value === "object" ? JSON.stringify(value) : value;
      if (key === "is_active") {
        val = value ? 1 : 0;
      }
      if (key === "acp_agent_id") {
        const parsedAcpAgentId = Number(value);
        val =
          Number.isFinite(parsedAcpAgentId) && parsedAcpAgentId > 0
            ? Math.round(parsedAcpAgentId)
            : null;
      }
      values.push(val);
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

  db.prepare(
    `UPDATE task_runs SET ${fields.join(", ")} WHERE id = ? AND uid = ?`
  ).run(...values);
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

export function listChannels(uid) {
  return db
    .prepare("SELECT * FROM channels WHERE uid = ? ORDER BY created_at DESC")
    .all(uid)
    .map((channel) => ({
      ...channel,
      agent_prompt: String(channel.agent_prompt || ""),
      metadata: channel.metadata ? JSON.parse(channel.metadata) : null,
    }));
}

export function getChannelById(id, uid) {
  const channel = db
    .prepare("SELECT * FROM channels WHERE id = ? AND uid = ?")
    .get(id, uid);

  if (!channel) {
    return null;
  }

  return {
    ...channel,
    agent_prompt: String(channel.agent_prompt || ""),
    metadata: channel.metadata ? JSON.parse(channel.metadata) : null,
  };
}

export function createChannel(uid, payload) {
  const result = db
    .prepare(
      `
    INSERT INTO channels (uid, name, platform, agent_prompt, webhook_url, bot_token, metadata, is_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      uid,
      payload.name,
      payload.platform,
      String(payload.agent_prompt || "").trim(),
      payload.webhook_url || null,
      payload.bot_token || null,
      payload.metadata ? JSON.stringify(payload.metadata) : null,
      payload.is_enabled ?? 1
    );

  return {
    id: result.lastInsertRowid,
    uid,
    ...payload,
    agent_prompt: String(payload.agent_prompt || "").trim(),
  };
}

export function updateChannel(id, uid, updates) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(updates)) {
    if (
      ["name", "platform", "agent_prompt", "webhook_url", "bot_token", "is_enabled"].includes(
        key
      )
    ) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    if (key === "metadata") {
      fields.push("metadata = ?");
      values.push(value ? JSON.stringify(value) : null);
    }
  }

  if (fields.length === 0) return;
  fields.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id, uid);

  db.prepare(
    `UPDATE channels SET ${fields.join(", ")} WHERE id = ? AND uid = ?`
  ).run(...values);
}

export function deleteChannel(id, uid) {
  db.prepare("DELETE FROM channels WHERE id = ? AND uid = ?").run(id, uid);
}

function normalizeAcpAgentRow(row, { includeSecrets = false } = {}) {
  if (!row) return null;

  const parsedArgs = parseJsonArray(row.args, []);
  const parsedEnv = row.env ? parseJsonObject(decrypt(row.env), {}) : {};

  return {
    ...row,
    args: parsedArgs,
    agent_prompt: String(row.agent_prompt || ""),
    default_model_id: row.default_model_id || null,
    last_used_model_id: row.last_used_model_id || null,
    ...(includeSecrets ? { env: parsedEnv } : {}),
    env_keys: Object.keys(parsedEnv),
    has_env: Object.keys(parsedEnv).length > 0,
  };
}

export function listAcpAgents(uid) {
  return db
    .prepare("SELECT * FROM acp_agents WHERE uid = ? ORDER BY created_at DESC")
    .all(uid)
    .map((row) => normalizeAcpAgentRow(row));
}

export function getAcpAgent(id, uid, options = {}) {
  const row = db
    .prepare("SELECT * FROM acp_agents WHERE id = ? AND uid = ?")
    .get(id, uid);
  return normalizeAcpAgentRow(row, options);
}

export function createAcpAgent(uid, payload = {}) {
  const normalizedArgs = Array.isArray(payload.args) ? payload.args : [];
  const normalizedEnv =
    payload.env && typeof payload.env === "object" ? payload.env : {};
  const encryptedEnv = encrypt(JSON.stringify(normalizedEnv));
  const result = db
    .prepare(
      `
    INSERT INTO acp_agents (uid, name, preset, command, args, env, agent_prompt, default_model_id, is_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      uid,
      payload.name,
      payload.preset,
      payload.command,
      JSON.stringify(normalizedArgs),
      encryptedEnv,
      String(payload.agent_prompt || "").trim(),
      payload.default_model_id || null,
      payload.is_enabled ?? 1
    );

  return getAcpAgent(result.lastInsertRowid, uid);
}

export function deleteAcpAgent(id, uid) {
  db.prepare(
    "UPDATE conversations SET acp_agent_id = NULL, acp_session_id = NULL, acp_model_id = NULL WHERE acp_agent_id = ? AND uid = ?"
  ).run(id, uid);
  db.prepare("UPDATE agent_tasks SET acp_agent_id = NULL WHERE acp_agent_id = ? AND uid = ?").run(
    id,
    uid
  );
  db.prepare("DELETE FROM acp_agents WHERE id = ? AND uid = ?").run(id, uid);
}

export function updateAcpAgent(id, uid, payload = {}) {
  const current = getAcpAgent(id, uid, { includeSecrets: true });
  if (!current) {
    throw new Error("ACP Agent not found");
  }

  const nextArgs = Array.isArray(payload.args) ? payload.args : current.args;
  const nextEnv =
    payload.env && typeof payload.env === "object" ? payload.env : current.env || {};

  db.prepare(
    `
    UPDATE acp_agents
    SET name = ?,
        preset = ?,
        command = ?,
        args = ?,
        env = ?,
        agent_prompt = ?,
        default_model_id = ?,
        last_used_model_id = ?,
        is_enabled = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND uid = ?
  `
  ).run(
    payload.name !== undefined ? payload.name : current.name,
    payload.preset !== undefined ? payload.preset : current.preset,
    payload.command !== undefined ? payload.command : current.command,
    JSON.stringify(nextArgs),
    encrypt(JSON.stringify(nextEnv)),
    payload.agent_prompt !== undefined ? String(payload.agent_prompt || "").trim() : current.agent_prompt || "",
    payload.default_model_id !== undefined ? payload.default_model_id || null : current.default_model_id || null,
    payload.last_used_model_id !== undefined
      ? String(payload.last_used_model_id || "").trim() || null
      : current.last_used_model_id || null,
    payload.is_enabled !== undefined ? (payload.is_enabled ? 1 : 0) : current.is_enabled ?? 1,
    id,
    uid
  );

  return getAcpAgent(id, uid);
}

export function updateAcpAgentLastUsedModel(id, uid, modelId) {
  db.prepare(
    `
    UPDATE acp_agents
    SET last_used_model_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND uid = ?
  `
  ).run(String(modelId || "").trim() || null, id, uid);
}

export default db;
