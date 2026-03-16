import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveExecutableCommand } from "../server/utils/shellEnv.js";

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("shellEnv command resolution", () => {
  it("resolves bare commands from PATH to absolute paths", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workhorse-shell-env-"));
    tempDirs.push(tempDir);

    const commandName = process.platform === "win32" ? "demo-tool.cmd" : "demo-tool";
    const commandPath = path.join(tempDir, commandName);
    fs.writeFileSync(commandPath, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n");
    if (process.platform !== "win32") {
      fs.chmodSync(commandPath, 0o755);
    }

    const resolved = resolveExecutableCommand("demo-tool", {
      HOME: os.homedir(),
      PATH: tempDir,
    });

    expect(resolved).toBe(commandPath);
  });

  it("keeps absolute commands unchanged", () => {
    const absolutePath =
      process.platform === "win32" ? "C:\\tools\\demo-tool.cmd" : "/tmp/demo-tool";

    expect(resolveExecutableCommand(absolutePath, { PATH: "" })).toBe(absolutePath);
  });
});
