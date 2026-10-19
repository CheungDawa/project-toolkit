import { PlusOutlined } from '@ant-design/icons'
import { App, Button, Card, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { Milestone } from '../api/stage2'
import { createMilestone, deleteMilestone, listMilestones, updateMilestone } from '../api/stage2'

/** 本地时区今天的 YYYY-MM-DD（避免 toISOString 的 UTC 偏移问题） */
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

/** 里程碑是否已完成：状态为已完成或已填实际日期均视为完成 */
function isMilestoneDone(m: Milestone): boolean {
  return m.status === '已完成' || !!m.actual_date
}

export default function MilestonesPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [items, setItems] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [form] = Form.useForm()

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      setItems(await listMilestones(projectId))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载里程碑失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (m: Milestone) => {
    setEditing(m)
    form.setFieldsValue({
      name: m.name,
      plan_date: m.plan_date,
      actual_date: m.actual_date,
      status: m.status,
      description: m.description,
    })
    setModalOpen(true)
  }

  const handleOk = async () => {
    if (!projectId) return
    const values = await form.validateFields()
    const payload = {
      name: values.name,
      plan_date: values.plan_date ? values.plan_date.format('YYYY-MM-DD') : null,
      actual_date: values.actual_date ? values.actual_date.format('YYYY-MM-DD') : null,
      status: values.status ?? null,
      description: values.description ?? null,
    }
    try {
      if (editing) {
        await updateMilestone(editing.id, payload)
        message.success('里程碑已更新')
      } else {
        await createMilestone(projectId, payload)
        message.success('里程碑已创建')
      }
      setModalOpen(false)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleDelete = async (m: Milestone) => {
    try {
      await deleteMilestone(m.id)
      message.success('里程碑已删除')
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  /** 顶部汇总：总数 / 逾期数（未完成且计划日期已过）/ 即将到期数（未完成且 7 天内到期） */
  const summary = useMemo(() => {
    const today = localToday()
    const in7 = addDays(today, 7)
    let overdue = 0
    let upcoming = 0
    let noDate = 0
    for (const m of items) {
      if (isMilestoneDone(m)) continue
      if (!m.plan_date) {
        noDate += 1
        continue
      }
      if (m.plan_date < today) overdue += 1
      else if (m.plan_date <= in7) upcoming += 1
    }
    return { total: items.length, overdue, upcoming, noDate }
  }, [items])

  /** 状态列：逾期未完成→红「逾期 N 天」；7 天内到期→橙「即将到期」；已完成→绿；其余显示原状态 */
  const renderStatus = (m: Milestone) => {
    if (isMilestoneDone(m)) return <Tag color="success">已完成</Tag>
    if (m.plan_date) {
      const today = localToday()
      const diff = daysBetween(today, m.plan_date)
      if (diff < 0) return <Tag color="red">逾期 {-diff} 天</Tag>
      if (diff <= 7) return <Tag color="orange">即将到期</Tag>
    }
    return m.status ? <Tag>{m.status}</Tag> : <span style={{ color: '#c3c9d4' }}>—</span>
  }

  /** 剩余天数列：已完成或无计划日期显示 -；负数红色（逾期）、7 天内橙色 */
  const renderRemaining = (m: Milestone) => {
    if (isMilestoneDone(m) || !m.plan_date) return <span style={{ color: '#c3c9d4' }}>—</span>
    const diff = daysBetween(localToday(), m.plan_date)
    if (diff === 0) return <span style={{ color: '#d97706', fontWeight: 600 }}>今天</span>
    if (diff < 0) return <span style={{ color: '#dc2626', fontWeight: 600 }}>{diff} 天</span>
    if (diff <= 7) return <span style={{ color: '#d97706', fontWeight: 600 }}>{diff} 天</span>
    return <span>{diff} 天</span>
  }

  return (
    <div>
      <Card
        title="里程碑"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建里程碑
          </Button>
        }
      >
        <Typography.Paragraph style={{ marginBottom: 12 }} type="secondary">
          共 <b>{summary.total}</b> 个里程碑
          {summary.overdue > 0 ? (
            <>
              ，<Typography.Text type="danger" strong> {summary.overdue} 个逾期</Typography.Text>
            </>
          ) : (
            '，无逾期'
          )}
          {summary.upcoming > 0 ? (
            <>
              ，<Typography.Text style={{ color: '#d97706' }} strong> {summary.upcoming} 个即将到期（7 天内）</Typography.Text>
            </>
          ) : null}
          {summary.noDate > 0 ? <>，{summary.noDate} 个未填计划日期</> : null}
        </Typography.Paragraph>
        <Table<Milestone>
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={false}
          columns={[
            { title: '名称', dataIndex: 'name' },
            { title: '计划日期', dataIndex: 'plan_date', render: (v: string | null) => v ?? '-' },
            { title: '实际日期', dataIndex: 'actual_date', render: (v: string | null) => v ?? '-' },
            {
              title: '剩余天数',
              key: 'remaining',
              width: 100,
              align: 'center',
              render: (_: unknown, record) => renderRemaining(record),
            },
            {
              title: '状态',
              dataIndex: 'status',
              render: (_: unknown, record) => renderStatus(record),
            },
            { title: '说明', dataIndex: 'description', render: (v: string | null) => v ?? '-' },
            {
              title: '操作',
              key: 'actions',
              width: 140,
              render: (_: unknown, record) => (
                <Space>
                  <Button size="small" onClick={() => openEdit(record)}>
                    编辑
                  </Button>
                  <Popconfirm title="确认删除该里程碑？" onConfirm={() => void handleDelete(record)}>
                    <Button size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editing ? '编辑里程碑' : '新建里程碑'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleOk()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：初验 / 终验 / 上线" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="plan_date" label="计划日期">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="actual_date" label="实际日期">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="status" label="状态">
            <Select
              allowClear
              options={['计划中', '已完成', '已延期'].map((v) => ({ value: v, label: v }))}
            />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
