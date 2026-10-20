import { api } from './client'

export interface RiskItem {
  id: string
  project_id: string
  category: string | null
  description: string
  probability: number
  impact: number
  score: number
  level: string | null
  owner: string | null
  trigger_condition: string | null
  prevention: string | null
  contingency: string | null
  strategy: string | null
  residual_level: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface RiskAssessment {
  id: string
  risk_id: string
  probability: number
  impact: number
  score: number
  level: string | null
  assessed_at: string
  basis: string | null
}

export interface IssueItem {
  id: string
  project_id: string
  risk_id: string | null
  title: string
  detail: string | null
  severity: string | null
  owner: string | null
  due_date: string | null
  root_cause: string | null
  solution: string | null
  verified_at: string | null
  verified_by: string | null
  closure_result: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface ChangeItem {
  id: string
  project_id: string
  title: string
  origin: string | null
  scope_impact: string | null
  schedule_impact: string | null
  approval_status: string
  implementation_plan: string | null
  verification_result: string | null
  requested_by: string | null
  created_at: string
  updated_at: string
}

export interface StakeholderItem {
  id: string
  project_id: string
  person_type: string
  name: string
  org: string | null
  role: string | null
  influence: number
  interest: number
  demands: string | null
  strategy: string | null
  comm_frequency: string | null
  contact_phone: string | null
  contact_wechat: string | null
  contact_email: string | null
  priority: string | null
  participation: string | null
  sub_pos: string | null
  created_at: string
}

export interface CommunicationItem {
  id: string
  stakeholder_id: string
  comm_date: string | null
  channel: string | null
  content: string | null
  conclusion: string | null
  follow_up_action: string | null
  follow_up_date: string | null
  created_at: string
}

export interface AuditLogItem {
  id: string
  project_id: string | null
  object_type: string
  object_id: string | null
  action: string
  summary: string
  payload_diff: Record<string, unknown> | null
  operator: string
  occurred_at: string
}

export const listRisks = (projectId: string, params: Record<string, unknown> = {}) =>
  api.get<RiskItem[]>(`/projects/${projectId}/risks${qs(params)}`)

export const createRisk = (projectId: string, payload: Record<string, unknown>) =>
  api.post<RiskItem>(`/projects/${projectId}/risks`, payload)

export const updateRisk = (id: string, payload: Record<string, unknown>) =>
  api.patch<RiskItem>(`/risks/${id}`, payload)

export const archiveRisk = (id: string) => api.delete(`/risks/${id}`)

export const listAssessments = (riskId: string) =>
  api.get<RiskAssessment[]>(`/risks/${riskId}/assessments`)
export const addAssessment = (riskId: string, payload: Record<string, unknown>) =>
  api.post<RiskAssessment>(`/risks/${riskId}/assessments`, payload)

export const convertRisk = (
  riskId: string,
  payload: { target: string; task_name?: string; task_owner?: string },
) => api.post<{ ok: boolean; risk_status: string }>(`/risks/${riskId}/convert`, payload)

export const listIssues = (projectId: string, params: Record<string, unknown> = {}) =>
  api.get<IssueItem[]>(`/projects/${projectId}/issues${qs(params)}`)

export const createIssue = (projectId: string, payload: Record<string, unknown>) =>
  api.post<IssueItem>(`/projects/${projectId}/issues`, payload)

export const updateIssue = (id: string, payload: Record<string, unknown>) =>
  api.patch<IssueItem>(`/issues/${id}`, payload)

export const closeIssue = (id: string, payload: Record<string, unknown>) =>
  api.post<IssueItem>(`/issues/${id}/close`, payload)

export const deleteIssue = (id: string) => api.delete(`/issues/${id}`)

export const listChanges = (projectId: string) =>
  api.get<ChangeItem[]>(`/projects/${projectId}/changes`)
export const createChange = (projectId: string, payload: Record<string, unknown>) =>
  api.post<ChangeItem>(`/projects/${projectId}/changes`, payload)
export const updateChange = (id: string, payload: Record<string, unknown>) =>
  api.patch<ChangeItem>(`/changes/${id}`, payload)
export const deleteChange = (id: string) => api.delete(`/changes/${id}`)

export const listStakeholders = (projectId: string) =>
  api.get<StakeholderItem[]>(`/projects/${projectId}/stakeholders`)
export const createStakeholder = (projectId: string, payload: Record<string, unknown>) =>
  api.post<StakeholderItem>(`/projects/${projectId}/stakeholders`, payload)
export const updateStakeholder = (id: string, payload: Record<string, unknown>) =>
  api.patch<StakeholderItem>(`/stakeholders/${id}`, payload)
export const deleteStakeholder = (id: string) => api.delete(`/stakeholders/${id}`)

export const listCommunications = (stakeholderId: string) =>
  api.get<CommunicationItem[]>(`/stakeholders/${stakeholderId}/communications`)
export const createCommunication = (stakeholderId: string, payload: Record<string, unknown>) =>
  api.post<{ id: string }>(`/stakeholders/${stakeholderId}/communications`, payload)
export const deleteCommunication = (id: string) => api.delete(`/communications/${id}`)

export const listAuditLogs = (projectId: string, params: Record<string, unknown> = {}) =>
  api.get<AuditLogItem[]>(`/projects/${projectId}/audit${qs(params)}`)

function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}
