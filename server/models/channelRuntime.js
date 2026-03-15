import fs from "fs";
import os from "os";
import { join } from "path";

const dataDir =
  process.env.WORKHORSE_DATA_DIR || join(os.homedir(), ".workhorse");
const runtimeDir = join(dataDir, "channel-runtime");

function ensureDir(path) {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true });
  }
}

function getChannelDir(uid, channelId) {
  const channelDir = join(
    runtimeDir,
    String(uid || "local"),
    `channel-${String(channelId)}`
  );
  ensureDir(channelDir);
  return channelDir;
}

function getSessionsPath(uid, channelId) {
  return join(getChannelDir(uid, channelId), "sessions.json");
}

function readJsonFile(path, fallbackValue) {
  try {
    if (!fs.existsSync(path)) {
      return fallbackValue;
    }
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallbackValue;
  }
}

function writeJsonFile(path, value) {
  fs.writeFileSync(path, JSON.stringify(value, null, 2));
}

export function appendChannelEvent(uid, channelId, event) {
  const channelDir = getChannelDir(uid, channelId);
  const day = new Date().toISOString().slice(0, 10);
  const logPath = join(channelDir, `${day}.jsonl`);
  const payload = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  fs.appendFileSync(logPath, `${JSON.stringify(payload)}\n`);
  return logPath;
}

export function getChannelSessionBinding(uid, channelId, participantKey) {
  const sessions = readJsonFile(getSessionsPath(uid, channelId), {});
  return sessions[String(participantKey)] || null;
}

export function setChannelSessionBinding(
  uid,
  channelId,
  participantKey,
  conversationId
) {
  const sessionsPath = getSessionsPath(uid, channelId);
  const sessions = readJsonFile(sessionsPath, {});
  sessions[String(participantKey)] = {
    conversationId: String(conversationId),
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(sessionsPath, sessions);
  return sessions[String(participantKey)];
}
