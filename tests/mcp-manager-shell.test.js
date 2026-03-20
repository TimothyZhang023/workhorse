import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createUser } from "../server/models/database.js";
import {
  BUILTIN_SHELL_TOOL_NAME,
  abortBuiltInShellExecutions,
  executeBuiltInShellTool,
  getAllAvailableTools,
} from "../server/models/mcpManager.js";

describe("built-in shell tool", () => {
  it("is available even when no MCP servers are configured", async () => {
    const user = createUser(`shell_tool_${Date.now()}`, "password123");
    const tools = await getAllAvailableTools(user.uid);

    expect(
      tools.some((tool) => tool.function?.name === BUILTIN_SHELL_TOOL_NAME)
    ).toBe(true);
  });

  it("executes a shell command inside the current workspace", async () => {
    const result = await executeBuiltInShellTool({
      command: "printf 'hello-shell'",
      cwd: ".",
      timeout_ms: 5000,
    });

    const text = String(result.content?.[0]?.text || "");
    expect(text).toContain("Command: printf 'hello-shell'");
    expect(text).toContain("STDOUT:");
    expect(text).toContain("hello-shell");
    const expectedCwd = process.env.WORKHORSE_DATA_DIR || process.cwd();
    expect(text).toContain(`CWD: ${expectedCwd}`);
  });

  it("prefers WORKHORSE_WORKSPACE_ROOT for the default shell cwd", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "workhorse-workspace-root-")
    );
    const previousWorkspaceRoot = process.env.WORKHORSE_WORKSPACE_ROOT;
    process.env.WORKHORSE_WORKSPACE_ROOT = workspaceRoot;

    try {
      const result = await executeBuiltInShellTool({
        command: "printf 'workspace-root'",
        cwd: ".",
        timeout_ms: 5000,
      });

      const text = String(result.content?.[0]?.text || "");
      expect(text).toContain(`CWD: ${workspaceRoot}`);
      expect(text).toContain("workspace-root");
    } finally {
      if (previousWorkspaceRoot === undefined) {
        delete process.env.WORKHORSE_WORKSPACE_ROOT;
      } else {
        process.env.WORKHORSE_WORKSPACE_ROOT = previousWorkspaceRoot;
      }
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("aborts shell execution via abort signal", async () => {
    const controller = new AbortController();
    const runPromise = executeBuiltInShellTool(
      {
        command: "sleep 3; echo should-not-print",
        timeout_ms: 10000,
      },
      {
        signal: controller.signal,
        executionScope: {
          uid: `shell_abort_${Date.now()}`,
          conversationId: "conv-abort-signal",
        },
      }
    );

    setTimeout(() => {
      controller.abort("manual-stop");
    }, 120);

    const result = await runPromise;
    const text = String(result.content?.[0]?.text || "");
    expect(text).toContain("Aborted: yes");
  });

  it("aborts shell execution by scope kill", async () => {
    const scope = {
      uid: `shell_scope_${Date.now()}`,
      conversationId: "conv-scope-kill",
    };
    const runPromise = executeBuiltInShellTool(
      {
        command: "sleep 4; echo should-not-print",
        timeout_ms: 12000,
      },
      {
        executionScope: scope,
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 150));
    const killed = abortBuiltInShellExecutions(scope);
    expect(killed).toBeGreaterThan(0);

    const result = await runPromise;
    const text = String(result.content?.[0]?.text || "");
    expect(text).toContain("Aborted: no");
    expect(text).toContain("Signal: SIG");
  });
});
