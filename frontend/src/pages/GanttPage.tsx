import { App, Button, Card, Segmented, Space, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import type { GanttItemInput } from '../components/GanttView'
import GanttView from '../components/GanttView'
import type { GanttViewMode } from '../components/GanttView'
import { listTasks, updateTask } from '../api/stage2'
import type { TaskItem } from '../api/stage2'

export default function GanttPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()

  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [deps, setDeps] = useState<{ predecessor_id: string; successor_id: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<GanttViewMode>('Day')
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const data = await listTasks(projectId)
      setTasks(data.items)
      setDeps(data.dependencies)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载甘特图失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const ganttItems: GanttItemInput[] = tasks
    .filter((t) => t.plan_start && t.plan_end)
    .map((t) => ({
      id: t.id,
      name: `${t.wbs_code} ${t.name}`,
      start: t.plan_start!,
      end: t.plan_end!,
      progress: Math.round(t.effective_progress ?? t.progress ?? 0),
      dependencies: deps.filter((d) => d.successor_id === t.id).map((d) => d.predecessor_id),
    }))

  const handleDateChange = async (taskId: string, start: string, end: string) => {
    setSaving(true)
    try {
      await updateTask(taskId, { plan_start: start, plan_end: end })
      message.success(`已更新日期 ${start} ~ ${end}（经后端校验并持久化）`)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '日期保存失败，甘特已回弹')
      await fetchData()
    } finally {
      setSaving(false)
    }
  }

  const handleProgressChange = async (taskId: string, progress: number) => {
    try {
      await updateTask(taskId, { progress })
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '进度保存失败')
    }
  }

  const handleTaskClick = (_taskId: string) => {
    message.info('提示：拖动条身改日期，拖动进度条改进度，均自动保存')
  }

  return (
    <div>
      <Card
        title="甘特图"
        extra={
          <Space>
            <Typography.Text type="secondary">
              {loading ? '加载中…' : `${tasks.length} 个任务，${deps.length} 条依赖`}
            </Typography.Text>
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as GanttViewMode)}
              options={[
                { label: '日', value: 'Day' },
                { label: '周', value: 'Week' },
                { label: '月', value: 'Month' },
              ]}
            />
            <Button onClick={() => void fetchData()} loading={loading}>
              刷新
            </Button>
            <Button onClick={() => navigate(`/projects/${projectId}/wbs`)}>去 WBS 编辑</Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary">
          <Tag color="blue">BR-01</Tag>
          拖动任务条修改日期 / 拖动进度条修改进度，变更将经后端校验并持久化，WBS 页同步刷新。
        </Typography.Paragraph>
        {ganttItems.length === 0 && !loading ? (
          <Typography.Text type="secondary">暂无已排期任务：请先在 WBS 页为任务设置计划日期。</Typography.Text>
        ) : null}
        <GanttView
          items={ganttItems}
          onDateChange={(taskId, start, end) => void handleDateChange(taskId, start, end)}
          onProgressChange={(taskId, progress) => void handleProgressChange(taskId, progress)}
          onTaskClick={handleTaskClick}
          readonly={saving}
        />
      </Card>
    </div>
  )
}