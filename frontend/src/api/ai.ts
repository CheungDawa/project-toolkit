import { api } from './client'

export interface AiStatus {
  configured: boolean
  config: {
    provider: string
    base_url: string
    model: string
    api_key_masked: string
    timeout: number
  } | null
}

export interface AiConversation {
  id: string
  project_id: string | null
  title: string | null
  created_at: string
}

export interface AiMessage {
  id: string
  conversation_id: string
  role: string
  content: string
  call_status: string
  model_identifier: string | null
  context_digest: Record<string, unknown> | null
  token_usage: number | null
  error_message: string | null
  created_at: string
}

export interface AiProposal {
  id: string
  project_id: string
  action_type: string
  payload: Record<string, unknown>
  diff_preview: { add?: unknown[]; modify?: unknown[]; delete?: unknown[] } | null
  status: string
  created_at: string
}

export const getAiStatus = () => api.get<AiStatus>('/ai/status')
export const updateModelConfig = (value: Record<string, unknown>) =>
  api.put<{ key: string; value: unknown }>('/settings/model.default', { value })

export const testModelConnection = (value: Record<string, unknown>) =>
  api.post<{ ok: boolean; message?: string; code?: string }>('/ai/test', { value })

export const listAiConversations = (projectId?: string) =>
  api.get<AiConversation[]>(`/ai/conversations${projectId ? `?project_id=${projectId}` : ''}`)

export const createConversation = (payload: { project_id?: string | null; title?: string }) =>
  api.post<AiConversation>('/ai/conversations', payload)

export const listMessages = (conversationId: string) =>
  api.get<AiMessage[]>(`/ai/conversations/${conversationId}/messages`)

export const sendChat = (conversationId: string, content: string) =>
  api.post<AiMessage>(`/ai/conversations/${conversationId}/messages`, { content })

export const listProposals = (projectId?: string, status?: string) =>
  api.get<AiProposal[]>(`/ai/proposals${projectId ? `?project_id=${projectId}` : ''}${status ? `&status=${status}` : ''}`)

export const acceptProposal = (id: string, confirm = false) =>
  api.post<AiProposal>(`/ai/proposals/${id}/accept`, { confirm })

export const rejectProposal = (id: string) => api.post<AiProposal>(`/ai/proposals/${id}/reject`)

export const wbsDraft = (projectId: string, description?: string) =>
  api.post<AiProposal>(`/ai/projects/${projectId}/wbs-draft`, { description })

export const scheduleCheck = (projectId: string) =>
  api.post<{ content: string; model: string; usage: number }>(`/ai/projects/${projectId}/schedule-check`, {})

export const riskAdvice = (projectId: string) =>
  api.post<{ content: string; model: string; usage: number }>(`/ai/projects/${projectId}/risk-advice`, {})

export const weeklyReport = (projectId: string) =>
  api.post<{ content: string; meta: string; model: string; usage: number }>(`/ai/projects/${projectId}/weekly-report`, {})

export const askAi = (projectId: string, content: string) =>
  api.post<{ content: string; model: string; usage: number }>(`/ai/projects/${projectId}/ask`, { content })