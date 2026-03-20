import OpenAI from "openai";
import { logger } from "../utils/logger.js";
import {
  addTaskRunEvent,
  addMessage,
  createTaskRun,
  createConversation,
  getAgentTask,
  getAppSetting,
  logUsage,
  updateTaskRun,
  updateConversationContextWindow,
  updateConversationSystemPrompt,
} from "./database.js";
import { streamAcpConversation } from "./acpAgentManager.js";
import {
  executeAgentToolCall,
  requestAgentTurnWithFallback,
  requestForcedFinalAgentResponse,
} from "./agentExecutionCore.js";
import {
  buildAgentSystemPrompt,
  prepareAgentTooling,
  selectAgentSkills,
  selectAgentTools,
} from "./agentRuntimeConfig.js";
import {
  estimateMessagesTokens,
  estimateToolSchemaTokens,
  resolveCompactionThresholdTokens,
  resolveContextWindowTokens,
  truncateTextToTokenBudget,
} from "../utils/contextBudget.js";
import {
  findModelConfigForEndpoint,
  mergeGenerationConfig,
  resolveEndpointModelPair,
} from "../utils/modelSelection.js";
import { getTaskConfig } from "../utils/systemConfig.js";

const DEFAULT_MAX_TURNS = 100;
const DEFAULT_MAX_TOOL_CALLS_PER_SIGNATURE = 100;
const RECENT_MESSAGES_TO_KEEP = 8;

export function selectTaskSkills(task, allSkills = []) {
  return selectAgentSkills(allSkills, task?.skill_ids);
}

export function selectTaskTools(task, allTools = []) {
  return selectAgentTools(allTools, task?.tool_names);
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortJsonValue(value[key]);
        return acc;
      }, {});
  }

  return value;
}

export function getToolCallSignature(toolCall) {
  const toolName = toolCall?.function?.name || "unknown_tool";
  const rawArgs = toolCall?.function?.arguments;

  if (!rawArgs) {
    return `${toolName}:`;
  }

  try {
    const normalized = JSON.stringify(sortJsonValue(JSON.parse(rawArgs)));
    return `${toolName}:${normalized}`;
  } catch {
    return `${toolName}:${rawArgs}`;
  }
}

export function registerToolCall(
  toolCallCounts,
  toolCall,
  maxCalls = DEFAULT_MAX_TOOL_CALLS_PER_SIGNATURE
) {
  const signature = getToolCallSignature(toolCall);
  const count = (toolCallCounts.get(signature) || 0) + 1;
  toolCallCounts.set(signature, count);

  return {
    signature,
    count,
    overBudget: count > maxCalls,
  };
}

function normalizeInlineText(value, maxLength = 220) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trim()}...`
    : normalized;
}

export function isUsableFinalResponse(content) {
  const normalized = normalizeInlineText(content, 500);
  if (!normalized) {
    return false;
  }

  return !/<tool_call|<\/?function|<parameter/i.test(normalized);
}

export function buildFallbackFinalResponse(messages, reason) {
  const recentToolResults = messages
    .filter(
      (message) =>
        message.role === "tool" && normalizeInlineText(message.content)
    )
    .slice(-3)
    .map((message) => {
      const toolName = message.name || "tool";
      return `${toolName}: ${normalizeInlineText(message.content, 120)}`;
    });

  if (recentToolResults.length > 0) {
    return `⚠️ ${reason} 最近工具结果：${recentToolResults.join("；")}`;
  }

  return `⚠️ ${reason} 请打开会话查看完整轨迹。`;
}

function safeAddRunEvent(runId, uid, eventType, title, content = "", metadata) {
  if (!runId) return;

  try {
    addTaskRunEvent(runId, uid, eventType, title, content, metadata);
  } catch (error) {
    logger.warn(
      { err: error, runId, uid, eventType },
      "[AgentEngine] Failed to persist run event"
    );
  }
}

async function requestForcedFinalResponse({
  client,
  modelId,
  messages,
  uid,
  conversationId,
  endpointName,
  reason,
  runId,
  generationConfig = {},
}) {
  logger.warn(
    { uid, conversationId, modelId, reason },
    "[AgentEngine] Forcing final summary"
  );
  safeAddRunEvent(runId, uid, "forced_summary", "触发强制总结", reason, {
    modelId,
  });

  const content = await requestForcedFinalAgentResponse({
    client,
    modelId,
    messages,
    wrapUpPrompt: `[TASK_WRAP_UP] ${reason}\n请基于已经拿到的上下文和工具结果，直接输出纯文本最终结论。不要继续调用工具，不要输出 XML、JSON、<tool_call>、函数名或参数块。\n输出格式：\n结论：...\n依据：...\n下一步：如无则写“无”。`,
    generationConfig,
    onUsage: (usage) => {
      if (!usage) return;
      logUsage({
        uid,
        conversationId,
        model: modelId,
        endpointName,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        source: "agent_task",
      });
    },
  });

  if (isUsableFinalResponse(content)) {
    return content;
  }

  return buildFallbackFinalResponse(messages, reason);
}

export function resolveInitialUserMessage(task, initialUserMessage) {
  const trimmed = String(initialUserMessage || "").trim();
  if (trimmed) {
    return trimmed;
  }

  return `[TASK_RUN] 请开始执行任务「${task.name}」。请严格遵循 system prompt；如已配置工具，请按需调用后给出最终结论。`;
}

function prepareTaskRunExecution(uid, taskId, options = {}) {
  const task = getAgentTask(taskId, uid);
  if (!task) throw new Error("AgentTask not found");
  const initialUserMessage = resolveInitialUserMessage(
    task,
    options.initialUserMessage
  );

  let conversationId = options.conversationId;
  if (!conversationId) {
    const conv = createConversation(
      uid,
      `Run: ${task.name} at ${new Date().toLocaleString()}`,
      null,
      {
        acpAgentId: task.acp_agent_id || null,
      }
    );
    conversationId = conv.id;
  }

  const taskRun = createTaskRun({
    uid,
    taskId,
    cronJobId: options.cronJobId || null,
    conversationId,
    triggerSource: options.triggerSource || "manual",
    status: "running",
    initialMessage: initialUserMessage,
  });
  const runId = taskRun?.id || null;
  safeAddRunEvent(
    runId,
    uid,
    "run_started",
    "任务开始执行",
    initialUserMessage,
    {
      triggerSource: options.triggerSource || "manual",
      cronJobId: options.cronJobId || null,
      conversationId,
    }
  );

  return {
    uid,
    task,
    taskId,
    options,
    conversationId,
    initialUserMessage,
    runId,
  };
}

function buildAcpTaskPrompt(systemPrompt, initialUserMessage) {
  const trimmedSystemPrompt = String(systemPrompt || "").trim();
  const trimmedUserMessage = String(initialUserMessage || "").trim();

  return [
    "你正在执行 Workhorse 的后台编排任务。",
    "请把下面的任务 system prompt 视为本次执行的最高优先级约束，并据此完成任务。",
    "如果需要工具，请按需调用；如果不需要，不要为了调用而调用。",
    "输出直接给出最终执行结果，不要解释你在模拟 system prompt。",
    "",
    "任务 system prompt：",
    trimmedSystemPrompt || "无",
    "",
    "本次运行指令：",
    trimmedUserMessage || "请开始执行当前任务。",
  ].join("\n");
}

async function executePreparedAcpTaskRun(execution) {
  const {
    uid,
    task,
    conversationId,
    initialUserMessage,
    runId,
  } = execution;
  try {
    const globalPromptMarkdown = getAppSetting(
      uid,
      "global_system_prompt_markdown",
      process.env.GLOBAL_SYSTEM_PROMPT_MD || ""
    );
    const systemPrompt = buildAgentSystemPrompt({
      uid,
      baseSystemPrompt: task.system_prompt,
      skillIds: task.skill_ids,
      globalMarkdown: globalPromptMarkdown,
    });
    updateConversationSystemPrompt(conversationId, uid, systemPrompt);

    const userPrompt = buildAcpTaskPrompt(systemPrompt, initialUserMessage);
    addMessage(conversationId, uid, "user", userPrompt, { is_hidden: 1, is_archived: 0 });
    // User visible stub
    addMessage(conversationId, uid, "user", initialUserMessage, { is_hidden: 0, is_archived: 1 });
    safeAddRunEvent(runId, uid, "turn_started", "ACP 任务开始执行", "", {
      agentId: task.acp_agent_id,
    });

    const streamChunks = [];
    const fullContent = await streamAcpConversation({
      uid,
      conversation: {
        id: conversationId,
        acp_agent_id: task.acp_agent_id,
        acp_session_id: null,
        acp_model_id: null,
      },
      conversationId: String(conversationId),
      message: userPrompt,
      images: [],
      history: [{ role: "user", content: userPrompt }],
      res: {
        write(payload) {
          streamChunks.push(String(payload));
        },
      },
      debug: false,
    });

    addMessage(conversationId, uid, "assistant", fullContent);
    safeAddRunEvent(
      runId,
      uid,
      "final_response",
      "ACP 任务返回最终结果",
      normalizeInlineText(fullContent, 500),
      {
        agentId: task.acp_agent_id,
        eventCount: streamChunks.length,
      }
    );

    updateTaskRun(runId, uid, {
      conversation_id: conversationId,
      status: "success",
      final_response: fullContent,
      finished_at: new Date().toISOString(),
    });
    safeAddRunEvent(runId, uid, "run_completed", "任务执行完成", "", {
      conversationId,
      finalResponsePreview: normalizeInlineText(fullContent, 240),
      agentId: task.acp_agent_id,
    });

    return { conversationId, finalResponse: fullContent, runId };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error || "Unknown error");
    updateTaskRun(runId, uid, {
      conversation_id: conversationId,
      status: "failed",
      error_message: errorMessage,
      finished_at: new Date().toISOString(),
    });
    safeAddRunEvent(runId, uid, "run_failed", "任务执行失败", errorMessage, {
      conversationId,
      agentId: task.acp_agent_id,
    });
    throw error;
  }
}

function formatMessageForCompaction(message) {
  const role = String(message?.role || "unknown");
  const name = String(message?.name || "").trim();
  const content = String(message?.content || "").trim();
  const prefix = name ? `${role}(${name})` : role;
  return `${prefix}: ${content}`;
}

function buildCompactionFallbackSummary(messages = []) {
  const lines = messages
    .filter((message) => String(message?.content || "").trim())
    .slice(-6)
    .map((message) => formatMessageForCompaction(message));

  if (!lines.length) {
    return "早期上下文已压缩，但未能提取出可复用摘要。请优先依赖最近几轮消息和工具结果继续执行。";
  }

  return [
    "已压缩的较早上下文要点：",
    ...lines.map((line, index) => `${index + 1}. ${line}`),
  ].join("\n");
}

async function maybeCompactTaskContext({
  client,
  modelId,
  messages,
  openaiTools,
  contextWindow,
  uid,
  conversationId,
  endpointName,
  runId,
  turn,
}) {
  const estimatedMessageTokens = estimateMessagesTokens(messages);
  const estimatedToolTokens = estimateToolSchemaTokens(openaiTools);
  const estimatedInputTokens = estimatedMessageTokens + estimatedToolTokens;
  const compactThreshold = resolveCompactionThresholdTokens(contextWindow);

  if (estimatedInputTokens < compactThreshold) {
    return {
      messages,
      compacted: false,
      estimated_input_tokens: estimatedInputTokens,
      compact_threshold: compactThreshold,
    };
  }

  const [systemMessage, ...nonSystemMessages] = messages;
  if (nonSystemMessages.length <= RECENT_MESSAGES_TO_KEEP) {
    return {
      messages,
      compacted: false,
      estimated_input_tokens: estimatedInputTokens,
      compact_threshold: compactThreshold,
    };
  }

  const recentMessages = nonSystemMessages.slice(-RECENT_MESSAGES_TO_KEEP);
  const olderMessages = nonSystemMessages.slice(0, -RECENT_MESSAGES_TO_KEEP);
  const transcript = olderMessages.map(formatMessageForCompaction).join("\n\n");
  const summarySource = truncateTextToTokenBudget(
    transcript,
    Math.max(4096, Math.floor(contextWindow * 0.2))
  );

  let summary = "";
  try {
    const summaryCompletion = await client.chat.completions.create({
      model: modelId,
      temperature: 0.2,
      max_tokens: Math.min(
        2048,
        Math.max(512, Math.floor(contextWindow * 0.04))
      ),
      messages: [
        {
          role: "system",
          content:
            "你负责压缩 Agent 的历史上下文。请输出简洁中文摘要，保留用户目标、关键约束、重要事实、已完成动作、工具结果结论、未完成事项。不要编造，不要输出 XML/JSON。",
        },
        {
          role: "user",
          content: `请压缩下面的较早上下文，供任务继续执行：\n\n${summarySource}`,
        },
      ],
    });

    summary = String(
      summaryCompletion.choices?.[0]?.message?.content || ""
    ).trim();

    if (summaryCompletion.usage) {
      logUsage({
        uid,
        conversationId,
        model: modelId,
        endpointName,
        promptTokens: summaryCompletion.usage.prompt_tokens,
        completionTokens: summaryCompletion.usage.completion_tokens,
        source: "agent_task_compact",
      });
    }
  } catch (error) {
    logger.warn(
      { err: error, uid, conversationId, runId, turn, modelId },
      "[AgentEngine] Context compaction request failed"
    );
  }

  if (!summary) {
    summary = buildCompactionFallbackSummary(olderMessages);
  }

  const compactedMessages = [
    ...(systemMessage ? [systemMessage] : []),
    {
      role: "assistant",
      content: `[CONTEXT_COMPACTED]\n以下为已压缩的较早上下文摘要，仅用于延续当前任务：\n${summary}`,
    },
    ...recentMessages,
  ];

  const compactedEstimate =
    estimateMessagesTokens(compactedMessages) +
    estimateToolSchemaTokens(openaiTools);

  safeAddRunEvent(
    runId,
    uid,
    "context_compacted",
    "触发上下文压缩",
    `估算输入 ${estimatedInputTokens} tokens，阈值 ${compactThreshold}，压缩后约 ${compactedEstimate} tokens`,
    {
      turn,
      modelId,
      contextWindow,
      estimatedInputTokens,
      compactThreshold,
      compactedEstimate,
    }
  );

  return {
    messages: compactedMessages,
    compacted: true,
    estimated_input_tokens: compactedEstimate,
    compact_threshold: compactThreshold,
  };
}

async function executePreparedTaskRun(execution) {
  if (execution.task?.acp_agent_id) {
    return executePreparedAcpTaskRun(execution);
  }

  const {
    uid,
    task,
    taskId,
    options,
    conversationId,
    initialUserMessage,
    runId,
  } = execution;

  // Gather Skills
  const globalPromptMarkdown = getAppSetting(
    uid,
    "global_system_prompt_markdown",
    process.env.GLOBAL_SYSTEM_PROMPT_MD || ""
  );

  // Build combined system prompt (task + global markdown extension + skill bundle)
  const systemPrompt = buildAgentSystemPrompt({
    uid,
    baseSystemPrompt: task.system_prompt,
    skillIds: task.skill_ids,
    globalMarkdown: globalPromptMarkdown,
  });

  // Persist combined system prompt to conversation so chat window sees it
  updateConversationSystemPrompt(conversationId, uid, systemPrompt);

  // Gather Tools
  const { requestTools, openaiTools } = await prepareAgentTooling(uid, {
    toolNames: task.tool_names,
  });

  // Initialize messages
  const messages = [{ role: "system", content: systemPrompt }];
  messages.push({ role: "user", content: initialUserMessage });
  addMessage(conversationId, uid, "user", initialUserMessage);

  const { endpoint: ep, modelId } = resolveEndpointModelPair(
    uid,
    task.model_id
  );
  if (!ep) throw new Error("No API endpoint configured");
  if (!modelId) throw new Error("No enabled model configured");
  const modelGenerationConfig =
    findModelConfigForEndpoint(ep.id, uid, modelId)?.generation_config || {};
  const contextWindow = resolveContextWindowTokens(modelGenerationConfig);
  updateConversationContextWindow(conversationId, uid, contextWindow);

  const baseUrl = ep.base_url.replace(/\/+$/, "");
  let activeClient = new OpenAI({
    apiKey: ep.api_key,
    baseURL: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
  });
  let activeEndpoint = ep;
  let activeGenerationConfig = mergeGenerationConfig(modelGenerationConfig);

  let turnCount = 0;
  let finalResponse = "";
  let finalResponsePersisted = false;
  const toolCallCounts = new Map();
  const taskConfig = getTaskConfig(uid);
  const maxTurns = Number(taskConfig?.max_turns) || DEFAULT_MAX_TURNS;
  const maxToolCallsPerSignature =
    Number(taskConfig?.max_tool_calls_per_signature) ||
    DEFAULT_MAX_TOOL_CALLS_PER_SIGNATURE;

  try {
    while (turnCount < maxTurns) {
      turnCount++;
      logger.info(
        { uid, taskId, turn: turnCount },
        "[AgentEngine] Starting turn"
      );
      safeAddRunEvent(
        runId,
        uid,
        "turn_started",
        `第 ${turnCount} 轮`,
        `开始调用模型 ${modelId}`,
        { turn: turnCount, modelId, endpointName: activeEndpoint.name }
      );

      const compactedState = await maybeCompactTaskContext({
        client: activeClient,
        modelId,
        messages,
        openaiTools,
        contextWindow,
        uid,
        conversationId,
        endpointName: activeEndpoint.name,
        runId,
        turn: turnCount,
      });
      if (compactedState.compacted) {
        messages.splice(0, messages.length, ...compactedState.messages);
      }

      const completionAttempt = await requestAgentTurnWithFallback({
        uid,
        modelCandidates: [modelId],
        messages,
        openaiTools: openaiTools.length > 0 ? openaiTools : undefined,
        stream: false,
        resolveGenerationConfig: (candidateEndpoint, candidateModelId) =>
          mergeGenerationConfig(
            findModelConfigForEndpoint(
              candidateEndpoint.id,
              uid,
              candidateModelId
            )?.generation_config || {}
          ),
        getErrorMessage: (error) =>
          error instanceof Error
            ? error.message
            : String(error || "Unknown error"),
      });

      if (!completionAttempt.ok) {
        throw (
          completionAttempt.lastError ||
          new Error("All candidate endpoints failed")
        );
      }

      const {
        completion,
        client: completionClient,
        endpoint: completionEndpoint,
        endpointGenerationConfig,
      } = completionAttempt;
      activeClient = completionClient;
      activeEndpoint = completionEndpoint;
      activeGenerationConfig = endpointGenerationConfig;

      const aiMsg = completion.choices[0].message;
      messages.push(aiMsg);

      // Save tokens usage
      logUsage({
        uid,
        conversationId,
        model: modelId,
        endpointName: completionEndpoint.name,
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        source: "agent_task",
      });

      if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
        // Save AI msg with tool calls
        addMessage(
          conversationId,
          uid,
          "assistant",
          `[TOOL_CALLS]:${JSON.stringify(aiMsg.tool_calls)}`
        );
        safeAddRunEvent(
          runId,
          uid,
          "tool_calls_requested",
          "模型请求调用工具",
          aiMsg.tool_calls.map((toolCall) => toolCall.function.name).join(", "),
          {
            turn: turnCount,
            toolCalls: aiMsg.tool_calls.map((toolCall) => ({
              id: toolCall.id,
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            })),
          }
        );

        let shouldForceSummary = false;

        for (const toolCall of aiMsg.tool_calls) {
          const budgetState = registerToolCall(
            toolCallCounts,
            toolCall,
            maxToolCallsPerSignature
          );
          if (budgetState.overBudget) {
            const budgetMsg = `Skipped duplicate tool call for ${toolCall.function.name}: identical input exceeded budget (${maxToolCallsPerSignature}). Use previous tool results and provide the final answer.`;
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: budgetMsg,
            });
            addMessage(
              conversationId,
              uid,
              "tool",
              `[TOOL_RESULT:${toolCall.id}:${toolCall.function.name}]:${budgetMsg}`
            );
            safeAddRunEvent(
              runId,
              uid,
              "tool_budget_hit",
              `${toolCall.function.name} 命中重复预算`,
              budgetMsg,
              {
                turn: turnCount,
                signature: budgetState.signature,
                repeatCount: budgetState.count,
              }
            );
            shouldForceSummary = true;
            continue;
          }

          const toolExecution = await executeAgentToolCall({
            uid,
            requestTools,
            toolCall,
            executionScope: {
              uid,
              conversationId,
              runId,
              taskId,
            },
          });

          if (toolExecution.ok) {
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: toolExecution.resultText,
            });

            addMessage(
              conversationId,
              uid,
              "tool",
              `[TOOL_RESULT:${toolCall.id}:${toolCall.function.name}]:${toolExecution.resultText}`
            );
            safeAddRunEvent(
              runId,
              uid,
              "tool_completed",
              `${toolCall.function.name} 执行完成`,
              normalizeInlineText(toolExecution.resultText, 500),
              { turn: turnCount, arguments: toolExecution.args || {} }
            );
            continue;
          }

          const errMsg = toolExecution.errorMessage;
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: errMsg,
          });
          addMessage(
            conversationId,
            uid,
            "tool",
            `[TOOL_RESULT:${toolCall.id}:${toolCall.function.name}]:${errMsg}`
          );
          safeAddRunEvent(
            runId,
            uid,
            "tool_failed",
            `${toolCall.function.name} 执行失败`,
            errMsg,
            { turn: turnCount }
          );
        }

        if (shouldForceSummary) {
          finalResponse = await requestForcedFinalResponse({
            client: activeClient,
            modelId,
            messages,
            uid,
            conversationId,
            endpointName: activeEndpoint.name,
            reason: `检测到重复工具调用，单工具同参预算为 ${maxToolCallsPerSignature} 次。`,
            runId,
            generationConfig: mergeGenerationConfig(activeGenerationConfig, {
              max_tokens: 2048,
            }),
          });
          addMessage(conversationId, uid, "assistant", finalResponse);
          safeAddRunEvent(
            runId,
            uid,
            "final_response",
            "生成最终总结",
            normalizeInlineText(finalResponse, 500)
          );
          finalResponsePersisted = true;
          break;
        }
      } else {
        // No tool calls, finish
        finalResponse = String(aiMsg.content || "");
        addMessage(conversationId, uid, "assistant", finalResponse);
        safeAddRunEvent(
          runId,
          uid,
          "final_response",
          "生成最终总结",
          normalizeInlineText(finalResponse, 500)
        );
        finalResponsePersisted = true;
        break;
      }
    }

    if (!finalResponsePersisted) {
      finalResponse = await requestForcedFinalResponse({
        client: activeClient,
        modelId,
        messages,
        uid,
        conversationId,
        endpointName: activeEndpoint.name,
        reason: `已达到最大执行轮数 ${maxTurns}，停止继续调用工具。`,
        runId,
        generationConfig: mergeGenerationConfig(activeGenerationConfig, {
          max_tokens: 2048,
        }),
      }).catch((error) => {
        logger.error(
          { err: error, uid, conversationId, taskId },
          "[AgentEngine] Failed to force final summary"
        );
        return "⚠️ 任务已停止，但最终总结生成失败。请打开会话查看最近一次工具结果。";
      });

      addMessage(conversationId, uid, "assistant", finalResponse);
      safeAddRunEvent(
        runId,
        uid,
        "final_response",
        "生成最终总结",
        normalizeInlineText(finalResponse, 500)
      );
    }

    updateTaskRun(runId, uid, {
      conversation_id: conversationId,
      status: "success",
      final_response: finalResponse,
      finished_at: new Date().toISOString(),
    });
    safeAddRunEvent(runId, uid, "run_completed", "任务执行完成", "", {
      conversationId,
      finalResponsePreview: normalizeInlineText(finalResponse, 240),
    });

    return { conversationId, finalResponse, runId };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error || "Unknown error");
    updateTaskRun(runId, uid, {
      conversation_id: conversationId,
      status: "failed",
      error_message: errorMessage,
      finished_at: new Date().toISOString(),
    });
    safeAddRunEvent(runId, uid, "run_failed", "任务执行失败", errorMessage, {
      conversationId,
    });
    throw error;
  }
}

/**
 * Executes an AgentTask and waits for completion.
 * @param {string} uid
 * @param {number} taskId
 * @param {object} options
 */
export async function runAgentTask(uid, taskId, options = {}) {
  const execution = prepareTaskRunExecution(uid, taskId, options);
  return executePreparedTaskRun(execution);
}

export async function startAgentTaskRun(uid, taskId, options = {}) {
  const execution = prepareTaskRunExecution(uid, taskId, options);

  setTimeout(() => {
    executePreparedTaskRun(execution).catch((error) => {
      logger.error(
        {
          err: error,
          uid,
          taskId,
          runId: execution.runId,
          conversationId: execution.conversationId,
        },
        "[AgentEngine] Background task run failed"
      );
    });
  }, 0);

  return {
    runId: execution.runId,
    conversationId: execution.conversationId,
    status: "running",
  };
}
