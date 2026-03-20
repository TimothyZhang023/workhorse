// zlib removed: bundles are now plain JSON → base64url for easy manual editing

const INSTALL_SCHEME = "workhorse";
const CURRENT_BUNDLE_VERSION = 1;

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function normalizeArray(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value ?? ""))
    : [];
}

function normalizeRecord(record = {}) {
  const entries = Object.entries(record || {})
    .filter(([key, value]) => normalizeText(key) && value !== undefined && value !== null)
    .map(([key, value]) => [String(key), String(value)])
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function toBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input = "") {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4 || 4)) % 4;
  return Buffer.from(`${normalized}${"=".repeat(paddingLength)}`, "base64");
}

function looksSensitiveKey(name = "") {
  return /(token|secret|password|authorization|cookie|api[-_]?key|access[-_]?key)/i.test(
    name
  );
}

function redactValue(name, value) {
  const normalizedName = normalizeText(name);
  if (!looksSensitiveKey(normalizedName)) {
    return value;
  }

  const placeholder = normalizedName
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();

  return placeholder ? `YOUR_${placeholder}` : "YOUR_SECRET";
}

function sanitizeRecord(record = {}) {
  return Object.fromEntries(
    Object.entries(normalizeRecord(record)).map(([key, value]) => [key, redactValue(key, value)])
  );
}

function sanitizeAuth(auth = null) {
  if (!auth || typeof auth !== "object") {
    return null;
  }

  if (auth.type === "bearer") {
    return {
      type: "bearer",
      token: auth.token ? "YOUR_BEARER_TOKEN" : "",
    };
  }

  if (auth.type === "basic") {
    return {
      type: "basic",
      username: normalizeText(auth.username || ""),
      password: auth.password ? "YOUR_BASIC_PASSWORD" : "",
    };
  }

  return null;
}

export function buildSharedMcpSpec(server = {}) {
  return {
    name: normalizeText(server.name || ""),
    type: normalizeText(server.type || "stdio"),
    command: normalizeText(server.command || ""),
    args: normalizeArray(server.args),
    url: normalizeText(server.url || ""),
    env: sanitizeRecord(server.env || {}),
    headers: sanitizeRecord(server.headers || {}),
    auth: sanitizeAuth(server.auth),
    is_enabled: Number(server.is_enabled) === 0 ? 0 : 1,
  };
}

export function buildSharedSkillSpec(skill = {}) {
  return {
    name: normalizeText(skill.name || ""),
    description: normalizeText(skill.description || ""),
    prompt: String(skill.prompt || ""),
    examples: Array.isArray(skill.examples) ? skill.examples : [],
    tools: normalizeArray(skill.tools),
    is_enabled: Number(skill.is_enabled) === 0 ? 0 : 1,
  };
}

function createInstallBundle(kind, spec) {
  return {
    version: CURRENT_BUNDLE_VERSION,
    kind,
    spec,
  };
}

export function encodeInstallBundle(bundle) {
  const json = JSON.stringify(bundle);
  return toBase64Url(Buffer.from(json, "utf8"));
}

export function decodeInstallBundle(token = "") {
  let parsed;
  try {
    // Try plain JSON base64url first (current format)
    const raw = fromBase64Url(token);
    parsed = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    // Fallback: try deflate for legacy bundles
    try {
      const { inflateRawSync } = require("node:zlib");
      const inflated = inflateRawSync(fromBase64Url(token));
      parsed = JSON.parse(Buffer.from(inflated).toString("utf8"));
    } catch (error) {
      throw new Error(`安装链接无效：${error.message}`);
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("安装包格式不正确");
  }
  if (Number(parsed.version) !== CURRENT_BUNDLE_VERSION) {
    throw new Error("安装包版本不受支持");
  }
  if (!["mcp", "skill"].includes(String(parsed.kind || ""))) {
    throw new Error("安装包类型不受支持");
  }
  return parsed;
}

export function buildInstallShare(kind, spec) {
  const bundle = createInstallBundle(kind, spec);
  const token = encodeInstallBundle(bundle);
  const url = `${INSTALL_SCHEME}://install?bundle=${encodeURIComponent(token)}`;

  return {
    kind,
    bundle: token,
    share_url: url,
    commands: {
      macos: `open '${url}'`,
      linux: `xdg-open '${url}'`,
      windows: `start \"\" \"${url}\"`,
    },
  };
}

export function stableComparableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableComparableValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableComparableValue(item)])
    );
  }

  return value;
}

export function areInstallSpecsEqual(left, right) {
  return JSON.stringify(stableComparableValue(left)) === JSON.stringify(stableComparableValue(right));
}
