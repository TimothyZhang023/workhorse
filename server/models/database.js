import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 确保数据目录存在
const dataDir = join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(join(dataDir, 'chat.db'));

// 初始化数据库表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    title TEXT NOT NULL,
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

  CREATE INDEX IF NOT EXISTS idx_conversations_uid ON conversations(uid);
  CREATE INDEX IF NOT EXISTS idx_messages_uid ON messages(uid);
  CREATE INDEX IF NOT EXISTS idx_endpoint_groups_uid ON endpoint_groups(uid);
  CREATE INDEX IF NOT EXISTS idx_models_uid ON models(uid);
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
`);

// 全局预设模型列表
export const PRESET_MODELS = [
  { model_id: 'gemini-3-flash', display_name: 'Gemini 3 Flash' },
  { model_id: 'gemini-3-pro-high', display_name: 'Gemini 3 Pro High' },
  { model_id: 'gemini-3-pro-low', display_name: 'Gemini 3 Pro Low' },
  { model_id: 'gemini-3-pro-image', display_name: 'Gemini 3 Pro (Image)' },
  { model_id: 'gemini-2.5-flash', display_name: 'Gemini 2.5 Flash' },
  { model_id: 'gemini-2.5-flash-thinking', display_name: 'Gemini 2.5 Flash (Thinking)' },
  { model_id: 'claude-sonnet-4-5', display_name: 'Claude 4.5 Sonnet' },
  { model_id: 'claude-sonnet-4-5-thinking', display_name: 'Claude 4.5 Sonnet (Thinking)' },
  { model_id: 'claude-opus-4-5-thinking', display_name: 'Claude 4.5 Opus (Thinking)' },
];

// ============ 用户管理 ============

export function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

export function createUser(username, password) {
  const uid = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  const result = db.prepare(`
    INSERT INTO users (uid, username, password_hash, salt) VALUES (?, ?, ?, ?)
  `).run(uid, username, passwordHash, salt);

  return { id: result.lastInsertRowid, uid, username };
}

export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function getUserByUid(uid) {
  return db.prepare('SELECT id, uid, username, created_at FROM users WHERE uid = ?').get(uid);
}

export function verifyPassword(user, password) {
  const hash = hashPassword(password, user.salt);
  return hash === user.password_hash;
}

// ============ 会话管理 ============

export function createSession(uid) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7天过期

  db.prepare(`
    INSERT INTO sessions (uid, token, expires_at) VALUES (?, ?, ?)
  `).run(uid, token, expiresAt);

  return { token, expiresAt };
}

export function getSession(token) {
  const session = db.prepare(`
    SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')
  `).get(token);
  return session;
}

export function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function cleanExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

// ============ 对话管理 ============

export function getConversations(uid) {
  return db.prepare(`
    SELECT id, title, created_at, updated_at
    FROM conversations
    WHERE uid = ?
    ORDER BY updated_at DESC
  `).all(uid);
}

export function createConversation(uid, title = '新对话') {
  const result = db.prepare(`
    INSERT INTO conversations (uid, title) VALUES (?, ?)
  `).run(uid, title);
  return { id: result.lastInsertRowid, title };
}

export function updateConversationTitle(id, uid, title) {
  db.prepare(`
    UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND uid = ?
  `).run(title, id, uid);
}

export function deleteConversation(id, uid) {
  db.prepare('DELETE FROM messages WHERE conversation_id = ? AND uid = ?').run(id, uid);
  db.prepare('DELETE FROM conversations WHERE id = ? AND uid = ?').run(id, uid);
}

export function getConversation(id, uid) {
  return db.prepare('SELECT * FROM conversations WHERE id = ? AND uid = ?').get(id, uid);
}

// ============ 消息管理 ============

export function getMessages(conversationId, uid) {
  return db.prepare(`
    SELECT id, role, content, created_at
    FROM messages
    WHERE conversation_id = ? AND uid = ?
    ORDER BY created_at ASC
  `).all(conversationId, uid);
}

export function addMessage(conversationId, uid, role, content) {
  const result = db.prepare(`
    INSERT INTO messages (conversation_id, uid, role, content) VALUES (?, ?, ?, ?)
  `).run(conversationId, uid, role, content);

  db.prepare(`
    UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND uid = ?
  `).run(conversationId, uid);

  return { id: result.lastInsertRowid };
}

export function updateMessage(id, uid, content) {
  db.prepare(`
    UPDATE messages SET content = ? WHERE id = ? AND uid = ?
  `).run(content, id, uid);
}

// ============ Endpoint 组管理 ============

export function getEndpointGroups(uid) {
  return db.prepare(`
    SELECT id, name, base_url, api_key, is_default, use_preset_models, created_at, updated_at
    FROM endpoint_groups
    WHERE uid = ?
    ORDER BY is_default DESC, created_at ASC
  `).all(uid);
}

export function getDefaultEndpointGroup(uid) {
  return db.prepare(`
    SELECT id, name, base_url, api_key, is_default, use_preset_models
    FROM endpoint_groups
    WHERE uid = ? AND is_default = 1
  `).get(uid);
}

export function getEndpointGroup(id, uid) {
  return db.prepare(`
    SELECT id, name, base_url, api_key, is_default, use_preset_models, created_at, updated_at
    FROM endpoint_groups
    WHERE id = ? AND uid = ?
  `).get(id, uid);
}

export function createEndpointGroup(uid, name, baseUrl, apiKey, isDefault = false, usePresetModels = true) {
  if (isDefault) {
    db.prepare('UPDATE endpoint_groups SET is_default = 0 WHERE uid = ?').run(uid);
  }
  const result = db.prepare(`
    INSERT INTO endpoint_groups (uid, name, base_url, api_key, is_default, use_preset_models) VALUES (?, ?, ?, ?, ?, ?)
  `).run(uid, name, baseUrl, apiKey, isDefault ? 1 : 0, usePresetModels !== false ? 1 : 0);
  return { id: result.lastInsertRowid, name, base_url: baseUrl, api_key: apiKey, is_default: isDefault ? 1 : 0, use_preset_models: usePresetModels !== false ? 1 : 0 };
}

export function updateEndpointGroup(id, uid, name, baseUrl, apiKey, usePresetModels) {
  db.prepare(`
    UPDATE endpoint_groups SET name = ?, base_url = ?, api_key = ?, use_preset_models = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND uid = ?
  `).run(name, baseUrl, apiKey, usePresetModels ? 1 : 0, id, uid);
}

export function setDefaultEndpointGroup(id, uid) {
  db.prepare('UPDATE endpoint_groups SET is_default = 0 WHERE uid = ?').run(uid);
  db.prepare('UPDATE endpoint_groups SET is_default = 1 WHERE id = ? AND uid = ?').run(id, uid);
}

export function deleteEndpointGroup(id, uid) {
  db.prepare('DELETE FROM models WHERE endpoint_group_id = ? AND uid = ?').run(id, uid);
  db.prepare('DELETE FROM endpoint_groups WHERE id = ? AND uid = ?').run(id, uid);
}

// ============ 模型管理 ============

export function getModels(endpointGroupId, uid) {
  return db.prepare(`
    SELECT id, model_id, display_name, is_enabled
    FROM models
    WHERE endpoint_group_id = ? AND uid = ?
  `).all(endpointGroupId, uid);
}

export function addModel(endpointGroupId, uid, modelId, displayName) {
  const result = db.prepare(`
    INSERT INTO models (endpoint_group_id, uid, model_id, display_name) VALUES (?, ?, ?, ?)
  `).run(endpointGroupId, uid, modelId, displayName);
  return { id: result.lastInsertRowid };
}

export function deleteModel(id, uid) {
  db.prepare('DELETE FROM models WHERE id = ? AND uid = ?').run(id, uid);
}

export default db;
