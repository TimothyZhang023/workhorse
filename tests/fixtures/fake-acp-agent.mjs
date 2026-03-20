#!/usr/bin/env node
import crypto from "node:crypto";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

class FakeAgent {
  constructor(connection) {
    this.connection = connection;
    this.sessions = new Map();
  }

  async initialize(params) {
    return {
      protocolVersion: params.protocolVersion,
      agentInfo: {
        name: "fake-acp-agent",
        title: "Fake ACP Agent",
        version: "1.0.0",
      },
      agentCapabilities: {
        promptCapabilities: {
          image: true,
        },
      },
    };
  }

  async authenticate() {
    return {};
  }

  async newSession() {
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      pending: null,
      modelId: "auto",
    });
    return {
      sessionId,
      models: {
        currentModelId: "auto",
        availableModels: [
          { modelId: "auto", name: "Auto" },
          { modelId: "test-model", name: "Test Model" },
        ],
      },
    };
  }

  async unstable_setSessionModel(params) {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Unknown session ${params.sessionId}`);
    }
    session.modelId = params.modelId;
    return {};
  }

  async prompt(params) {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Unknown session ${params.sessionId}`);
    }

    const controller = new AbortController();
    session.pending = controller;

    try {
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "session_info_update",
          title: "ACP Echo Session",
        },
      });

      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "Inspect workspace",
          kind: "read",
          status: "in_progress",
        },
      });

      const permission = await this.connection.requestPermission({
        sessionId: params.sessionId,
        toolCall: {
          toolCallId: "tool-1",
          title: "Inspect workspace",
          kind: "read",
          status: "in_progress",
        },
        options: [
          {
            optionId: "allow-once",
            name: "Allow once",
            kind: "allow_once",
          },
          {
            optionId: "reject-once",
            name: "Reject",
            kind: "reject_once",
          },
        ],
      });

      if (permission.outcome.outcome === "cancelled") {
        return { stopReason: "cancelled" };
      }

      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          title: "Inspect workspace",
          status: "completed",
        },
      });

      if (process.env.FAKE_ACP_SEND_NULL_USAGE === "1") {
        await this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "usage_update",
            used: null,
            size: 200000,
            cost: {
              amount: 0.12,
              currency: "USD",
            },
          },
        });
      }

      if (controller.signal.aborted) {
        return { stopReason: "cancelled" };
      }

      const textPrompt =
        (params.prompt || []).find((item) => item.type === "text")?.text || "";
      const responseText = textPrompt.includes("只回复单个单词 READY")
        ? "READY"
        : `ACP[${session.modelId}]:${textPrompt}`;

      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: responseText,
          },
        },
      });

      return {
        stopReason: "end_turn",
      };
    } finally {
      session.pending = null;
    }
  }

  async cancel(params) {
    this.sessions.get(params.sessionId)?.pending?.abort();
  }
}

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = acp.ndJsonStream(input, output);
new acp.AgentSideConnection((connection) => new FakeAgent(connection), stream);
