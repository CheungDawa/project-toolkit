import { PlusOutlined } from '@ant-design/icons'
import { App, Button, Card, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { IssueItem } from '../api/stage3'
import { closeIssue, createIssue, deleteIssue, listIssues, updateIssue } from '../api/stage3'

const SEVERITY_TAG: Record<string, string> = { 高: 'red', 中: 'orange', 低: 'green' }

export default function IssuesPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [items, setItems] = useState<IssueItem[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [severityFilter, setSeverityFilter] = useState<string | undefined>()
  const [overdue, setOverdue] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<IssueItem | null>(null)
  const [closeOpen, setCloseOpen] = useState<IssueItem | null>(null)
  const [form] = Form.useForm()
  const [closeForm] = Form.useForm()

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      setItems(await listIssues(projectId, { status: statusFilter, severity: severityFilter, overdue: overdue || undefined }))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载问题失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, statusFilter, severityFilter, overdue, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (issue: IssueItem) => {
    setEditing(issue)
    form.setFieldsValue({
      title: issue.title,
      detail: issue.detail,
      severity: issue.severity,
      owner: issue.owner,
      due_date: issue.due_date,
      root_cause: issue.root_cause,
      solution: issue.solution,
      status: issue.status,
    })
    setModalOpen(true)
  }

  const handleOk = async () => {
    if (!projectId) return
    const values = await form.validateFields()
    const payload = { ...values }
    try {
      if (editing) {
        await updateIssue(editing.id, payload)
        message.success('问题已更新')
      } else {
        await createIssue(projectId, payload)
        message.success('问题已创建')
      }
      setModalOpen(false)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleClose = async () => {
    if (!closeOpen) return
    const values = await closeForm.validateFields()
    try {
      await closeIssue(closeOpen.id, values)
      message.success('问题已关闭')
      setCloseOpen(null)
      closeForm.resetFields()
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '关闭失败')
    }
  }

  const handleDelete = async (issue: IssueItem) => {
    try {
      await deleteIssue(issue.id)
      message.success('问题已删除')
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <div>
      <Card
        title="问题台账"
        extra={
          <Space wrap>
            <Select placeholder="状态" allowClear style={{ width: 110 }} options={['待处理', '处理中', '已关闭'].map((v) => ({ value: v, label: v }))} onChange={setStatusFilter} />
            <Select placeholder="严重度" allowClear style={{ width: 110 }} options={['高', '中', '低'].map((v) => ({ value: v, label: v }))} onChange={setSeverityFilter} />
            <Button type={overdue ? 'primary' : 'default'} danger={overdue} onClick={() => setOverdue((v) => !v)}>仅逾期</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建问题</Button>
          </Space>
        }
      >
        <Table<IssueItem>
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={false}
          size="small"
          scroll={{ x: 1000 }}
          columns={[
            { title: '标题', dataIndex: 'title', width: 220 },
            { title: '严重度', dataIndex: 'severity', width: 90, render: (v: string | null) => (v ? <Tag color={SEVERITY_TAG[v] ?? 'default'}>{v}</Tag> : '-') },
            { title: '负责人', dataIndex: 'owner', width: 90, render: (v: string | null) => v ?? '-' },
            { title: '要求解决日期', dataIndex: 'due_date', width: 120, render: (v: string | null) => v ?? '-' },
            { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={v === '已关闭' ? 'green' : 'blue'}>{v}</Tag> },
            { title: '关闭结论', dataIndex: 'closure_result', render: (v: string | null) => v ?? '-' },
            {
              title: '操作',
              key: 'actions',
              width: 180,
              render: (_: unknown, r) => (
                <Space size="small">
                  <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
                  {r.status !== '已关闭' ? (
                    <Button size="small" type="primary" ghost onClick={() => { setCloseOpen(r); closeForm.resetFields() }}>关闭</Button>
                  ) : null}
                  <Popconfirm title="确认删除该问题？" onConfirm={() => void handleDelete(r)}>
                    <Button size="small" danger>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal title={editing ? '编辑问题' : '新建问题'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void handleOk()} width={600}>
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="title" label="问题标题" rules={[{ required: true, message: '请输入问题标题' }]}>
            <Input />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="severity" label="严重度">
              <Select allowClear options={['高', '中', '低'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="owner" label="负责人">
              <Input />
            </Form.Item>
            <Form.Item name="due_date" label="要求解决日期">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="detail" label="问题详情/影响">
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="root_cause" label="原因分析">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="solution" label="处理措施">
              <Input.TextArea rows={2} />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal title="关闭问题（必须填写解决结果）" open={!!closeOpen} onCancel={() => setCloseOpen(null)} onOk={() => void handleClose()} destroyOnClose>
        <Form form={closeForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="closure_result" label="解决结果" rules={[{ required: true, message: '关闭问题必须填写解决结果' }]}>
            <Input.TextArea rows={3} placeholder="说明解决与验证结果" />
          </Form.Item>
          <Form.Item name="verified_by" label="验证人">
            <Input placeholder="验证人" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}