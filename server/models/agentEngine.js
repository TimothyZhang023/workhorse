import OpenAI from "openai";
import { logger } from "../utils/logger.js";
import {
  addMessage,
  createConversation,
  getAgentTask,
  getEndpointGroups,
  getModels,
  listSkills,
  logUsage,
  updateConversationSystemPrompt,
} from "./database.js";
import { executeMcpTool, getAllAvailableTools } from "./mcpManager.js";

const MAX_TURNS = 10;

/**
 * Executes an AgentTask.
 * @param {string} uid - User ID
 * @param {number} taskId - ID of the AgentTask to run
 * @param {object} options - Execution options (e.g. initialUserMessage)
 */
export async function runAgentTask(uid, taskId, options = {}) {
  const task = getAgentTask(taskId, uid);
  if (!task) throw new Error("AgentTask not found");

  // Create a dedicated conversation for this run if not provided
  let conversationId = options.conversationId;
  if (!conversationId) {
    const conv = createConversation(
      uid,
      `Run: ${task.name} at ${new Date().toLocaleString()}`
    );
    conversationId = conv.id;
  }

  // Gather Skills
  const allSkills = listSkills(uid);
  const taskSkills = allSkills.filter((s) => task.skill_ids.includes(s.id));

  // Build combined system prompt
  let systemPrompt = task.system_prompt;
  if (taskSkills.length > 0) {
    systemPrompt += "\n\n### Skills & Guidelines:\n";
    taskSkills.forEach((s) => {
      systemPrompt += `\n- **${s.name}**: ${s.prompt}`;
      if (s.examples && s.examples.length > 0) {
        systemPrompt += `\nExamples:\n${JSON.stringify(s.examples, null, 2)}`;
      }
    });
  }

  // Persist combined system prompt to conversation so chat window sees it
  updateConversationSystemPrompt(conversationId, uid, systemPrompt);

  // Gather Tools
  const mcpTools = await getAllAvailableTools(uid).catch(() => []);
  // Filter tools: include MCP tools if they match task.tool_names OR if a Skill requires them
  const skillRequiredTools = taskSkills.flatMap((s) => s.tools || []);
  const allowedToolNames = new Set([
    ...(task.tool_names || []),
    ...skillRequiredTools,
  ]);

  const requestTools = mcpTools.filter((t) =>
    allowedToolNames.has(t.function.name)
  );
  // Strip internal _mcp_server_id for OpenAI
  const openaiTools = requestTools.map(({ _mcp_server_id, ...t }) => t);

  // Initialize messages
  const messages = [{ role: "system", content: systemPrompt }];
  if (options.initialUserMessage) {
    messages.push({ role: "user", content: options.initialUserMessage });
    addMessage(conversationId, uid, "user", options.initialUserMessage);
  }

  // Get Endpoints
  const eps = getEndpointGroups(uid).sort(
    (a, b) => b.is_default - a.is_default
  );
  if (eps.length === 0) throw new Error("No API endpoint configured");

  const ep = eps[0]; // For background tasks, just use default for simplicity
  const modelModels = getModels(ep.id, uid);
  const modelId =
    task.model_id ||
    (modelModels.length > 0 ? modelModels[0].model_id : "gpt-4o");

  const baseUrl = ep.base_url.replace(/\/+$/, "");
  const client = new OpenAI({
    apiKey: ep.api_key,
    baseURL: baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`,
  });

  let turnCount = 0;
  let finalResponse = "";

  while (turnCount < MAX_TURNS) {
    turnCount++;
    logger.info(
      { uid, taskId, turn: turnCount },
      "[AgentEngine] Starting turn"
    );

    const completion = await client.chat.completions.create({
      model: modelId,
      messages: messages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
    });

    const aiMsg = completion.choices[0].message;
    messages.push(aiMsg);

    // Save tokens usage
    logUsage({
      uid,
      conversationId,
      model: modelId,
      endpointName: ep.name,
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

      for (const toolCall of aiMsg.tool_calls) {
        const toolDef = requestTools.find(
          (t) => t.function.name === toolCall.function.name
        );
        if (!toolDef) {
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: "Error: Tool not found or access denied.",
          });
          continue;
        }

        try {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await executeMcpTool(
            uid,
            toolDef._mcp_server_id,
            toolCall.function.name,
            args
          );

          const resultStr =
            (result.content || [])
              .map((c) =>
                typeof c.text === "string" ? c.text : JSON.stringify(c)
              )
              .join("\n") || JSON.stringify(result);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: resultStr,
          });

          // Save tool result
          addMessage(
            conversationId,
            uid,
            "tool",
            `[TOOL_RESULT:${toolCall.id}:${toolCall.function.name}]:${resultStr}`
          );
        } catch (e) {
          const errMsg = `Tool execution failed: ${e.message}`;
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: errMsg,
          });
          addMessage(
            conversationId,
            uid,
            "tool",
            `[TOOL_RESULT:${toolCall.id}:${toolCall.function.name}]:${errMsg}`
          );
        }
      }
    } else {
      // No tool calls, finish
      finalResponse = aiMsg.content;
      addMessage(conversationId, uid, "assistant", finalResponse);
      break;
    }
  }

  return { conversationId, finalResponse };
}
