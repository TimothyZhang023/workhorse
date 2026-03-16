import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let cachedEnv = null;

function dedupeEntries(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function expandHomeDir(targetPath, homeDir) {
  if (!targetPath) return "";
  if (targetPath === "~") return homeDir;
  if (targetPath.startsWith("~/")) {
    return path.join(homeDir, targetPath.slice(2));
  }
  return targetPath;
}

function getDefaultPathEntries(homeDir) {
  if (process.platform === "win32") {
    return [];
  }

  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    "~/.local/bin",
    "~/bin",
    "~/.cargo/bin",
    "~/.npm-global/bin",
    "~/.utoo-proxy",
  ].map((entry) => expandHomeDir(entry, homeDir));
}

function normalizeEnv(rawEnv = {}) {
  const homeDir = String(rawEnv.HOME || process.env.HOME || os.homedir()).trim();
  const pathEntries = [
    ...String(rawEnv.PATH || process.env.PATH || "")
      .split(path.delimiter)
      .map((entry) => expandHomeDir(entry, homeDir)),
    ...getDefaultPathEntries(homeDir),
  ];

  return {
    ...process.env,
    ...rawEnv,
    HOME: homeDir,
    PATH: dedupeEntries(pathEntries).join(path.delimiter),
  };
}

function parseEnvOutput(output) {
  const env = {};
  const chunks = String(output || "").split("\0");

  for (const chunk of chunks) {
    const line = chunk.trim();
    const firstEqual = line.indexOf("=");
    if (firstEqual <= 0) continue;
    const key = line.slice(0, firstEqual);
    const value = line.slice(firstEqual + 1);
    env[key] = value;
  }

  return env;
}

function getShellCandidates() {
  return dedupeEntries([
    process.env.SHELL,
    "/bin/zsh",
    "/bin/bash",
    "/bin/sh",
  ]);
}

function loadShellEnv(shell, interactive) {
  const shellArgs = [interactive ? "-ilc" : "-lc", "command env -0"];
  const output = execFileSync(shell, shellArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000,
    env: normalizeEnv(process.env),
  });
  return parseEnvOutput(output);
}

function isDirectCommandPath(command) {
  const normalized = String(command || "").trim();
  if (!normalized) return false;

  return (
    normalized.includes(path.sep) ||
    normalized.includes(path.win32.sep) ||
    path.isAbsolute(normalized)
  );
}

function isExecutable(candidatePath) {
  try {
    fs.accessSync(candidatePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findCommandInPath(command, env) {
  const pathValue = String(env?.PATH || "");
  const entries = dedupeEntries(pathValue.split(path.delimiter));
  const suffixes =
    process.platform === "win32"
      ? ["", ".exe", ".cmd", ".bat"]
      : [""];

  for (const entry of entries) {
    for (const suffix of suffixes) {
      const candidate = path.join(entry, `${command}${suffix}`);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return "";
}

function resolveCommandWithShell(command, env) {
  if (process.platform === "win32") {
    return "";
  }

  for (const shell of getShellCandidates()) {
    try {
      const output = execFileSync(
        shell,
        ["-ilc", "command -v -- \"$1\"", "workhorse-shell", command],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
          env: normalizeEnv(env),
        }
      )
        .trim()
        .split("\n")
        .pop()
        ?.trim();

      if (output && isExecutable(output)) {
        return output;
      }
    } catch {
      // Try the next shell candidate.
    }
  }

  return "";
}

/**
 * Fetches the shell environment variables by running a login shell and printing the env.
 * This ensures that environment variables set in .zshrc, .bashrc, or .zprofile are available.
 */
export function getShellEnv() {
  if (cachedEnv) return cachedEnv;

  if (process.platform === "win32") {
    cachedEnv = normalizeEnv(process.env);
    return cachedEnv;
  }

  for (const shell of getShellCandidates()) {
    for (const interactive of [true, false]) {
      try {
        const env = loadShellEnv(shell, interactive);
        cachedEnv = normalizeEnv(env);
        console.log(
          "[ShellEnv] Successfully loaded environment from shell:",
          shell,
          interactive ? "(interactive login)" : "(login)"
        );
        return cachedEnv;
      } catch (error) {
        if (!interactive) {
          console.warn("[ShellEnv] Failed to fetch shell environment:", error.message);
        }
      }
    }
  }

  cachedEnv = normalizeEnv(process.env);
  return cachedEnv;
}

export function resolveExecutableCommand(command, env = getShellEnv()) {
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand || isDirectCommandPath(normalizedCommand)) {
    return normalizedCommand;
  }

  const normalizedEnv = normalizeEnv(env);
  const pathMatch = findCommandInPath(normalizedCommand, normalizedEnv);
  if (pathMatch) {
    return pathMatch;
  }

  const shellMatch = resolveCommandWithShell(normalizedCommand, normalizedEnv);
  if (shellMatch) {
    return shellMatch;
  }

  return normalizedCommand;
}
