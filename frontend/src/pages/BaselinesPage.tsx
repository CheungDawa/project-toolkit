import { SaveOutlined } from '@ant-design/icons'
import { App, Button, Card, Drawer, Form, Input, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { Baseline, BaselineDiffRow } from '../api/stage2'
import { baselineDiff, createBaseline, listBaselines, listTasks } from '../api/stage2'

/** 本地时区今天的 YYYY-MM-DD（避免 toISOString 的 UTC 偏移问题） */
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** to - from 的天数差（均为 YYYY-MM-DD） */
function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00`).getTime()
  const to = new Date(`${toIso}T00:00:00`).getTime()
  return Math.round((to - from) / 86400000)
}

/** 偏差信息：days = 实际完成（无则按今天估算）- 基线计划完成；estimated = 是否按今天估算 */
interface DeviationInfo {
  days: number
  estimated: boolean
}

/** 任务实际信息：diff 接口的 current 不含 actual_end，需要用任务列表按 task_id 补齐 */
interface TaskActualInfo {
  actualEnd: string | null
  status: string
}

/**
 * 计算单行偏差：
 * - 当前任务已删除 / 基线无计划完成日期 → 不可比，返回 null
 * - 有实际完成日期（来自任务列表 actual_end）→ 用它与基线 plan_end 比较
 * - 无实际完成日期 → 用今天估算（estimated = true）
 */
function deviationOf(
  row: BaselineDiffRow,
  today: string,
  taskActualMap: Map<string, TaskActualInfo> | null,
): DeviationInfo | null {
  const current = row.current as Record<string, unknown>
  if (current.deleted) return null
  const baselineEnd = (row.baseline as Record<string, string | null>).plan_end
  if (!baselineEnd) return null
  const actualEnd = taskActualMap?.get(row.task_id)?.actualEnd ?? null
  const reference = actualEnd ?? today
  return { days: daysBetween(baselineEnd, reference), estimated: !actualEnd }
}

/** 偏差天数展示：正数带 + 号 */
function formatDays(days: number): string {
  return days > 0 ? `+${days}` : String(days)
}

export default function BaselinesPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [baselines, setBaselines] = useState<Baseline[]>([])
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm<{ name: string; note?: string }>()
  const [diffOpen, setDiffOpen] = useState(false)
  const [diffRows, setDiffRows] = useState<BaselineDiffRow[]>([])
  const [diffBaseline, setDiffBaseline] = useState<Baseline | null>(null)
  /** 任务 id → 实际完成日期/状态（diff 接口不含 actual_end，前端补齐） */
  const [taskActualMap, setTaskActualMap] = useState<Map<string, TaskActualInfo> | null>(null)

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      setBaselines(await listBaselines(projectId))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载基线失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const handleCreate = async () => {
    if (!projectId) return
    const values = await form.validateFields()
    try {
      const created = await createBaseline(projectId, { name: values.name, note: values.note })
      message.success(`基线「${created.name}」已保存（版本 v${created.version}）`)
      form.resetFields()
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存基线失败')
    }
  }

  const handleDiff = useCallback(
    async (baseline: Baseline) => {
      if (!projectId) return
      try {
        // 同时拉取任务列表补齐 actual_end（失败不阻断对比，仅降级为按今天估算）
        const [rows, taskResp] = await Promise.all([
          baselineDiff(projectId, baseline.id),
          listTasks(projectId).catch(() => null),
        ])
        const map = new Map<string, TaskActualInfo>()
        if (taskResp) {
          for (const t of taskResp.items) {
            map.set(t.id, { actualEnd: t.actual_end ?? null, status: t.status })
          }
        }
        setTaskActualMap(map)
        setDiffRows(rows)
        setDiffBaseline(baseline)
        setDiffOpen(true)
      } catch (err) {
        message.error(err instanceof Error ? err.message : '对比失败')
      }
    },
    [projectId, message],
  )

  const changedCount = diffRows.filter(r => r.changed).length

  /** 偏差汇总：总偏差天数 / 提前项数 / 延期项数 / 可比项数（不可比：已删除或基线缺计划日期） */
  const devSummary = useMemo(() => {
    const today = localToday()
    let total = 0
    let ahead = 0
    let delayed = 0
    let comparable = 0
    for (const row of diffRows) {
      const dev = deviationOf(row, today, taskActualMap)
      if (!dev) continue
      comparable += 1
      total += dev.days
      if (dev.days < 0) ahead += 1
      else if (dev.days > 0) delayed += 1
    }
    return { total, ahead, delayed, comparable }
  }, [diffRows, taskActualMap])

  /** 基线列表列定义：仅依赖已稳定的 handleDiff，memo 后引用恒定 */
  const baselineColumns: TableProps<Baseline>['columns'] = useMemo(
    () => [
      { title: '基线名称', dataIndex: 'name' },
      { title: '版本', dataIndex: 'version', width: 80, render: (v: number) => <Tag>v{v}</Tag> },
      {
        title: '冻结时间',
        dataIndex: 'frozen_at',
        width: 190,
        render: (v: string) => v.replace('T', ' ').slice(0, 19),
      },
      { title: '说明', dataIndex: 'note', render: (v: string | null) => v ?? '-' },
      {
        title: '操作',
        width: 120,
        render: (_: unknown, record) => (
          <Button size="small" onClick={() => void handleDiff(record)}>
            与当前计划对比
          </Button>
        ),
      },
    ],
    [handleDiff],
  )

  /** 对比表列定义：偏差列需要 taskActualMap 补齐实际完成日期，故依赖它 */
  const diffColumns: TableProps<BaselineDiffRow>['columns'] = useMemo(
    () => [
      {
        title: 'WBS',
        dataIndex: 'wbs_code',
        width: 80,
        render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
      },
      { title: '任务', dataIndex: 'name', width: 200 },
      {
        title: '基线计划起止',
        key: 'baseline',
        width: 180,
        render: (_: unknown, r) => {
          const b = r.baseline as Record<string, string | null>
          return b.plan_start && b.plan_end ? `${b.plan_start} ~ ${b.plan_end}` : '-'
        },
      },
      {
        title: '当前计划起止',
        key: 'current',
        width: 180,
        render: (_: unknown, r) => {
          const c = r.current as Record<string, string | null>
          if (c.deleted) return <Tag color="red">已删除</Tag>
          return c.plan_start && c.plan_end ? `${c.plan_start} ~ ${c.plan_end}` : '-'
        },
      },
      {
        title: '偏差天数',
        key: 'deviation',
        width: 140,
        render: (_: unknown, r) => {
          const dev = deviationOf(r, localToday(), taskActualMap)
          if (!dev) return <span style={{ color: '#c3c9d4' }}>—</span>
          const color = dev.days > 0 ? '#dc2626' : dev.days < 0 ? '#059669' : '#5b6575'
          const text = dev.days === 0 ? '0' : `${formatDays(dev.days)} 天`
          return (
            <Space size={4}>
              <span style={{ color, fontWeight: 700 }}>{text}</span>
              {dev.estimated ? (
                <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>按今天估算</Tag>
              ) : null}
            </Space>
          )
        },
      },
      {
        title: '基线进度',
        key: 'bprog',
        width: 90,
        render: (_: unknown, r) => `${(r.baseline as { progress?: number }).progress ?? '-'}%`,
      },
      {
        title: '当前进度',
        key: 'cprog',
        width: 90,
        render: (_: unknown, r) =>
          (r.current as { deleted?: boolean; progress?: number }).deleted
            ? '-'
            : `${(r.current as { progress?: number }).progress ?? '-'}%`,
      },
      {
        title: '状态',
        key: 'changed',
        width: 90,
        render: (_: unknown, r) =>
          r.changed ? <Tag color="orange">已变化</Tag> : <Tag color="green">一致</Tag>,
      },
    ],
    [taskActualMap],
  )

  return (
    <div>
      <Card title="计划基线（BR-02：基线为独立快照，不受当前计划修改影响）">
        <Form form={form} layout="inline" style={{ marginBottom: 16 }}>
          <Form.Item name="name" rules={[{ required: true, message: '请输入基线名称' }]}>
            <Input placeholder="基线名称，如：交付基线 v1" style={{ width: 240 }} />
          </Form.Item>
          <Form.Item name="note">
            <Input placeholder="说明（可选）" style={{ width: 240 }} />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => void handleCreate()}
              loading={loading}
            >
              保存当前计划为基线
            </Button>
          </Form.Item>
        </Form>

        <Table<Baseline>
          rowKey="id"
          loading={loading}
          dataSource={baselines}
          pagination={false}
          columns={baselineColumns}
        />
      </Card>

      <Drawer
        title={
          diffBaseline ? `基线对比 · ${diffBaseline.name}（v${diffBaseline.version}）` : '基线对比'
        }
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        width={960}
      >
        {diffBaseline ? (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            当前计划与基线差异：
            <Tag color={changedCount > 0 ? 'orange' : 'green'}>{changedCount} 项变化</Tag>
          </Typography.Paragraph>
        ) : null}
        {/* 偏差汇总：总偏差天数 / 提前 / 延期（不可比项：当前已删除或基线无计划完成日期） */}
        <Space wrap size={8} style={{ marginBottom: 12 }}>
          <Tag color={devSummary.total > 0 ? 'red' : devSummary.total < 0 ? 'green' : 'default'}>
            总偏差 {formatDays(devSummary.total)} 天
          </Tag>
          <Tag color="green">提前 {devSummary.ahead} 项</Tag>
          <Tag color="red">延期 {devSummary.delayed} 项</Tag>
          <Tag>可比 {devSummary.comparable} 项</Tag>
        </Space>
        <Table<BaselineDiffRow>
          rowKey="task_id"
          size="small"
          dataSource={diffRows}
          pagination={false}
          scroll={{ x: 900 }}
          columns={diffColumns}
        />
      </Drawer>
    </div>
  )
}
