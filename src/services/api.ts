import { request } from "./request";

// Auth
export async function login(body: API.LoginParams) {
  return request<API.LoginResult>("/api/auth/login", {
    method: "POST",
    data: body,
  });
}

export async function register(body: API.LoginParams) {
  return request<API.LoginResult>("/api/auth/register", {
    method: "POST",
    data: body,
  });
}

export async function getCurrentUser() {
  return request<API.CurrentUser>("/api/auth/me", {
    method: "GET",
  });
}

export async function logout() {
  return request("/api/auth/logout", {
    method: "POST",
  });
}

// Conversations
export async function getConversations() {
  return request<API.Conversation[]>("/api/conversations", {
    method: "GET",
  });
}

export async function createConversation(
  title: string,
  options?: {
    context_window?: number | null;
    channel_id?: number | null;
    acp_agent_id?: number | null;
    acp_model_id?: string | null;
    system_prompt?: string | null;
  }
) {
  return request<API.Conversation>("/api/conversations", {
    method: "POST",
    data: {
      title,
      ...(options?.context_window !== undefined && {
        context_window: options.context_window,
      }),
      ...(options?.channel_id !== undefined && {
        channel_id: options.channel_id,
      }),
      ...(options?.acp_agent_id !== undefined && {
        acp_agent_id: options.acp_agent_id,
      }),
      ...(options?.acp_model_id !== undefined && {
        acp_model_id: options.acp_model_id,
      }),
      ...(options?.system_prompt !== undefined && {
        system_prompt: options.system_prompt,
      }),
    },
  });
}

export async function deleteConversation(id: string) {
  return request(`/api/conversations/${id}`, {
    method: "DELETE",
  });
}

export async function updateConversation(
  id: string,
  title?: string,
  systemPrompt?: string,
  toolNames?: string[] | null,
  contextWindow?: number | null,
  acpModelId?: string | null
) {
  return request(`/api/conversations/${id}`, {
    method: "PUT",
    data: {
      ...(title !== undefined && { title }),
      ...(systemPrompt !== undefined && { system_prompt: systemPrompt }),
      ...(toolNames !== undefined && { tool_names: toolNames }),
      ...(contextWindow !== undefined && { context_window: contextWindow }),
      ...(acpModelId !== undefined && { acp_model_id: acpModelId }),
    },
  });
}

export async function getConversationAcpModels(id: string) {
  return request<API.AcpConversationModels>(
    `/api/conversations/${id}/acp-models`,
    {
      method: "GET",
    }
  );
}

export async function setConversationAcpModel(id: string, modelId: string) {
  return request<API.AcpConversationModels>(
    `/api/conversations/${id}/acp-model`,
    {
      method: "POST",
      data: {
        model_id: modelId,
      },
    }
  );
}

export async function regenerateMessage(conversationId: string, model?: string) {
  return request(`/api/conversations/${conversationId}/regenerate`, {
    method: "POST",
    data: { model },
  });
}

export async function editMessage(
  conversationId: string,
  msgId: number,
  content: string,
  model?: string
) {
  return request(`/api/conversations/${conversationId}/messages/${msgId}`, {
    method: "PUT",
    data: { content, model },
  });
}

export async function summarizeConversationTitle(
  conversationId: string,
  model?: string
) {
  return request(`/api/conversations/${conversationId}/summarize-title`, {
    method: "POST",
    data: { model },
  });
}

export async function getMessages(conversationId: string) {
  return request<API.Message[]>(
    `/api/conversations/${conversationId}/messages`,
    {
      method: "GET",
    }
  );
}

export async function stopConversationExecution(conversationId: string) {
  return request<{ success: boolean; stopped: boolean; killed_commands?: number }>(
    `/api/conversations/${conversationId}/stop`,
    {
      method: "POST",
    }
  );
}

export async function getConversationContextBudget(conversationId: string) {
  return request<API.ConversationContextBudget>(
    `/api/conversations/${conversationId}/context-budget`,
    {
      method: "GET",
    }
  );
}

export async function compactConversation(conversationId: string) {
  return request<{
    success: boolean;
    compacted: boolean;
    compacted_messages?: number;
    budget: API.ConversationContextBudget;
  }>(`/api/conversations/${conversationId}/compact`, {
    method: "POST",
  });
}

// Channels
export async function getChannels() {
  return request<API.Channel[]>("/api/channels", {
    method: "GET",
  });
}

export async function getChannelExtensions() {
  return request<API.ChannelExtension[]>("/api/channels/extensions", {
    method: "GET",
  });
}

export async function createChannel(data: Partial<API.Channel>) {
  return request<API.Channel>("/api/channels", {
    method: "POST",
    data,
  });
}

export async function updateChannelAgent(id: number, data: Partial<API.Channel>) {
  return request(`/api/channels/${id}`, {
    method: "PUT",
    data,
  });
}

export async function deleteChannelAgent(id: number) {
  return request(`/api/channels/${id}`, {
    method: "DELETE",
  });
}

export async function getAcpAgentTemplates() {
  return request<API.AcpAgentTemplate[]>("/api/acp-agents/templates", {
    method: "GET",
  });
}

export async function getAcpAgents() {
  return request<API.AcpAgent[]>("/api/acp-agents", {
    method: "GET",
  });
}

export async function createAcpAgent(data: {
  name: string;
  preset: API.AcpAgent["preset"];
  command?: string;
  api_key?: string;
  agent_prompt?: string;
  default_model_id?: string;
}) {
  return request<API.AcpAgent>("/api/acp-agents", {
    method: "POST",
    data,
  });
}

export async function updateAcpAgent(
  id: number,
  data: Partial<API.AcpAgent> & { agent_prompt?: string }
) {
  return request<API.AcpAgent>(`/api/acp-agents/${id}`, {
    method: "PUT",
    data,
  });
}

export async function deleteAcpAgent(id: number) {
  return request(`/api/acp-agents/${id}`, {
    method: "DELETE",
  });
}

// Chat stream is handled differently due to SSE, but we can have a helper if needed.
// Usually handled directly in component for stream reading.

// MCP Servers
export async function getMcpServers() {
  return request<any[]>("/api/mcp", {
    method: "GET",
  });
}

export async function getMcpTools() {
  return request<API.McpTool[]>("/api/mcp/tools", {
    method: "GET",
  });
}

export async function getDefaultMcpTemplates() {
  return request<API.DefaultMcpTemplate[]>("/api/mcp/defaults", {
    method: "GET",
  });
}

export async function searchMarketMcp(query: string) {
  return request<API.MarketMcpServer[]>("/api/mcp/market", {
    method: "GET",
    params: { query },
  });
}

export async function createMcpServer(data: any) {
  return request("/api/mcp", {
    method: "POST",
    data,
  });
}

export async function importDefaultMcpTemplate(templateId: string) {
  return request<{ template: API.DefaultMcpTemplate; server: API.McpServer }>(
    `/api/mcp/defaults/${templateId}/import`,
    {
      method: "POST",
    }
  );
}

export async function generateMcpDraft(data: API.McpGenerationRequest) {
  return request<API.McpGenerationResult>("/api/mcp/generate", {
    method: "POST",
    data,
  });
}

export async function generateDraftFromMarketMcp(data: {
  server_name: string;
  auto_create?: boolean;
}) {
  return request<{ draft: Partial<API.McpServer>; server?: API.McpServer }>(
    "/api/mcp/market/generate",
    {
      method: "POST",
      data,
    }
  );
}

export async function updateMcpServer(id: number, data: any) {
  return request(`/api/mcp/${id}`, {
    method: "PUT",
    data,
  });
}

export async function batchUpdateMcpServers(data: {
  server_ids: number[];
  is_enabled: 0 | 1;
}) {
  return request<{ success: boolean; updated: number }>(
    "/api/mcp/batch/enabled",
    {
      method: "PUT",
      data,
    }
  );
}

export async function deleteMcpServer(id: number) {
  return request(`/api/mcp/${id}`, {
    method: "DELETE",
  });
}

export async function batchDeleteMcpServers(serverIds: number[]) {
  return request<{ success: boolean; deleted: number }>("/api/mcp/batch", {
    method: "DELETE",
    data: { server_ids: serverIds },
  });
}

export async function exportMcpInstallShare(id: number) {
  return request<API.InstallShare>(`/api/install-share/mcp/${id}`, {
    method: "GET",
  });
}

export async function testMcpServerConnection(id: number) {
  return request<API.McpTestResult>(`/api/mcp/${id}/test`, {
    method: "POST",
  });
}

// Endpoints & Models
export async function getEndpoints() {
  return request<API.Endpoint[]>("/api/endpoints", {
    method: "GET",
  });
}

export async function createEndpoint(data: Partial<API.Endpoint>) {
  return request("/api/endpoints", {
    method: "POST",
    data,
  });
}

export async function updateEndpoint(id: number, data: Partial<API.Endpoint>) {
  return request(`/api/endpoints/${id}`, {
    method: "PUT",
    data,
  });
}

export async function deleteEndpoint(id: number) {
  return request(`/api/endpoints/${id}`, {
    method: "DELETE",
  });
}

export async function setDefaultEndpoint(id: number) {
  return request(`/api/endpoints/${id}/default`, {
    method: "PUT",
  });
}

export async function getEndpointModels(endpointId: number) {
  return request<API.Model[]>(`/api/endpoints/${endpointId}/models`, {
    method: "GET",
  });
}

export async function syncEndpointModels(endpointId: number) {
  return request<{ success: boolean; count: number; models: API.Model[] }>(
    `/api/endpoints/${endpointId}/models/sync`,
    {
      method: "POST",
    }
  );
}

export async function addModelToEndpoint(endpointId: number, data: API.Model) {
  return request(`/api/endpoints/${endpointId}/models`, {
    method: "POST",
    data,
  });
}

export async function updateEndpointModel(
  id: number,
  data: Partial<API.Model>
) {
  return request(`/api/endpoints/models/${id}`, {
    method: "PUT",
    data,
  });
}

export async function batchUpdateEndpointModels(
  endpointId: number,
  data: { model_ids: number[]; is_enabled: 0 | 1 }
) {
  return request<{ success: boolean; updated: number }>(
    `/api/endpoints/${endpointId}/models/batch`,
    {
      method: "PUT",
      data,
    }
  );
}

export async function deleteModelFromEndpoint(id: number) {
  return request(`/api/endpoints/models/${id}`, {
    method: "DELETE",
  });
}

export async function getAvailableModels() {
  return request<API.Model[]>("/api/endpoints/available/models", {
    method: "GET",
  });
}

export async function getGlobalModelPolicy() {
  return request<API.GlobalModelPolicy>("/api/endpoints/settings/model-policy", {
    method: "GET",
  });
}

export async function exportEndpointModelConfig() {
  return request<API.EndpointModelConfigExport>("/api/endpoints/export-config", {
    method: "GET",
  });
}

export async function importEndpointModelConfig(
  payload: API.EndpointModelConfigExport
) {
  return request("/api/endpoints/import-config", {
    method: "POST",
    data: payload,
  });
}

export async function updateGlobalModelPolicy(data: API.GlobalModelPolicy) {
  return request<API.GlobalModelPolicy>("/api/endpoints/settings/model-policy", {
    method: "PUT",
    data,
  });
}

// Clear All History
export async function clearAllHistory() {
  return request<{
    success: boolean;
    deleted_conversations: number;
    deleted_messages: number;
    deleted_usage_logs: number;
  }>("/api/system/history", {
    method: "DELETE",
  });
}

export async function getGlobalSystemPromptSetting() {
  return request<API.GlobalSystemPromptSetting>(
    "/api/system/settings/global-system-prompt",
    {
      method: "GET",
    }
  );
}

export async function getMainAgentPromptSetting() {
  return request<API.GlobalSystemPromptSetting>(
    "/api/system/settings/main-agent-prompt",
    {
      method: "GET",
    }
  );
}

export async function updateMainAgentPromptSetting(markdown: string) {
  return request<{ success: boolean; key: string; value: string }>(
    "/api/system/settings/main-agent-prompt",
    {
      method: "PUT",
      data: { markdown },
    }
  );
}

export async function updateGlobalSystemPromptSetting(markdown: string) {
  return request<{ success: boolean; key: string; value: string }>(
    "/api/system/settings/global-system-prompt",
    {
      method: "PUT",
      data: { markdown },
    }
  );
}

// Skills
export async function getSkills() {
  return request<API.Skill[]>("/api/skills", {
    method: "GET",
  });
}

export async function createSkill(data: Partial<API.Skill>) {
  return request<API.Skill>("/api/skills", {
    method: "POST",
    data,
  });
}

export async function generateSkillDraft(data: API.SkillGenerationRequest) {
  return request<API.SkillGenerationResult>("/api/skills/generate", {
    method: "POST",
    data,
  });
}

export async function installSkillFromGitRepository(repoUrl: string) {
  return request<API.SkillInstallResult>("/api/skills/install/git", {
    method: "POST",
    data: {
      repo_url: repoUrl,
    },
    timeout: 60000,
  });
}

export async function installSkillFromZipArchive(
  fileName: string,
  zipBase64: string
) {
  return request<API.SkillInstallResult>("/api/skills/install/zip", {
    method: "POST",
    data: {
      file_name: fileName,
      zip_base64: zipBase64,
    },
    timeout: 60000,
  });
}

export async function exportSkillInstallShare(id: number) {
  return request<API.InstallShare>(`/api/install-share/skills/${id}`, {
    method: "GET",
  });
}

export async function importInstallShare(bundle: string) {
  return request<API.InstallShareImportResult>("/api/install-share/import", {
    method: "POST",
    data: { bundle },
  });
}

export async function updateSkill(id: number, data: Partial<API.Skill>) {
  return request(`/api/skills/${id}`, {
    method: "PUT",
    data,
  });
}

export async function batchUpdateSkills(data: {
  skill_ids: number[];
  is_enabled: 0 | 1;
}) {
  return request<{ success: boolean; updated: number }>(
    "/api/skills/batch/enabled",
    {
      method: "PUT",
      data,
    }
  );
}

export async function deleteSkill(id: number) {
  return request(`/api/skills/${id}`, {
    method: "DELETE",
  });
}

export async function batchDeleteSkills(skillIds: number[]) {
  return request<{ success: boolean; deleted: number }>("/api/skills/batch", {
    method: "DELETE",
    data: { skill_ids: skillIds },
  });
}

// Agent Tasks
export async function getAgentTasks() {
  return request<API.AgentTask[]>("/api/agent-tasks", {
    method: "GET",
  });
}

export async function createAgentTask(data: Partial<API.AgentTask>) {
  return request<API.AgentTask>("/api/agent-tasks", {
    method: "POST",
    data,
  });
}

export async function generateAgentTask(data: API.AgentTaskGenerationRequest) {
  return request<API.AgentTaskGenerationResult>("/api/agent-tasks/generate", {
    method: "POST",
    data,
  });
}

export async function updateAgentTask(
  id: number,
  data: Partial<API.AgentTask>
) {
  return request(`/api/agent-tasks/${id}`, {
    method: "PUT",
    data,
  });
}

export async function deleteAgentTask(id: number) {
  return request(`/api/agent-tasks/${id}`, {
    method: "DELETE",
  });
}

export async function runAgentTask(id: number, message?: string) {
  return request<API.TaskRunStartResult>(`/api/agent-tasks/${id}/run`, {
    method: "POST",
    data: { message },
  });
}

export async function getTaskRuns(taskId?: number, limit = 20) {
  return request<API.TaskRun[]>("/api/agent-tasks/runs", {
    method: "GET",
    params: {
      ...(taskId ? { taskId } : {}),
      limit,
    },
  });
}

export async function getTaskRunEvents(runId: number) {
  return request<API.TaskRunEvent[]>(`/api/agent-tasks/runs/${runId}/events`, {
    method: "GET",
  });
}

// Cron Jobs
export async function getCronJobs() {
  return request<API.CronJob[]>("/api/cron-jobs", {
    method: "GET",
  });
}

export async function getCronRunHistory(cronJobId?: number, limit = 30) {
  return request<API.TaskRun[]>("/api/cron-jobs/history", {
    method: "GET",
    params: {
      ...(cronJobId ? { cronJobId } : {}),
      limit,
    },
  });
}

export async function createCronJob(data: Partial<API.CronJob>) {
  return request<API.CronJob>("/api/cron-jobs", {
    method: "POST",
    data,
  });
}

export async function updateCronJob(id: number, data: Partial<API.CronJob>) {
  return request(`/api/cron-jobs/${id}`, {
    method: "PUT",
    data,
  });
}

export async function deleteCronJob(id: number) {
  return request(`/api/cron-jobs/${id}`, {
    method: "DELETE",
  });
}

// Admin
export async function getAllUsers() {
  return request<any[]>("/api/admin/users", {
    method: "GET",
  });
}

export async function updateUserRole(uid: string, role: string) {
  return request(`/api/admin/users/${uid}/role`, {
    method: "PUT",
    data: { role },
  });
}

export async function deleteUser(uid: string) {
  return request(`/api/admin/users/${uid}`, {
    method: "DELETE",
  });
}
