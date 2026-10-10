import { api } from './client'

export interface Project {
  id: string
  code: string
  name: string
  customer: string | null
  manager: string | null
  phase: string | null
  status: string | null
  plan_start: string | null
  plan_end: string | null
  actual_start: string | null
  actual_end: string | null
  description: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
  deleted_at: string | null
}

export interface ProjectPage {
  items: Project[]
  total: number
  page: number
  size: number
}

export interface ProjectPayload {
  code: string
  name: string
  customer?: string | null
  manager?: string | null
  phase?: string | null
  status?: string | null
  plan_start?: string | null
  plan_end?: string | null
  actual_start?: string | null
  actual_end?: string | null
  description?: string | null
}

export interface ProjectQuery {
  q?: string
  status?: string
  phase?: string
  archived?: 'exclude' | 'include' | 'only'
  sort?: string
  page?: number
  size?: number
}

function buildQuery(query: ProjectQuery): string {
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q)
  if (query.status) params.set('status', query.status)
  if (query.phase) params.set('phase', query.phase)
  if (query.archived) params.set('archived', query.archived)
  if (query.sort) params.set('sort', query.sort)
  if (query.page) params.set('page', String(query.page))
  if (query.size) params.set('size', String(query.size))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export const listProjects = (query: ProjectQuery = {}) =>
  api.get<ProjectPage>(`/projects${queryToString(query)}`)

export const getProject = (id: string) => api.get<Project>(`/projects/${id}`)

export const createProject = (payload: ProjectPayload) => api.post<Project>('/projects', payload)

export const updateProject = (id: string, payload: Partial<ProjectPayload>) =>
  api.patch<Project>(`/projects/${id}`, payload)

export const archiveProject = (id: string) => api.post<Project>(`/projects/${id}/archive`)

export const deleteProject = (id: string) => api.delete(`/projects/${id}`)

function buildQuery(query: ProjectQuery): string {
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q)
  if (query.status) params.set('status', query.status)
  if (query.phase) params.set('phase', query.phase)
  if (query.archived) params.set('archived', query.archived)
  if (query.sort) params.set('sort', query.sort)
  if (query.page) params.set('page', String(query.page))
  if (query.size) params.set('size', String(query.size))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}