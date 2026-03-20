import OpenAI from "openai";

import { getEndpointGroup, logUsage } from "../models/database.js";
import {
  buildStaticContextBudget,
  estimateMessagesTokens,
  estimateToolSchemaTokens,
  resolveContextWindowTokens,
  truncateTextToTokenBudget,
} from "./contextBudget.js";
import {
  getPreferredEnabledModel,
  mergeGenerationConfig,
} from "./modelSelection.js";

const RECENT_MESSAGES_TO_KEEP = 8;

function normalizeMessageContent(content = "") {
  return String(content || "").replace(/\[IMAGE_DATA:[^\]]+\]/g, "[图片]");
}

function formatMessageForCompaction(message) {
  const role = String(message?.role || "unknown");
  const name = String(message?.name || "").trim();
  const content = normalizeMessageContent(message?.content || "").trim();
  const prefix = name ? `${role}(${name})` : role;
  return `${prefix}: ${content}`;
}

function buildFallbackSegmentSummary(messages = [], depthLabel = "轻度压缩") {
  const lines = messages
    .filter((message) => String(message?.content || "").trim())
    .slice(-6)
    .map((message) => formatMessageForCompaction(message));

  if (!lines.length) {
    return `${depthLabel}完成，但没有提取出稳定可复用的历史内容。`;
  }

  return [
    `${depthLabel}结果：`,
    ...lines.map((line, index) => `${index + 1}. ${line}`),
  ].join("\n");
}

function splitCompactionSegments(messages = []) {
  const olderMessages = Array.isArray(messages)
    ? messages.filter((message) => String(message?.content || "").trim())
    : [];
  if (!olderMessages.length) {
    return [];
  }

  const farCount = Math.max(1, Math.floor(olderMessages.length * 0.5));
  const middleCount = Math.max(
    olderMessages.length - farCount >= 2
      ? 1
      : 0,
    Math.floor(olderMessages.length * 0.3)
  );

  const far = olderMessages.slice(0, farCount);
  const middle = olderMessages.slice(farCount, farCount + middleCount);
  const near = olderMessages.slice(farCount + middleCount);

  return [
    {
      key: "far",
      label: "深度压缩",
      instructions:
        "请极度压缩这段较早历史，只保留长期目标、关键约束、重要决策、已验证事实和仍然有效的外部结论。删除过程细节和短期上下文。",
      messages: far,
      budgetRatio: 0.025,
    },
    {
      key: "middle",
      label: "中度压缩",
      instructions:
        "请中度压缩这段中期历史，保留阶段性进展、重要工具结果、关键变更和未完成事项。",
      messages: middle,
      budgetRatio: 0.04,
    },
    {
      key: "near",
      label: "轻度压缩",
      instructions:
        "请轻度压缩这段较近历史，尽量保留用户最近意图、约束变化、错误现象和待继续推进的步骤。",
      messages: near,
      budgetRatio: 0.055,
    },
  ].filter((segment) => segment.messages.length > 0);
}

async function summarizeSegment({
  uid,
  contextWindow,
  segment,
  preferredModel,
}) {
  const transcript = segment.messages.map(formatMessageForCompaction).join("\n\n");
  const clippedTranscript = truncateTextToTokenBudget(
    transcript,
    Math.max(1024, Math.floor(contextWindow * 0.16)),
    { preserveEnd: false }
  );

  if (!preferredModel?.endpoint_id || !preferredModel?.model_id) {
    return buildFallbackSegmentSummary(segment.messages, segment.label);
  }

  const endpoint = getEndpointGroup(preferredModel.endpoint_id, uid);
  if (!endpoint?.api_key) {
    return buildFallbackSegmentSummary(segment.messages, segment.label);
  }

  const baseUrl = String(endpoint.base_url || "").replace(/\/+$/, "");
  const client = new OpenAI({
    apiKey: endpoint.api_key,
    baseURL: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
  });

  try {
    const completion = await client.chat.completions.create({
      model: preferredModel.model_id,
      temperature: 0.2,
      max_tokens: Math.min(1536, Math.max(256, Math.floor(contextWindow * segment.budgetRatio))),
      messages: [
        {
          role: "system",
          content:
            "你负责压缩对话历史。必须使用简洁中文，保留用户目标、关键约束、重要事实、关键错误、有效工具结果、已完成动作、未完成事项。不得编造。只输出摘要正文。",
        },
        {
          role: "user",
          content: `${segment.instructions}\n\n待压缩历史：\n${clippedTranscript}`,
        },
      ],
    });

    const content = String(completion.choices?.[0]?.message?.content || "").trim();
    if (!content) {
      return buildFallbackSegmentSummary(segment.messages, segment.label);
    }

    if (completion.usage) {
      logUsage({
        uid,
        conversationId: null,
        model: preferredModel.model_id,
        endpointName: endpoint.name,
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        source: "conversation_compact",
      });
    }

    return content;
  } catch {
    return buildFallbackSegmentSummary(segment.messages, segment.label);
  }
}

export async function computeConversationContextBudget({
  uid,
  conversation,
  history = [],
  systemPrompt = "",
  tools = [],
}) {
  const preferredModel = getPreferredEnabledModel(uid);
  const resolvedContextWindow = resolveContextWindowTokens(
    { context_window: conversation?.context_window ?? preferredModel?.generation_config?.context_window },
    undefined
  );
  const contextWindow =
    resolvedContextWindow || conversation?.context_window || 256 * 1024;
  const staticBudget = buildStaticContextBudget({
    globalMarkdown: "",
    skills: [],
    tools,
    contextWindow,
  });
  const messageTokens =
    estimateMessagesTokens(history) +
    estimateMessagesTokens(systemPrompt ? [{ role: "system", content: systemPrompt }] : []);
  const toolTokens = estimateToolSchemaTokens(tools);
  const totalEstimatedTokens = staticBudget.static_tokens + messageTokens + toolTokens;
  const remainingTokens = Math.max(0, contextWindow - totalEstimatedTokens);
  const remainingPercentage = Number(
    ((remainingTokens / contextWindow) * 100).toFixed(2)
  );

  return {
    context_window: contextWindow,
    static_tokens: staticBudget.static_tokens,
    estimated_message_tokens: messageTokens,
    estimated_tool_tokens: toolTokens,
    total_estimated_tokens: totalEstimatedTokens,
    remaining_tokens: remainingTokens,
    remaining_percentage: remainingPercentage,
    compact_required: remainingPercentage < 50,
    preferred_model_id: preferredModel?.model_id || null,
  };
}

export async function buildCompactedConversationHistory({
  uid,
  conversation,
  history = [],
  systemPrompt = "",
  tools = [],
  force = false,
}) {
  const budget = await computeConversationContextBudget({
    uid,
    conversation,
    history,
    systemPrompt,
    tools,
  });

  if (!force && budget.remaining_percentage >= 50) {
    return {
      compacted: false,
      history,
      summaryMessages: [],
      budget,
    };
  }

  if (!Array.isArray(history) || history.length <= RECENT_MESSAGES_TO_KEEP + 2) {
    return {
      compacted: false,
      history,
      summaryMessages: [],
      budget,
    };
  }

  const recentMessages = history.slice(-RECENT_MESSAGES_TO_KEEP);
  const olderMessages = history.slice(0, -RECENT_MESSAGES_TO_KEEP);
  const segments = splitCompactionSegments(olderMessages);
  const preferredModel = getPreferredEnabledModel(uid);

  const summaries = [];
  for (const segment of segments) {
    const summary = await summarizeSegment({
      uid,
      contextWindow: budget.context_window,
      segment,
      preferredModel,
    });
    summaries.push({
      role: "assistant",
      content: `[CONTEXT_COMPACTED:${segment.key}]\n${segment.label}摘要：\n${summary}`,
    });
  }

  const compactedHistory = [...summaries, ...recentMessages];
  const compactedBudget = await computeConversationContextBudget({
    uid,
    conversation,
    history: compactedHistory,
    systemPrompt,
    tools,
  });

  return {
    compacted: true,
    history: compactedHistory,
    summaryMessages: summaries,
    droppedMessages: olderMessages,
    budget: compactedBudget,
    original_budget: budget,
  };
}
