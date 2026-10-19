import { api } from './client'

export interface SnapshotItem {
  id: string
  scope: string
  snapshot_date: string
  total_tasks: number
  completed_tasks: number
  remaining_tasks: number
  total_hours: number
  remaining_hours: number
  captured_at: string
}

export interface BurndownResponse {
  snapshots: {
    date: string
    total_tasks: number
    remaining_tasks: number
    completed_tasks: number
    total_hours: number
    remaining_hours: number
  }[]
  ideal: { date: string; remaining_tasks: number; remaining_hours: number }[]
  target_date: string
}

export interface DeliverableItem {
  id: string
  project_id: string
  template_id: string | null
  category: string | null
  name: string
  owner: string | null
  plan_date: string | null
  submit_status: string
  review_status: string
  note: string | null
  task_id: string | null
  created_at: string
  updated_at: string
}

export const captureSnapshot = (projectId: string) => api.post<SnapshotItem>(`/projects/${projectId}/snapshots`, {})
export interface AttachmentItem {
  id: string
  file_name: string
  size_bytes: number
  mime_type: string | null
  uploaded_at: string
}

export interface ProjectAttachmentItem extends AttachmentItem {
  deliverable_id: string
}

export const listSnapshots = (projectId: string) => api.get<SnapshotItem[]>(`/projects/${projectId}/snapshots`)
export const burndown = (projectId: string) => api.get<BurndownResponse>(`/projects/${projectId}/burndown`)

export const listTemplates = () => api.get<{ templates: { name: string; items: { category: string; name: string; description?: string }[] }[] }>('/deliverable-templates')
export const instantiateTemplate = (projectId: string, template_name: string) =>
  api.post<{ created: number }>(`/projects/${projectId}/deliverables/instantiate`, { template_name })

export const listDeliverables = (projectId: string, params: Record<string, unknown> = {}) =>
  api.get<DeliverableItem[]>(`/projects/${projectId}/deliverables${qs(params)}`)
export const createDeliverable = (projectId: string, payload: Record<string, unknown>) =>
  api.post<DeliverableItem>(`/projects/${projectId}/deliverables`, payload)
export const updateDeliverable = (id: string, payload: Record<string, unknown>) =>
  api.patch<DeliverableItem>(`/deliverables/${id}`, payload)
export const deleteDeliverable = (id: string) => api.delete(`/deliverables/${id}`)
export const listAttachments = (deliverableId: string) =>
  api.get<AttachmentItem[]>(`/deliverables/${deliverableId}/attachments`)
/** 按项目一次性拉取全部交付资料附件（列表页展示「附件(n)」徽标，避免逐行请求） */
export const listProjectAttachments = (projectId: string) =>
  api.get<{ attachments: ProjectAttachmentItem[] }>(`/projects/${projectId}/deliverables/attachments`)
export const uploadAttachment = async (deliverableId: string, file: File) => {
  const form = new FormData()
  form.append('file', file)
  const resp = await fetch(`/api/deliverables/${deliverableId}/attachments`, { method: 'POST', body: form })
  const body = await resp.json().catch(() => null)
  if (!resp.ok) throw new Error(body?.error?.message ?? `上传失败（${resp.status}）`)
  return body
}
/** 附件下载/预览地址：inline=true 时后端返回 Content-Disposition: inline（PDF/图片可浏览器直接预览） */
export const attachmentDownloadUrl = (id: string, inline = false) =>
  `/api/attachments/${id}/download${inline ? '?inline=1' : ''}`
export const deleteAttachment = (id: string) => api.delete(`/attachments/${id}`)
export const deliverableExportUrl = (projectId: string) => `/api/projects/${projectId}/deliverables/export`
export const importDeliverables = async (projectId: string, file: File) => {
  const form = new FormData()
  form.append('file', file)
  const resp = await fetch(`/api/projects/${projectId}/deliverables/import`, { method: 'POST', body: form })
  const body = await resp.json().catch(() => null)
  if (!resp.ok) throw new Error(body?.error?.message ?? `导入失败（${resp.status}）`)
  return body as { created: number; errors: { row: number; message: string }[] }
}

export const weeklyText = (projectId: string) =>
  api.get<{ meta: string; content: string }>(`/projects/${projectId}/reports/weekly-text`)
export const reportExportUrl = (projectId: string, type: 'weekly' | 'final') =>
  `/api/projects/${projectId}/reports/${type}/export`
export const deliverableCheck = (projectId: string) =>
  api.post<{ content: string; model: string; usage: number }>(`/ai/projects/${projectId}/deliverable-check`, {})

function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}