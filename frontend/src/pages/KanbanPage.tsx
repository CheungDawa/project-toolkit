import { App, Card, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import type { TaskItem } from '../api/stage2'
import { listTasks, updateTask } from '../api/stage2'

/** 看板列定义（任务状态 → 列） */
const COLUMNS = [
  { key: '未开始', color: '#94a3b8', bg: '#f1f5f9' },
  { key: '进行中', color: '#3b82f6', bg: '#eff6ff' },
  { key: '已完成', color: '#10b981', bg: '#ecfdf5' },
  { key: '已暂停', color: '#f59e0b', bg: '#fffbeb' },
]

interface DragState {
  taskId: string
  fromStatus: string
}

export default function KanbanPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()

  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState<DragState | null>(null)
  const [hoverCol, setHoverCol] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const data = await listTasks(projectId)
      // 看板只显示叶子任务（父任务是汇总，拖拽无意义）
      const parentIds = new Set(data.items.filter((t) => t.parent_id).map((t) => t.parent_id))
      setTasks(data.items.filter((t) => !parentIds.has(t.id)))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载任务失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const tasksByStatus = useMemo(() => {
    const map: Record<string, TaskItem[]> = {}
    for (const col of COLUMNS) map[col.key] = []
    for (const t of tasks) {
      const key = COLUMNS.some((c) => c.key === t.status) ? t.status : '未开始'
      map[key].push(t)
    }
    return map
  }, [tasks])

  const handleDrop = async (targetStatus: string) => {
    setHoverCol(null)
    if (!dragging || dragging.fromStatus === targetStatus) {
      setDragging(null)
      return
    }
    const task = tasks.find((t) => t.id === dragging.taskId)
    setDragging(null)
    if (!task) return
    // 乐观更新
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: targetStatus } : t)))
    try {
      await updateTask(task.id, {
        status: targetStatus,
        progress: targetStatus === '已完成' ? Math.max(task.progress, 100) : task.progress,
      })
      message.success(`「${task.name}」已移至 ${targetStatus}`)
      await fetchData()
    } catch (err) {
      // 失败回滚
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: dragging.fromStatus } : t)))
      message.error(err instanceof Error ? err.message : '移动失败')
    }
  }

  const priorityTag = (p: string | null) => {
    if (!p) return null
    const color = p === '高' ? '#ef4444' : p === '中' ? '#e8a33d' : '#1e8449'
    return <span style={{ display: 'inline-block', padding: '0 5px', borderRadius: 4, fontSize: 10, color: '#fff', background: color }}>{p}</span>
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, minHeight: '60vh' }}>
        {COLUMNS.map((col) => {
          const list = tasksByStatus[col.key] ?? []
          const isHover = hoverCol === col.key
          return (
            <div
              key={col.key}
              onDragOver={(e) => {
                e.preventDefault()
                setHoverCol(col.key)
              }}
              onDragLeave={() => setHoverCol((c) => (c === col.key ? null : c))}
              onDrop={() => void handleDrop(col.key)}
              style={{
                flex: '1 1 260px',
                minWidth: 260,
                background: isHover ? '#e0e7ff' : col.bg,
                border: `2px dashed ${isHover ? '#4f46e5' : 'transparent'}`,
                borderRadius: 12,
                padding: 10,
                transition: 'background .15s, border-color .15s',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {/* 列头 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '2px 4px' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: col.color }} />
                <span style={{ fontWeight: 700, fontSize: 14, color: '#1c2b36' }}>{col.key}</span>
                <span style={{ fontSize: 12, color: '#8a9ba8', background: 'rgba(255,255,255,.8)', borderRadius: 10, padding: '0 8px' }}>{list.length}</span>
              </div>

              {/* 卡片区（可滚动） */}
              <div style={{ flex: 1, overflowY: 'auto', maxHeight: 'calc(100vh - 260px)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {loading ? <Card size="small" loading style={{ borderRadius: 8 }} /> : null}
                {!loading && list.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#aab', fontSize: 12, padding: '24px 0' }}>拖任务到这里</div>
                ) : null}
                {list.map((t) => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={() => setDragging({ taskId: t.id, fromStatus: t.status })}
                    onDragEnd={() => {
                      setDragging(null)
                      setHoverCol(null)
                    }}
                    onDoubleClick={() => navigate(`/projects/${projectId}/wbs`)}
                    style={{
                      background: '#fff',
                      borderRadius: 8,
                      padding: '10px 12px',
                      boxShadow: '0 1px 3px rgba(17,20,40,.08)',
                      cursor: dragging?.taskId === t.id ? 'grabbing' : 'grab',
                      opacity: dragging?.taskId === t.id ? 0.45 : 1,
                      border: '1px solid #eef1f6',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 6 }}>
                      <div>
                        <Typography.Text code style={{ fontSize: 11 }}>{t.wbs_code}</Typography.Text>
                        <span style={{ marginLeft: 4, fontWeight: 600, fontSize: 13 }}>{t.name}</span>
                      </div>
                      {priorityTag(t.priority)}
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#6b7c8c' }}>
                      {t.owner ? <span>👤 {t.owner}</span> : null}
                      {t.plan_start && t.plan_end ? <span>📅 {t.plan_start.slice(5)}~{t.plan_end.slice(5)}</span> : null}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 44, height: 5, borderRadius: 3, background: '#e5e9f0', display: 'inline-block', overflow: 'hidden' }}>
                          <span style={{ display: 'block', height: '100%', width: `${t.effective_progress ?? t.progress}%`, background: '#4f46e5', borderRadius: 3 }} />
                        </span>
                        {t.effective_progress ?? t.progress}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 12, color: '#8a9ba8', marginTop: 4 }}>
        💡 拖动卡片改变状态 · 双击卡片去 WBS 编辑 · 已完成时进度自动置 100%
      </div>
    </div>
  )
}