import { CameraOutlined } from '@ant-design/icons'
import { App, Button, Card, Empty, Segmented, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
// echarts 按需引入（P0-1）：只注册实际使用的图表/组件/渲染器，避免整包进入首屏依赖
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import type { EChartsType } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { TaskItem } from '../api/stage2'
import { listTasks } from '../api/stage2'
import type { BurndownResponse, SnapshotItem } from '../api/stage5'
import { burndown, captureSnapshot, listSnapshots } from '../api/stage5'

// 燃尽图使用折线图 + 直角坐标系（含时间轴）+ 提示框 + 图例，渲染器为 Canvas
echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

/** 日期加 N 天，返回 YYYY-MM-DD */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** to - from 的天数差（均为 YYYY-MM-DD） */
function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00`).getTime()
  const to = new Date(`${toIso}T00:00:00`).getTime()
  return Math.round((to - from) / 86400000)
}

/** 快照记录表列定义不读取任何组件状态，提到模块级：渲染间引用恒定，分页/列宽不被重置 */
const SNAPSHOT_COLUMNS: TableProps<SnapshotItem>['columns'] = [
  { title: '日期', dataIndex: 'snapshot_date', width: 120 },
  { title: '任务总数', dataIndex: 'total_tasks', width: 100 },
  { title: '已完成', dataIndex: 'completed_tasks', width: 90 },
  { title: '剩余任务', dataIndex: 'remaining_tasks', width: 100 },
  { title: '总工时', dataIndex: 'total_hours', width: 90, render: (v: number) => v.toFixed(1) },
  {
    title: '剩余工时',
    dataIndex: 'remaining_hours',
    width: 90,
    render: (v: number) => v.toFixed(1),
  },
  {
    title: '采集时间',
    dataIndex: 'captured_at',
    render: (v: string) => v.slice(0, 19).replace('T', ' '),
  },
]

/** 理想线（前端按计划日期计算，替代后端以首份快照为起点的口径） */
interface IdealLine {
  start: string
  end: string
  durationDays: number
  /** 每日理想剩余；无法绘制时为空数组 */
  points: { date: string; remaining_tasks: number; remaining_hours: number }[]
  /** 口径说明文字 */
  note: string
  /** 是否使用快照日期兜底（任务缺少计划日期） */
  fallback: boolean
}

export default function ProgressPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()
  const [data, setData] = useState<BurndownResponse | null>(null)
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([])
  const [tasks, setTasks] = useState<TaskItem[] | null>(null)
  const [metric, setMetric] = useState<'tasks' | 'hours'>('tasks')
  const [loading, setLoading] = useState(false)
  const chartRef = useRef<HTMLDivElement>(null)
  /** 图表实例：容器挂载时创建一次，指标切换只 setOption，卸载时释放 */
  const chartInstanceRef = useRef<EChartsType | null>(null)

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      // 任务列表仅用于计算理想线区间，失败不阻断燃尽图（降级为快照区间兜底）
      const [bd, snaps, taskResp] = await Promise.all([
        burndown(projectId),
        listSnapshots(projectId),
        listTasks(projectId).catch(() => null),
      ])
      setData(bd)
      setSnapshots(snaps)
      setTasks(taskResp ? taskResp.items : null)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载燃尽数据失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  /**
   * 理想线口径（BR-03 修正）：
   * - 起点 = 全部任务中最早的 plan_start；没有计划日期则用第一份快照日期兜底
   * - 终点 = 最晚的 plan_end；没有则用最近一份快照日期兜底
   * - 起始值取首份快照的总规模（任务数/总工时），按工期线性递减到 0
   */
  const idealLine = useMemo<IdealLine | null>(() => {
    if (!data || data.snapshots.length === 0) return null
    const snaps = data.snapshots
    const planStarts = (tasks ?? []).map(t => t.plan_start).filter((v): v is string => !!v)
    const planEnds = (tasks ?? []).map(t => t.plan_end).filter((v): v is string => !!v)
    const fallback = planStarts.length === 0 || planEnds.length === 0
    const start = planStarts.length ? planStarts.reduce((a, b) => (a < b ? a : b)) : snaps[0].date
    const end = planEnds.length
      ? planEnds.reduce((a, b) => (a > b ? a : b))
      : snaps[snaps.length - 1].date
    const durationDays = daysBetween(start, end)
    if (durationDays <= 0) {
      return {
        start,
        end,
        durationDays,
        points: [],
        fallback,
        note: `理想线：任务无计划日期且快照区间不足（${start} ~ ${end}），暂无法绘制理想线；可为 WBS 任务填写计划日期后重试`,
      }
    }
    const totalTasks = snaps[0].total_tasks
    const totalHours = snaps[0].total_hours
    const points: IdealLine['points'] = []
    for (let offset = 0; offset <= durationDays; offset += 1) {
      const ratio = offset / durationDays
      points.push({
        date: addDays(start, offset),
        remaining_tasks: Math.round(totalTasks * (1 - ratio) * 10) / 10,
        remaining_hours: Math.round(totalHours * (1 - ratio) * 10) / 10,
      })
    }
    const note = fallback
      ? `理想线：任务缺少计划日期，按快照区间 ${start} ~ ${end}（${durationDays} 天）线性递减估算，仅供参考`
      : `理想线：按计划工期 ${durationDays} 天线性递减（${start} ~ ${end}，起点=最早计划开始，终点=最晚计划结束）`
    return { start, end, durationDays, points, note, fallback }
  }, [data, tasks])

  /** 图表容器是否存在（无历史快照时不渲染容器，直接展示 Empty） */
  const hasChart = data !== null && data.snapshots.length > 0

  // 实例生命周期：容器挂载后 init 一次；窗口尺寸变化时 resize；容器卸载/组件卸载时 dispose
  useEffect(() => {
    const container = chartRef.current
    if (!hasChart || !container) return
    const instance = echarts.init(container)
    chartInstanceRef.current = instance
    const onResize = () => instance.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      instance.dispose()
      chartInstanceRef.current = null
    }
  }, [hasChart])

  // 数据或指标变化：复用已有实例，notMerge 覆盖旧配置，避免重建实例导致的闪动与内存增长
  useEffect(() => {
    const instance = chartInstanceRef.current
    if (!instance || !data) return
    const points = data.snapshots
    const series: Record<string, unknown>[] = []
    const idealData =
      idealLine && idealLine.points.length > 0
        ? idealLine.points.map(p => [
            p.date,
            metric === 'tasks' ? p.remaining_tasks : p.remaining_hours,
          ])
        : null
    if (metric === 'tasks') {
      series.push({
        name: '实际剩余任务数',
        type: 'line',
        data: points.map(p => [p.date, p.remaining_tasks]),
        symbol: 'circle',
        lineStyle: { width: 2 },
      })
      if (idealData) {
        series.push({
          name: '理想曲线（任务）',
          type: 'line',
          data: idealData,
          lineStyle: { type: 'dashed', opacity: 0.6 },
          symbol: 'none',
        })
      }
    } else {
      series.push({
        name: '实际剩余工时',
        type: 'line',
        data: points.map(p => [p.date, p.remaining_hours]),
        symbol: 'circle',
        lineStyle: { width: 2 },
      })
      if (idealData) {
        series.push({
          name: '理想曲线（工时）',
          type: 'line',
          data: idealData,
          lineStyle: { type: 'dashed', opacity: 0.6 },
          symbol: 'none',
        })
      }
    }
    instance.setOption(
      {
        tooltip: { trigger: 'axis' },
        legend: { data: series.map(s => String(s.name)) },
        grid: { left: 60, right: 20, top: 40, bottom: 40 },
        xAxis: { type: 'time' },
        yAxis: { type: 'value', minInterval: 1 },
        series,
      },
      true,
    )
  }, [data, metric, idealLine])

  const handleCapture = async () => {
    if (!projectId) return
    try {
      await captureSnapshot(projectId)
      message.success('快照已记录')
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '记录失败')
    }
  }

  const isEmpty = !hasChart

  return (
    <div>
      <Card
        title="进度快照与燃尽图"
        extra={
          <Space>
            <Tag color="blue">BR-03</Tag>
            <Typography.Text type="secondary">
              实际曲线仅基于真实快照，不生成虚假历史
            </Typography.Text>
            <Segmented
              value={metric}
              onChange={v => setMetric(v as 'tasks' | 'hours')}
              options={[
                { label: '任务数', value: 'tasks' },
                { label: '剩余工时', value: 'hours' },
              ]}
            />
            <Button
              type="primary"
              icon={<CameraOutlined />}
              onClick={() => void handleCapture()}
              loading={loading}
            >
              记录今日快照
            </Button>
          </Space>
        }
      >
        {isEmpty ? (
          <Empty description="暂无历史快照：点击「记录今日快照」开始采集；未记录的过去不会生成曲线（BR-03）" />
        ) : (
          <div ref={chartRef} style={{ width: '100%', height: 360 }} />
        )}
        {!isEmpty ? (
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 4 }}>
            {idealLine ? idealLine.note : '理想线：数据不足，暂未绘制'}
            ；数据更新时间：
            {snapshots[snapshots.length - 1]?.captured_at?.slice(0, 16).replace('T', ' ')}
          </Typography.Paragraph>
        ) : null}
      </Card>

      <Card title="快照记录" style={{ marginTop: 16 }}>
        <Table<SnapshotItem>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={snapshots}
          pagination={{ pageSize: 10 }}
          columns={SNAPSHOT_COLUMNS}
        />
      </Card>
    </div>
  )
}
