import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import { basename, join, relative } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const SKILL_SOURCE_ROOT = join(process.cwd(), "data", "skill-sources");
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".github",
  "node_modules",
  "dist",
  "build",
  "target",
  ".next",
  "coverage",
]);

async function ensureDirectory(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function runCommand(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      maxBuffer: 20 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const message =
      error?.stderr?.trim() ||
      error?.stdout?.trim() ||
      error?.message ||
      `failed to run ${command}`;
    throw new Error(message);
  }
}

function isSupportedGitRepositoryUrl(repoUrl) {
  const trimmed = String(repoUrl || "").trim();
  if (!trimmed) return false;

  return (
    /^https?:\/\/.+/i.test(trimmed) ||
    /^git@.+:.+/i.test(trimmed) ||
    /^ssh:\/\/.+/i.test(trimmed) ||
    /^file:\/\/.+/i.test(trimmed)
  );
}

function parseSkillFrontmatter(rawContent) {
  const normalized = String(rawContent || "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { metadata: {}, body: normalized.trim() };
  }

  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (key) {
      metadata[key] = value;
    }
  }

  return {
    metadata,
    body: match[2].trim(),
  };
}

function deriveSkillDescription(body, fallbackDescription = "") {
  if (fallbackDescription) {
    return fallbackDescription;
  }

  const lines = String(body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"));

  return lines[0] || "";
}

function deriveSkillName(metadata, body, fallbackName) {
  if (metadata.name) {
    return String(metadata.name).trim();
  }

  const heading = String(body || "").match(/^#\s+(.+)$/m);
  if (heading?.[1]) {
    return heading[1].trim();
  }

  return fallbackName;
}

async function discoverSkillDirectories(
  rootDir,
  currentDir = rootDir,
  found = []
) {
  const entries = await fsp.readdir(currentDir, { withFileTypes: true });
  let hasSkillMarkdown = false;

  for (const entry of entries) {
    if (entry.isFile() && entry.name === "SKILL.md") {
      hasSkillMarkdown = true;
      break;
    }
  }

  if (hasSkillMarkdown) {
    found.push(currentDir);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;
    await discoverSkillDirectories(
      rootDir,
      join(currentDir, entry.name),
      found
    );
  }

  return found;
}

async function parseSkillDirectory(sourceRoot, skillDir) {
  const skillPath = join(skillDir, "SKILL.md");
  const rawContent = await fsp.readFile(skillPath, "utf8");
  const { metadata, body } = parseSkillFrontmatter(rawContent);
  const fallbackName = basename(skillDir) || "skill";
  const name = deriveSkillName(metadata, body, fallbackName);
  const prompt = body.trim();
  const description = deriveSkillDescription(prompt, metadata.description);

  if (!name) {
    throw new Error(
      `invalid skill package: ${relative(sourceRoot, skillDir)} missing name`
    );
  }

  if (prompt.length < 10) {
    throw new Error(
      `invalid skill package: ${relative(
        sourceRoot,
        skillDir
      )} SKILL.md content too short`
    );
  }

  return {
    name,
    description,
    prompt,
    examples: [],
    tools: [],
    source_item_path: relative(sourceRoot, skillDir) || ".",
  };
}

async function loadSkillsFromDirectory(sourceRoot) {
  const skillDirs = await discoverSkillDirectories(sourceRoot);
  if (skillDirs.length === 0) {
    throw new Error("未发现有效的 Skill 包，要求目录内至少包含一个 SKILL.md");
  }

  const installedSkills = [];
  for (const skillDir of skillDirs) {
    installedSkills.push(await parseSkillDirectory(sourceRoot, skillDir));
  }
  return installedSkills;
}

function getRepositoryCacheDirectory(repoUrl) {
  const repoHash = crypto
    .createHash("sha1")
    .update(repoUrl)
    .digest("hex")
    .slice(0, 12);
  return join(SKILL_SOURCE_ROOT, repoHash);
}

async function syncGitRepository(repoUrl) {
  const normalizedUrl = String(repoUrl || "").trim();
  if (!isSupportedGitRepositoryUrl(normalizedUrl)) {
    throw new Error("仓库地址格式不正确，仅支持 http(s)、ssh、git@ 或 file://");
  }

  await ensureDirectory(SKILL_SOURCE_ROOT);
  const cacheDir = getRepositoryCacheDirectory(normalizedUrl);
  const gitDir = join(cacheDir, ".git");
  const alreadyExists = fs.existsSync(gitDir);

  if (!alreadyExists && fs.existsSync(cacheDir)) {
    await fsp.rm(cacheDir, { recursive: true, force: true });
  }

  if (!alreadyExists) {
    await runCommand("git", ["clone", "--depth", "1", normalizedUrl, cacheDir]);
    return { cacheDir, updated: false };
  }

  await runCommand("git", [
    "-C",
    cacheDir,
    "remote",
    "set-url",
    "origin",
    normalizedUrl,
  ]);
  const { stdout: branchStdout } = await runCommand("git", [
    "-C",
    cacheDir,
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  const currentBranch = branchStdout.trim() || "main";
  await runCommand("git", [
    "-C",
    cacheDir,
    "fetch",
    "--all",
    "--tags",
    "--prune",
  ]);
  await runCommand("git", [
    "-C",
    cacheDir,
    "reset",
    "--hard",
    `origin/${currentBranch}`,
  ]);

  return { cacheDir, updated: true };
}

function decodeBase64Archive(zipBase64) {
  const raw = String(zipBase64 || "").trim();
  if (!raw) {
    throw new Error("zip 文件内容不能为空");
  }

  const normalized = raw.replace(/^data:application\/zip;base64,/, "");
  return Buffer.from(normalized, "base64");
}

async function extractZipArchive(filename, zipBase64) {
  if (
    !String(filename || "")
      .toLowerCase()
      .endsWith(".zip")
  ) {
    throw new Error("仅支持安装 .zip 格式的 Skill 包");
  }

  const tempRoot = await fsp.mkdtemp(join(os.tmpdir(), "cw-skill-zip-"));
  const archivePath = join(tempRoot, filename || "skills.zip");
  const extractDir = join(tempRoot, "extracted");

  await ensureDirectory(extractDir);
  await fsp.writeFile(archivePath, decodeBase64Archive(zipBase64));
  await runCommand("unzip", ["-oq", archivePath, "-d", extractDir]);

  return { tempRoot, extractDir };
}

function normalizeSourceLocation(sourceLocation) {
  return String(sourceLocation || "").trim();
}

export async function installSkillsFromGitRepository(repoUrl) {
  const sourceLocation = normalizeSourceLocation(repoUrl);
  const { cacheDir, updated } = await syncGitRepository(sourceLocation);
  const skills = await loadSkillsFromDirectory(cacheDir);

  return {
    source_type: "git",
    source_location: sourceLocation,
    updated,
    source_root: cacheDir,
    skills,
  };
}

export async function installSkillsFromZipArchive(filename, zipBase64) {
  const sourceLocation =
    String(filename || "uploaded.zip").trim() || "uploaded.zip";
  const { tempRoot, extractDir } = await extractZipArchive(
    sourceLocation,
    zipBase64
  );

  try {
    const skills = await loadSkillsFromDirectory(extractDir);
    return {
      source_type: "zip",
      source_location: sourceLocation,
      updated: false,
      source_root: extractDir,
      skills,
    };
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}
