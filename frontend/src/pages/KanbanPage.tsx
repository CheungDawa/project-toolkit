import {
  CalendarOutlined,
  EditOutlined,
  SearchOutlined,
  UserOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  Drawer,
  Input,
  InputNumber,
  Progress,
  Select,
  Slider,
  Space,
  Tag,
  Typography,
} from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const STATUS_OPTIONS = COLUMNS.map((c) => ({ value: c.key, label: c.key }))

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

  // 筛选（任务书一：筛选搜索）
  const [keyword, setKeyword] = useState('')
  const [ownerFilter, setOwnerFilter] = useState<string | undefined>()
  const [priorityFilter, setPriorityFilter] = useState<string | undefined>()

  // 详情抽屉（任务书一：任务详情面板）
  const [detailTask, setDetailTask] = useState<TaskItem | null>(null)
  const [detailStatus, setDetailStatus] = useState<string>('未开始')
  const [detailProgress, setDetailProgress] = useState<number>(0)
  const [saving, setSaving] = useState(false)

  // 拖拽后抑制 click（部分浏览器拖拽结束会触发 click）
  const suppressClick = useRef(false)

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

  /** 筛选后的任务集（关键词/负责人/优先级） */
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return tasks.filter((t) => {
      if (kw && !(t.name.toLowerCase().includes(kw) || t.wbs_code.toLowerCase().includes(kw) || (t.owner ?? '').toLowerCase().includes(kw))) return false
      if (ownerFilter && t.owner !== ownerFilter) return false
      if (priorityFilter && t.priority !== priorityFilter) return false
      return true
    })
  }, [tasks, keyword, ownerFilter, priorityFilter])

  /** 可选负责人列表（从真实数据提取，不编造） */
  const ownerOptions = useMemo(() => {
    const owners = [...new Set(tasks.map((t) => t.owner).filter((o): o is string => !!o))].sort()
    return owners.map((o) => ({ value: o, label: o }))
  }, [tasks])

  const tasksByStatus = useMemo(() => {
    const map: Record<string, TaskItem[]> = {}
    for (const col of COLUMNS) map[col.key] = []
    for (const t of filtered) {
      const key = COLUMNS.some((c) => c.key === t.status) ? t.status : '未开始'
      map[key].push(t)
    }
    return map
  }, [filtered])

  const filterActive = keyword.trim() !== '' || !!ownerFilter || !!priorityFilter

  const handleDrop = async (targetStatus: string) => {
    setHoverCol(null)
    if (!dragging || dragging.fromStatus === targetStatus) {
      setDragging(null)
      return
    }
    const task = tasks.find((t) => t.id === dragging.taskId)
    const fromStatus = dragging.fromStatus
    setDragging(null)
    if (!task) return
    // 乐观更新
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: targetStatus } : t)))
    suppressClick.current = true
    setTimeout(() => { suppressClick.current = false }, 250)
    try {
      await updateTask(task.id, {
        status: targetStatus,
        progress: targetStatus === '已完成' ? Math.max(task.progress, 100) : task.progress,
      })
      message.success(`「${task.name}」已移至 ${targetStatus}`)
      await fetchData()
    } catch (err) {
      // 失败回滚
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: fromStatus } : t)))
      message.error(err instanceof Error ? err.message : '移动失败')
    }
  }

  // ---------- 详情抽屉 ----------
  const openDetail = (t: TaskItem) => {
    if (suppressClick.current) return
    setDetailTask(t)
    setDetailStatus(t.status)
    setDetailProgress(Math.round(t.progress))
  }

  const applyDetailChange = async (nextStatus: string, nextProgress: number) => {
    if (!detailTask) return
    const prevStatus = detailTask.status
    const prevProgress = Math.round(detailTask.progress)
    setSaving(true)
    // 乐观更新列表
    setTasks((prev) =>
      prev.map((t) => (t.id === detailTask.id ? { ...t, status: nextStatus, progress: nextProgress } : t)),
    )
    try {
      await updateTask(detailTask.id, { status: nextStatus, progress: nextProgress })
      message.success('已保存')
      const refreshed = { ...detailTask, status: nextStatus, progress: nextProgress }
      setDetailTask(refreshed)
      await fetchData()
    } catch (err) {
      // 失败回滚
      setTasks((prev) =>
        prev.map((t) => (t.id === detailTask.id ? { ...t, status: prevStatus, progress: prevProgress } : t)),
      )
      setDetailStatus(prevStatus)
      setDetailProgress(prevProgress)
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const priorityTag = (p: string | null) => {
    if (!p) return null
    const color = p === '高' ? '#ef4444' : p === '中' ? '#e8a33d' : '#1e8449'
    return <span style={{ display: 'inline-block', padding: '0 5px', borderRadius: 4, fontSize: 10, color: '#fff', background: color }}>{p}</span>
  }

  const descItem = (label: string, content: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
      <span style={{ width: 72, flexShrink: 0, fontSize: 12.5, color: '#8a919e' }}>{label}</span>
      <span style={{ flex: 1, fontSize: 12.5, color: '#2c3242', wordBreak: 'break-all' }}>{content}</span>
    </div>
  )

  return (
    <div>
      {/* ===================== 筛选栏 ===================== */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          padding: '10px 14px',
          marginBottom: 12,
          background: '#fff',
          borderRadius: 10,
          border: '1px solid #eceef4',
        }}
      >
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: '#b3bac5' }} />}
          placeholder="搜索任务名称 / WBS 编码 / 负责人"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 264 }}
        />
        <Select
          allowClear
          placeholder="负责人"
          value={ownerFilter}
          onChange={setOwnerFilter}
          options={ownerOptions}
          style={{ width: 148 }}
          notFoundContent={<span style={{ fontSize: 12, color: '#8a919e' }}>暂无负责人数据</span>}
        />
        <Select
          allowClear
          placeholder="优先级"
          value={priorityFilter}
          onChange={setPriorityFilter}
          options={[
            { value: '高', label: '高' },
            { value: '中', label: '中' },
            { value: '低', label: '低' },
          ]}
          style={{ width: 110 }}
        />
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8a919e' }}>
          显示 {filtered.length} / {tasks.length} 项叶子任务
          {filterActive ? '（筛选中）' : ''}
        </span>
      </div>

      {/* ===================== 四列看板 ===================== */}
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, minHeight: '56vh' }}>
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
                <span style={{ fontSize: 12, color: '#8a9ba8', background: 'rgba(255,255,255,.8)', borderRadius: 10, padding: '0 8px' }}>
                  {list.length}
                  {filterActive && tasks.some((t) => (t.status || '未开始') === col.key) ? `/${tasks.filter((t) => (t.status || '未开始') === col.key).length}` : ''}
                </span>
              </div>

              {/* 卡片区（可滚动） */}
              <div style={{ flex: 1, overflowY: 'auto', maxHeight: 'calc(100vh - 320px)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {loading ? <Card size="small" loading style={{ borderRadius: 8 }} /> : null}
                {!loading && list.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#aab', fontSize: 12, padding: '24px 0' }}>
                    {filterActive ? '无匹配任务' : '拖任务到这里'}
                  </div>
                ) : null}
                {list.map((t) => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={() => setDragging({ taskId: t.id, fromStatus: t.status })}
                    onDragEnd={() => {
                      suppressClick.current = true
                      setTimeout(() => { suppressClick.current = false }, 250)
                      setDragging(null)
                      setHoverCol(null)
                    }}
                    onClick={() => openDetail(t)}
                    style={{
                      background: '#fff',
                      borderRadius: 8,
                      padding: '10px 12px',
                      boxShadow: '0 1px 3px rgba(17,20,40,.08)',
                      cursor: dragging?.taskId === t.id ? 'grabbing' : 'grab',
                      opacity: dragging?.taskId === t.id ? 0.45 : 1,
                      border: '1px solid #eef1f6',
                      transition: 'box-shadow .15s ease, border-color .15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#c7cdff'
                      e.currentTarget.style.boxShadow = '0 3px 10px rgba(79,70,229,.12)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#eef1f6'
                      e.currentTarget.style.boxShadow = '0 1px 3px rgba(17,20,40,.08)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 6 }}>
                      <div style={{ minWidth: 0 }}>
                        <Typography.Text code style={{ fontSize: 11 }}>{t.wbs_code}</Typography.Text>
                        <span style={{ marginLeft: 4, fontWeight: 600, fontSize: 13 }}>{t.name}</span>
                      </div>
                      {priorityTag(t.priority)}
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#6b7c8c', flexWrap: 'wrap' }}>
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
        💡 拖动卡片改状态（失败自动回滚）· 单击卡片查看详情与调整进度 · 已完成时进度自动置 100%
      </div>

      {/* ===================== 任务详情抽屉 ===================== */}
      <Drawer
        title={
          detailTask ? (
            <Space size={8}>
              <Typography.Text code style={{ fontSize: 12 }}>{detailTask.wbs_code}</Typography.Text>
              <span>{detailTask.name}</span>
            </Space>
          ) : (
            '任务详情'
          )
        }
        placement="right"
        width={420}
        open={!!detailTask}
        onClose={() => setDetailTask(null)}
        destroyOnClose
      >
        {detailTask && (
          <div>
            {descItem('状态', (
              <Select
                value={detailStatus}
                onChange={(v) => {
                  setDetailStatus(v)
                  if (v === '已完成' && detailProgress < 100) setDetailProgress(100)
                }}
                options={STATUS_OPTIONS}
                style={{ width: 140 }}
              />
            ))}
            {descItem('进度', (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Slider
                    value={detailProgress}
                    onChange={(v) => setDetailProgress(v)}
                    style={{ flex: 1, marginInline: 0 }}
                    min={0}
                    max={100}
                    step={5}
                  />
                  <InputNumber
                    value={detailProgress}
                    onChange={(v) => setDetailProgress(typeof v === 'number' ? Math.max(0, Math.min(100, v)) : 0)}
                    min={0}
                    max={100}
                    size="small"
                    formatter={(v) => `${v ?? 0}%`}
                    parser={(v) => Number((v ?? '0').replace('%', ''))}
                    style={{ width: 72 }}
                  />
                </div>
                <Progress
                  percent={detailProgress}
                  size="small"
                  showInfo={false}
                  strokeColor={detailProgress >= 100 ? '#10b981' : detailProgress > 0 ? '#4f46e5' : '#d6dae2'}
                  style={{ margin: 0, marginTop: 4 }}
                />
              </div>
            ))}
            {descItem('优先级', detailTask.priority ? priorityTag(detailTask.priority) : '—')}
            {descItem(
              '负责人',
              detailTask.owner ? (
                <span><UserOutlined style={{ marginRight: 4, color: '#8a919e' }} />{detailTask.owner}</span>
              ) : '—',
            )}
            {detailTask.collaborators?.length ? descItem('协作人', detailTask.collaborators.join('、')) : null}
            {descItem('计划周期', detailTask.plan_start && detailTask.plan_end ? (
              <span><CalendarOutlined style={{ marginRight: 4, color: '#8a919e' }} />{detailTask.plan_start} ~ {detailTask.plan_end}</span>
            ) : '—')}
            {descItem('实际周期', detailTask.actual_start ? (
              <span>{detailTask.actual_start} ~ {detailTask.actual_end ?? '进行中'}</span>
            ) : '—')}
            {descItem('工时（h）', detailTask.work_hours != null ? String(detailTask.work_hours) : '—')}
            {descItem('验收标准', detailTask.acceptance_criteria || '—')}
            {descItem('交付物', detailTask.deliverable_name || '—')}

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <Button
                type="primary"
                loading={saving}
                disabled={detailStatus === detailTask.status && detailProgress === Math.round(detailTask.progress)}
                onClick={() => void applyDetailChange(detailStatus, detailProgress)}
              >
                保存修改
              </Button>
              <Button icon={<EditOutlined />} onClick={() => navigate(`/projects/${projectId}/wbs`)}>
                去 WBS 编辑
              </Button>
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: '#b3bac5' }}>
              修改即时持久化到数据库，失败自动回滚显示
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}
