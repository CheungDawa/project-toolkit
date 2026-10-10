import { PlusOutlined } from '@ant-design/icons'
import { App, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { ChangeItem } from '../api/stage3'
import { createChange, deleteChange, listChanges, updateChange } from '../api/stage3'

const APPROVAL_OPTIONS = ['草拟', '审批中', '已批准', '已驳回', '实施中', '已完成']
const APPROVAL_TAG: Record<string, string> = {
  草拟: 'default', 审批中: 'blue', 已批准: 'green', 已驳回: 'red', 实施中: 'orange', 已完成: 'purple',
}

export default function ChangesPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [items, setItems] = useState<ChangeItem[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ChangeItem | null>(null)
  const [form] = Form.useForm()

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      setItems(await listChanges(projectId))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载变更失败')
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

  const openEdit = (item: ChangeItem) => {
    setEditing(item)
    form.setFieldsValue({
      title: item.title,
      origin: item.origin,
      scope_impact: item.scope_impact,
      schedule_impact: item.schedule_impact,
      approval_status: item.approval_status,
      implementation_plan: item.implementation_plan,
      verification_result: item.verification_result,
      requested_by: item.requested_by,
    })
    setModalOpen(true)
  }

  const handleOk = async () => {
    if (!projectId) return
    const values = await form.validateFields()
    try {
      if (editing) {
        await updateChange(editing.id, values)
        message.success('变更已更新')
      } else {
        await createChange(projectId, values)
        message.success('变更已创建')
      }
      setModalOpen(false)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleDelete = async (item: ChangeItem) => {
    try {
      await deleteChange(item.id)
      message.success('变更已删除')
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <div>
      <Card
        title="变更跟踪"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建变更
          </Button>
        }
      >
        <Table<ChangeItem>
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={false}
          size="small"
          scroll={{ x: 1000 }}
          columns={[
            { title: '变更内容', dataIndex: 'title', width: 200 },
            { title: '原因', dataIndex: 'origin', render: (v: string | null) => v ?? '-' },
            { title: '范围影响', dataIndex: 'scope_impact', width: 160, render: (v: string | null) => v ?? '-' },
            { title: '工期影响', dataIndex: 'schedule_impact', width: 140, render: (v: string | null) => v ?? '-' },
            {
              title: '审批状态',
              dataIndex: 'approval_status',
              width: 110,
              render: (v: string) => <Tag color={APPROVAL_TAG[v] ?? 'default'}>{v}</Tag>,
            },
            { title: '实施计划', dataIndex: 'implementation_plan', render: (v: string | null) => v ?? '-' },
            {
              title: '操作',
              key: 'actions',
              width: 140,
              render: (_: unknown, r) => (
                <Space>
                  <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
                  <Popconfirm title="确认删除该变更？" onConfirm={() => void handleDelete(r)}>
                    <Button size="small" danger>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal title={editing ? '编辑变更' : '新建变更'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void handleOk()} width={620}>
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <Form.Item name="title" label="变更内容" rules={[{ required: true, message: '请输入变更内容' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="approval_status" label="审批状态" initialValue="草拟">
              <Select options={APPROVAL_OPTIONS.map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </div>
          <Form.Item name="origin" label="变更原因">
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="scope_impact" label="范围影响">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="schedule_impact" label="工期影响">
              <Input.TextArea rows={2} />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="implementation_plan" label="实施计划">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="verification_result" label="验证结果">
              <Input.TextArea rows={2} />
            </Form.Item>
          </div>
          <Form.Item name="requested_by" label="申请人">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}