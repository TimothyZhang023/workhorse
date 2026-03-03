import { request } from '@umijs/max';

// Auth
export async function login(body: API.LoginParams) {
  return request<API.LoginResult>('/api/auth/login', {
    method: 'POST',
    data: body,
  });
}

export async function register(body: API.LoginParams) {
  return request<API.LoginResult>('/api/auth/register', {
    method: 'POST',
    data: body,
  });
}

export async function getCurrentUser() {
  return request<API.CurrentUser>('/api/auth/me', {
    method: 'GET',
  });
}

export async function logout() {
  return request('/api/auth/logout', {
    method: 'POST',
  });
}

// Conversations
export async function getConversations() {
  return request<API.Conversation[]>('/api/conversations', {
    method: 'GET',
  });
}

export async function createConversation(title: string) {
  return request<API.Conversation>('/api/conversations', {
    method: 'POST',
    data: { title },
  });
}

export async function deleteConversation(id: string) {
  return request(`/api/conversations/${id}`, {
    method: 'DELETE',
  });
}

export async function updateConversation(id: string, title?: string, systemPrompt?: string) {
  return request(`/api/conversations/${id}`, {
    method: 'PUT',
    data: {
      ...(title !== undefined && { title }),
      ...(systemPrompt !== undefined && { system_prompt: systemPrompt }),
    },
  });
}

export async function regenerateMessage(conversationId: string, model: string) {
  return request(`/api/conversations/${conversationId}/regenerate`, {
    method: 'POST',
    data: { model },
  });
}

export async function summarizeConversationTitle(conversationId: string, model?: string) {
  return request(`/api/conversations/${conversationId}/summarize-title`, {
    method: 'POST',
    data: { model },
  });
}


export async function getMessages(conversationId: string) {
  return request<API.Message[]>(`/api/conversations/${conversationId}/messages`, {
    method: 'GET',
  });
}

// Chat stream is handled differently due to SSE, but we can have a helper if needed.
// Usually handled directly in component for stream reading.

// Endpoints & Models
export async function getEndpoints() {
  return request<API.Endpoint[]>('/api/endpoints', {
    method: 'GET',
  });
}

export async function createEndpoint(data: Partial<API.Endpoint>) {
  return request('/api/endpoints', {
    method: 'POST',
    data,
  });
}

export async function updateEndpoint(id: number, data: Partial<API.Endpoint>) {
  return request(`/api/endpoints/${id}`, {
    method: 'PUT',
    data,
  });
}

export async function deleteEndpoint(id: number) {
  return request(`/api/endpoints/${id}`, {
    method: 'DELETE',
  });
}

export async function setDefaultEndpoint(id: number) {
  return request(`/api/endpoints/${id}/default`, {
    method: 'PUT',
  });
}

export async function getEndpointModels(endpointId: number) {
  return request<API.Model[]>(`/api/endpoints/${endpointId}/models`, {
    method: 'GET',
  });
}

export async function addModelToEndpoint(endpointId: number, data: API.Model) {
  return request(`/api/endpoints/${endpointId}/models`, {
    method: 'POST',
    data,
  });
}

export async function deleteModelFromEndpoint(id: number) {
  return request(`/api/endpoints/models/${id}`, {
    method: 'DELETE',
  });
}

export async function getAvailableModels() {
  return request<API.Model[]>('/api/endpoints/available/models', {
    method: 'GET',
  });
}

// Admin
export async function getAllUsers() {
  return request<any[]>('/api/admin/users', {
    method: 'GET',
  });
}

export async function updateUserRole(uid: string, role: string) {
  return request(`/api/admin/users/${uid}/role`, {
    method: 'PUT',
    data: { role },
  });
}

export async function deleteUser(uid: string) {
  return request(`/api/admin/users/${uid}`, {
    method: 'DELETE',
  });
}
