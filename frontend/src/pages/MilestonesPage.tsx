import { PlusOutlined } from '@ant-design/icons'
import { App, Button, Card, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { Milestone } from '../api/stage2'
import { createMilestone, deleteMilestone, listMilestones, updateMilestone } from '../api/stage2'

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
              title: '状态',
              dataIndex: 'status',
              render: (v: string | null) =>
                v ? <Tag color={v === '已完成' ? 'green' : 'default'}>{v}</Tag> : '-',
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