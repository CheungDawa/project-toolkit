import { SaveOutlined } from '@ant-design/icons'
import { App, Button, Card, Drawer, Form, Input, Space, Table, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { Baseline, BaselineDiffRow } from '../api/stage2'
import { baselineDiff, createBaseline, listBaselines } from '../api/stage2'

export default function BaselinesPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [baselines, setBaselines] = useState<Baseline[]>([])
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm<{ name: string; note?: string }>()
  const [diffOpen, setDiffOpen] = useState(false)
  const [diffRows, setDiffRows] = useState<BaselineDiffRow[]>([])
  const [diffBaseline, setDiffBaseline] = useState<Baseline | null>(null)

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

  const handleDiff = async (baseline: Baseline) => {
    if (!projectId) return
    try {
      setDiffRows(await baselineDiff(projectId, baseline.id))
      setDiffBaseline(baseline)
      setDiffOpen(true)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '对比失败')
    }
  }

  const changedCount = diffRows.filter((r) => r.changed).length

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
            <Button type="primary" icon={<SaveOutlined />} onClick={() => void handleCreate()} loading={loading}>
              保存当前计划为基线
            </Button>
          </Form.Item>
        </Form>

        <Table<Baseline>
          rowKey="id"
          loading={loading}
          dataSource={baselines}
          pagination={false}
          columns={[
            { title: '基线名称', dataIndex: 'name' },
            { title: '版本', dataIndex: 'version', width: 80, render: (v: number) => <Tag>v{v}</Tag> },
            { title: '冻结时间', dataIndex: 'frozen_at', width: 190, render: (v: string) => v.replace('T', ' ').slice(0, 19) },
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
          ]}
        />
      </Card>

      <Drawer
        title={diffBaseline ? `基线对比 · ${diffBaseline.name}（v${diffBaseline.version}）` : '基线对比'}
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        width={880}
      >
        {diffBaseline ? (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            当前计划与基线差异：<Tag color={changedCount > 0 ? 'orange' : 'green'}>{changedCount} 项变化</Tag>
          </Typography.Paragraph>
        ) : null}
        <Table<BaselineDiffRow>
          rowKey="task_id"
          size="small"
          dataSource={diffRows}
          pagination={false}
          scroll={{ x: 800 }}
          columns={[
            { title: 'WBS', dataIndex: 'wbs_code', width: 80, render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
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
          ]}
        />
      </Drawer>
    </div>
  )
}