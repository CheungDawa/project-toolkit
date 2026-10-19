import { api } from './client'

export interface TaskItem {
  id: string
  project_id: string
  parent_id: string | null
  sort_order: number
  wbs_code: string
  name: string
  owner: string | null
  collaborators: string[]
  plan_start: string | null
  plan_end: string | null
  actual_start: string | null
  actual_end: string | null
  duration_days: number | null
  work_hours: number | null
  progress: number
  effective_progress: number
  status: string
  priority: string | null
  acceptance_criteria: string | null
  deliverable_name: string | null
  progress_source: string
  created_at: string
  updated_at: string
}

export interface DependencyItem {
  id: string
  project_id: string
  predecessor_id: string
  successor_id: string
  dep_type: string
  lag_days: number
}

export interface TaskListResponse {
  items: TaskItem[]
  dependencies: DependencyItem[]
}

export interface TaskPayload {
  name: string
  parent_id?: string | null
  owner?: string | null
  collaborators?: string[]
  plan_start?: string | null
  plan_end?: string | null
  actual_start?: string | null
  actual_end?: string | null
  work_hours?: number | null
  progress?: number
  status?: string
  priority?: string | null
  acceptance_criteria?: string | null
  deliverable_name?: string | null
}

export interface Milestone {
  id: string
  project_id: string
  name: string
  plan_date: string | null
  actual_date: string | null
  status: string | null
  description: string | null
  created_at: string
  updated_at: string
}

export interface Baseline {
  id: string
  project_id: string
  name: string
  version: number
  frozen_at: string
  note: string | null
  created_at: string
}

export interface BaselineDiffRow {
  task_id: string
  wbs_code: string
  level: number
  name: string
  current: Record<string, unknown>
  baseline: Record<string, unknown>
  changed: boolean
}

export const listTasks = (projectId: string) =>
  api.get<TaskListResponse>(`/projects/${projectId}/tasks`)

export const createTask = (projectId: string, payload: TaskPayload) =>
  api.post<TaskItem>(`/projects/${projectId}/tasks`, payload)

export const updateTask = (taskId: string, payload: Partial<TaskPayload>) =>
  api.patch<TaskItem>(`/tasks/${taskId}`, payload)

export const deleteTask = (taskId: string) => api.delete(`/tasks/${taskId}`)

export const copyTask = (taskId: string) => api.post<TaskItem>(`/tasks/${taskId}/copy`)

export const reorderTask = (projectId: string, body: { task_id: string; new_parent_id?: string | null; new_index: number }) =>
  api.post<{ ok: boolean }>(`/projects/${projectId}/tasks/reorder`, body)

export const exportTasksUrl = (projectId: string) => `/api/projects/${projectId}/tasks/export`

export interface ImportIssue {
  row: number
  message: string
}

export interface TaskImportResult {
  created: number
  errors: ImportIssue[]
  /** 老版本后端不返回该字段，调用方必须做 ?? [] 兜底 */
  warnings?: ImportIssue[]
}

export const importTasks = async (projectId: string, file: File): Promise<TaskImportResult> => {
  const form = new FormData()
  form.append('file', file)
  const resp = await fetch(`/api/projects/${projectId}/tasks/import`, { method: 'POST', body: form })
  const body = await resp.json().catch(() => null)
  if (!resp.ok) {
    const message = body?.error?.message ?? `导入失败（${resp.status}）`
    throw new Error(message)
  }
  return body as TaskImportResult
}

/** 从其他项目整棵复制 WBS 树（作为顶级任务追加；with_dates=true 时连计划日期一起复制） */
export const cloneTasksFromProject = (projectId: string, sourceProjectId: string, withDates = false) =>
  api.post<{ created: number; with_dates: boolean }>(
    `/projects/${projectId}/tasks/clone-from/${sourceProjectId}?with_dates=${withDates ? 'true' : 'false'}`,
  )

export const listDependencies = (projectId: string) =>
  api.get<DependencyItem[]>(`/projects/${projectId}/dependencies`)

export const createDependency = (projectId: string, payload: { predecessor_id: string; successor_id: string; dep_type?: string; lag_days?: number }) =>
  api.post<DependencyItem>(`/projects/${projectId}/dependencies`, payload)

export const deleteDependency = (depId: string) => api.delete(`/dependencies/${depId}`)

export const listMilestones = (projectId: string) =>
  api.get<Milestone[]>(`/projects/${projectId}/milestones`)

export const createMilestone = (projectId: string, payload: Partial<Milestone>) =>
  api.post<Milestone>(`/projects/${projectId}/milestones`, payload)

export const updateMilestone = (id: string, payload: Partial<Milestone>) =>
  api.patch<Milestone>(`/milestones/${id}`, payload)

export const deleteMilestone = (id: string) => api.delete(`/milestones/${id}`)

export const listBaselines = (projectId: string) =>
  api.get<Baseline[]>(`/projects/${projectId}/baselines`)

export const createBaseline = (projectId: string, payload: { name: string; note?: string }) =>
  api.post<Baseline>(`/projects/${projectId}/baselines`, payload)

export const baselineDiff = (projectId: string, baselineId: string) =>
  api.get<BaselineDiffRow[]>(`/projects/${projectId}/baselines/${baselineId}/diff`)

export const getCalendar = (projectId: string) =>
  api.get<{ weekends: number[]; holidays: string[]; extra_workdays: string[] }>(`/projects/${projectId}/calendar`)