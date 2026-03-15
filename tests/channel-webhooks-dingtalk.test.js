import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

const runConversationMessageMock = vi.fn();

vi.mock("../server/routes/conversations.js", async () => {
  const actual = await vi.importActual("../server/routes/conversations.js");
  return {
    ...actual,
    runConversationMessage: runConversationMessageMock,
  };
});

describe("channel-webhooks inbound agent flow", () => {
  let app;
  let dingtalkChannel;
  let telegramChannel;

  beforeAll(async () => {
    const { createApp } = await import("../server/app.js");
    app = createApp();

    const dingtalkRes = await request(app)
      .post("/api/channels")
      .send({
        name: "Ops Ding",
        platform: "dingtalk",
        metadata: {
          connection_mode: "stream",
          client_id: "mock-client",
          client_secret: "mock-secret",
        },
      })
      .expect(200);
    dingtalkChannel = dingtalkRes.body;

    const telegramRes = await request(app)
      .post("/api/channels")
      .send({
        name: "Ops TG",
        platform: "telegram",
        bot_token: "mock-bot-token",
        metadata: {
          connection_mode: "webhook",
          secret_token: "tg-secret",
        },
      })
      .expect(200);
    telegramChannel = telegramRes.body;
  });

  it("treats dingtalk text as a direct agent input and returns mock delivery payload", async () => {
    runConversationMessageMock.mockResolvedValueOnce({
      conversationId: "101",
      assistantMessageId: 88,
      finalResponse: "你好，我现在是 agent 工作台里的主执行代理。",
    });

    const res = await request(app)
      .post(
        `/api/channel-webhooks/dingtalk/${dingtalkChannel.id}?uid=${encodeURIComponent(
          dingtalkChannel.uid
        )}`
      )
      .send({
        senderStaffId: "user-001",
        senderNick: "Mock User",
        conversationId: "ding-group-01",
        text: {
          content: "你是谁？",
        },
      })
      .expect(200);

    expect(runConversationMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: dingtalkChannel.uid,
        message: "你是谁？",
        source: "dingtalk_channel",
      })
    );
    expect(res.body.msgtype).toBe("text");
    expect(res.body.text.content).toContain("主执行代理");
    expect(res.body.text.content).toContain("[mock-delivery] conversation=101");
  });

  it("reuses the same session conversation for the same dingtalk participant", async () => {
    runConversationMessageMock.mockClear();

    runConversationMessageMock.mockImplementationOnce(async ({ conversationId }) => ({
      conversationId: String(conversationId),
      assistantMessageId: 89,
      finalResponse: "第一次",
    }));

    await request(app)
      .post(
        `/api/channel-webhooks/dingtalk/${dingtalkChannel.id}?uid=${encodeURIComponent(
          dingtalkChannel.uid
        )}`
      )
      .send({
        senderStaffId: "same-user",
        senderNick: "Same User",
        text: { content: "第一句" },
      })
      .expect(200);

    runConversationMessageMock.mockImplementationOnce(async ({ conversationId }) => ({
      conversationId: String(conversationId),
      assistantMessageId: 90,
      finalResponse: "第二次",
    }));

    await request(app)
      .post(
        `/api/channel-webhooks/dingtalk/${dingtalkChannel.id}?uid=${encodeURIComponent(
          dingtalkChannel.uid
        )}`
      )
      .send({
        senderStaffId: "same-user",
        senderNick: "Same User",
        text: { content: "第二句" },
      })
      .expect(200);

    expect(runConversationMessageMock.mock.calls.at(-2)?.[0]?.conversationId).toBe(
      runConversationMessageMock.mock.calls.at(-1)?.[0]?.conversationId
    );
  });

  it("creates a fresh conversation on /new without executing the agent", async () => {
    runConversationMessageMock.mockClear();

    const res = await request(app)
      .post(
        `/api/channel-webhooks/telegram/${telegramChannel.id}?uid=${encodeURIComponent(
          telegramChannel.uid
        )}`
      )
      .set("X-Telegram-Bot-Api-Secret-Token", "tg-secret")
      .send({
        message: {
          text: "/new",
          chat: { id: 7788 },
          from: { id: 6677, username: "fresh_user" },
        },
      })
      .expect(200);

    expect(runConversationMessageMock).not.toHaveBeenCalled();
    expect(res.body.result.text).toContain("已创建新会话");
  });

  it("runs the agent in a fresh conversation when /new carries a prompt", async () => {
    runConversationMessageMock.mockClear();
    runConversationMessageMock.mockResolvedValueOnce({
      conversationId: "501",
      assistantMessageId: 301,
      finalResponse: "这是新会话里的结果。",
    });

    await request(app)
      .post(
        `/api/channel-webhooks/telegram/${telegramChannel.id}?uid=${encodeURIComponent(
          telegramChannel.uid
        )}`
      )
      .set("X-Telegram-Bot-Api-Secret-Token", "tg-secret")
      .send({
        message: {
          text: "/new 帮我查一下今天的待办",
          chat: { id: 7799 },
          from: { id: 6688, username: "new_prompt_user" },
        },
      })
      .expect(200);

    expect(runConversationMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "帮我查一下今天的待办",
      })
    );
  });

  it("validates telegram secret token and returns simulated sendMessage payload", async () => {
    runConversationMessageMock.mockResolvedValueOnce({
      conversationId: "201",
      assistantMessageId: 91,
      finalResponse: "telegram 已执行",
    });

    const res = await request(app)
      .post(
        `/api/channel-webhooks/telegram/${telegramChannel.id}?uid=${encodeURIComponent(
          telegramChannel.uid
        )}`
      )
      .set("X-Telegram-Bot-Api-Secret-Token", "tg-secret")
      .send({
        message: {
          text: "帮我执行一下",
          chat: { id: 9988 },
          from: { id: 5566, username: "mock_tg_user" },
        },
      })
      .expect(200);

    expect(runConversationMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: telegramChannel.uid,
        message: "帮我执行一下",
        source: "telegram_channel",
      })
    );
    expect(res.body.method).toBe("sendMessage");
    expect(res.body.result.chat_id).toBe(9988);
    expect(res.body.result.text).toContain("telegram 已执行");
  });
});
