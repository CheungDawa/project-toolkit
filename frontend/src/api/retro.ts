import { api } from './client'

/**
 * 复盘（Retrospective）模块接口层。
 *
 * 复盘为「项目级」：同一项目下可有多个复盘（如按阶段/里程碑/迭代/整体）。
 * 数据契约与后端严格对齐（backend/app/schemas/retro.py）：
 *   GET/POST   /api/projects/{project_id}/retrospectives
 *   GET/PATCH/DELETE /api/projects/{project_id}/retrospectives/{retro_id}
 *   GET/POST   /api/projects/{project_id}/retrospectives/{retro_id}/action-items
 *   PATCH      /api/projects/{project_id}/retrospectives/{retro_id}/action-items/{item_id}
 *   POST       /api/projects/{project_id}/retrospectives/{retro_id}/action-items/{item_id}/convert
 *             body { target: "task" | "risk" | "issue" } → 返回 { action_item, entity, entity_type }
 *
 * 函数风格对齐 api/stage2.ts：薄封装 + 明确泛型返回。
 */

/** 复盘覆盖范围（后端 scope 枚举） */
export type RetroScope = 'phase' | 'milestone' | 'sprint' | 'whole'

/** 复盘条目分类：做得好 / 待改进 / 行动项 */
export type RetroCategory = 'good' | 'improve' | 'action'

/** 行动项状态（后端 RetroActionStatus 枚举） */
export type RetroActionStatus = 'open' | 'in_progress' | 'done' | 'closed'

/** 行动项手动关联实体类型（存为 link_type / link_id，free string 后端不限） */
export type RetroLinkType = 'risk' | 'issue' | 'deliverable'

/** 行动项转换目标（转任务 / 转风险 / 转问题，自动回写） */
export type ConvertTarget = 'task' | 'risk' | 'issue'

/** 复盘（项目级） */
export interface Retrospective {
  id: string
  project_id: string
  title: string
  /** 覆盖范围：phase/milestone/sprint/whole */
  scope: RetroScope
  /** 发生日期（ISO，如 2026-10-21） */
  occurred_on: string
  facilitator: string | null
  participants: string[] | null
  summary: string | null
  atmosphere: string | null
  status: 'draft' | 'published'
  created_at: string
  updated_at: string
}

/** 创建/更新复盘的可选载荷（occurred_on 为必填，其余可选） */
export interface RetroPayload {
  title: string
  scope?: RetroScope
  occurred_on: string
  facilitator?: string | null
  participants?: string[] | null
  summary?: string | null
  atmosphere?: string | null
  status?: 'draft' | 'published'
}

/** 复盘条目（统一承载三栏：good / improve / action） */
export interface RetroItem {
  id: string
  retro_id: string
  project_id: string
  category: RetroCategory
  content: string
  owner: string | null
  due_date: string | null
  priority: 'low' | 'medium' | 'high' | null
  status: RetroActionStatus | null
  link_type: RetroLinkType | null
  link_id: string | null
  converted: boolean
  converted_id: string | null
  created_at: string
  updated_at: string
}

/** 创建/更新复盘条目的可选载荷 */
export interface RetroItemPayload {
  category: RetroCategory
  content: string
  owner?: string | null
  due_date?: string | null
  priority?: 'low' | 'medium' | 'high' | null
  status?: RetroActionStatus | null
  link_type?: RetroLinkType | null
  link_id?: string | null
}

/**
 * 行动项转换结果：后端新建实体后返回。
 * entity 为 task/risk/issue 三类通用字典，前端按 name/title/id 取展示名。
 */
export interface ConvertedEntity {
  action_item: RetroItem
  entity: Record<string, unknown>
  entity_type: ConvertTarget
}

export const listRetrospectives = (projectId: string) =>
  api.get<Retrospective[]>(`/projects/${projectId}/retrospectives`)

export const createRetrospective = (projectId: string, payload: RetroPayload) =>
  api.post<Retrospective>(`/projects/${projectId}/retrospectives`, payload)

export const getRetrospective = (projectId: string, retroId: string) =>
  api.get<Retrospective>(`/projects/${projectId}/retrospectives/${retroId}`)

export const updateRetrospective = (
  projectId: string,
  retroId: string,
  payload: Partial<RetroPayload>,
) => api.patch<Retrospective>(`/projects/${projectId}/retrospectives/${retroId}`, payload)

export const deleteRetrospective = (projectId: string, retroId: string) =>
  api.delete(`/projects/${projectId}/retrospectives/${retroId}`)

export const listActionItems = (projectId: string, retroId: string) =>
  api.get<RetroItem[]>(`/projects/${projectId}/retrospectives/${retroId}/action-items`)

export const createActionItem = (projectId: string, retroId: string, payload: RetroItemPayload) =>
  api.post<RetroItem>(`/projects/${projectId}/retrospectives/${retroId}/action-items`, payload)

export const updateActionItem = (
  projectId: string,
  retroId: string,
  itemId: string,
  payload: Partial<RetroItemPayload>,
) =>
  api.patch<RetroItem>(
    `/projects/${projectId}/retrospectives/${retroId}/action-items/${itemId}`,
    payload,
  )

/**
 * 行动项转任务/风险/问题（后端自动回写新建实体）。
 * body 仅传 target，返回 { action_item, entity, entity_type } 供前端回填提示。
 */
export const convertActionItem = (
  projectId: string,
  retroId: string,
  itemId: string,
  target: ConvertTarget,
) =>
  api.post<ConvertedEntity>(
    `/projects/${projectId}/retrospectives/${retroId}/action-items/${itemId}/convert`,
    { target },
  )
