import { useCallback, useEffect, useState } from 'react'

import { ApiError } from '../api/client'
import { getProject, type Project } from '../api/projects'

export interface ProjectContextState {
  project: Project | null
  loading: boolean
  /** not_found = 项目不存在或已删除 */
  error: 'not_found' | 'network' | null
  reload: () => void
}

/**
 * 项目上下文 Hook（项目工作空间单一事实来源）。
 *
 * - 以 URL 中的稳定项目 ID 为准（项目改名不影响关联）
 * - 所有项目内页面应复用本 Hook 读取当前项目，避免各自维护状态
 * - 项目不存在/已删除 → error='not_found'，由调用方渲染统一错误态
 */
export function useProjectContext(projectId: string | undefined): ProjectContextState {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'not_found' | 'network' | null>(null)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!projectId) {
      setProject(null)
      setError('not_found')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    getProject(projectId)
      .then(p => {
        if (!cancelled) setProject(p)
      })
      .catch(err => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setError('not_found')
          setProject(null)
        } else {
          setError('network')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, tick])

  return { project, loading, error, reload }
}
