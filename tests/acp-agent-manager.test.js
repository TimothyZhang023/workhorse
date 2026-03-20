import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
  createAcpAgent,
  createConversation,
  createUser,
  getConversation,
  updateConversationTitle,
} from "../server/models/database.js";
import {
  resolveAcpLaunchSpec,
  shutdownAcpRuntimes,
  streamAcpConversation,
  testAcpAgentConnection,
} from "../server/models/acpAgentManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fakeAgentPath = path.join(__dirname, "fixtures", "fake-acp-agent.mjs");

describe("acpAgentManager", () => {
  afterAll(() => {
    shutdownAcpRuntimes();
  });

  it("connects to an ACP agent and streams prompt output", async () => {
    const user = createUser(`user_${Date.now()}_acp_runtime`, "password123");
    const agent = createAcpAgent(user.uid, {
      name: "Fake ACP",
      preset: "opencode",
      command: process.execPath,
      args: [fakeAgentPath],
      env: {},
      default_model_id: "test-model",
      is_enabled: 1,
    });
    const conversation = createConversation(user.uid, "新对话", null, {
      acpAgentId: agent.id,
    });

    const chunks = [];
    const res = {
      write(payload) {
        chunks.push(String(payload));
      },
    };

    const connection = await testAcpAgentConnection(user.uid, agent.id);
    expect(connection.success).toBe(true);
    expect(connection.agent_info.name).toBe("fake-acp-agent");

    const reply = await streamAcpConversation({
      uid: user.uid,
      conversation,
      conversationId: String(conversation.id),
      message: "hello acp",
      images: [],
      res,
      debug: true,
    });

    expect(reply).toBe("ACP[test-model]:hello acp");
    expect(chunks.join("")).toContain("Inspect workspace");
    expect(chunks.join("")).toContain("ACP[test-model]:hello acp");

    const persistedConversation = getConversation(conversation.id, user.uid);
    expect(persistedConversation.acp_session_id).toBeTruthy();
    expect(persistedConversation.title).toBe("ACP Echo Session");
  });

  it("normalizes legacy claude adapter commands to the official npx launch", () => {
    expect(
      resolveAcpLaunchSpec({
        preset: "claude_code",
        command: "claude-code-acp",
        args: [],
      })
    ).toEqual({
      command: "npx",
      args: ["-y", "@zed-industries/claude-agent-acp"],
    });
  });

  it("reconnects by rebuilding session history when the external runtime is gone", async () => {
    const user = createUser(`user_${Date.now()}_acp_reconnect`, "password123");
    const agent = createAcpAgent(user.uid, {
      name: "Fake ACP Reconnect",
      preset: "opencode",
      command: process.execPath,
      args: [fakeAgentPath],
      env: {},
      default_model_id: "test-model",
      is_enabled: 1,
    });
    const conversation = createConversation(user.uid, "新对话", null, {
      acpAgentId: agent.id,
    });

    const firstChunks = [];
    const firstReply = await streamAcpConversation({
      uid: user.uid,
      conversation,
      conversationId: String(conversation.id),
      message: "first turn",
      images: [],
      history: [{ role: "user", content: "first turn" }],
      res: {
        write(payload) {
          firstChunks.push(String(payload));
        },
      },
      debug: false,
    });

    expect(firstReply).toBe("ACP[test-model]:first turn");
    const firstState = getConversation(conversation.id, user.uid);
    expect(firstState.acp_session_id).toBeTruthy();
    updateConversationTitle(conversation.id, user.uid, "已建立");

    shutdownAcpRuntimes();

    const secondChunks = [];
    const secondReply = await streamAcpConversation({
      uid: user.uid,
      conversation: getConversation(conversation.id, user.uid),
      conversationId: String(conversation.id),
      message: "second turn",
      images: [],
      history: [
        { role: "user", content: "first turn" },
        { role: "assistant", content: "ACP[test-model]:first turn" },
        { role: "user", content: "second turn" },
      ],
      res: {
        write(payload) {
          secondChunks.push(String(payload));
        },
      },
      debug: false,
    });

    expect(secondReply).toBe("ACP[test-model]:second turn");
    expect(secondChunks.join("")).toContain("ACP[test-model]:second turn");
    const secondState = getConversation(conversation.id, user.uid);
    expect(secondState.acp_session_id).toBeTruthy();
    expect(secondState.acp_session_id).not.toBe(firstState.acp_session_id);
  });

  it("accepts usage_update notifications even when an external adapter sends used=null", async () => {
    const user = createUser(`user_${Date.now()}_acp_usage`, "password123");
    const agent = createAcpAgent(user.uid, {
      name: "Fake ACP Null Usage",
      preset: "opencode",
      command: process.execPath,
      args: [fakeAgentPath],
      env: {
        FAKE_ACP_SEND_NULL_USAGE: "1",
      },
      default_model_id: "test-model",
      is_enabled: 1,
    });
    const conversation = createConversation(user.uid, "新对话", null, {
      acpAgentId: agent.id,
    });

    const chunks = [];
    const reply = await streamAcpConversation({
      uid: user.uid,
      conversation,
      conversationId: String(conversation.id),
      message: "usage check",
      images: [],
      res: {
        write(payload) {
          chunks.push(String(payload));
        },
      },
      debug: false,
    });

    expect(reply).toBe("ACP[test-model]:usage check");
    expect(chunks.join("")).toContain("ACP[test-model]:usage check");
  });
});
