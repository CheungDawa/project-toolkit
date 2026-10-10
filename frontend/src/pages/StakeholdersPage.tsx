import { MessageOutlined, PlusOutlined } from '@ant-design/icons'
import { App, Button, Card, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { StakeholderItem } from '../api/stage3'
import {
  createCommunication,
  createStakeholder,
  deleteStakeholder,
  listCommunications,
  listStakeholders,
  updateStakeholder,
} from '../api/stage3'

export default function StakeholdersPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [items, setItems] = useState<StakeholderItem[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<StakeholderItem | null>(null)
  const [form] = Form.useForm()
  const [commOpen, setCommOpen] = useState<StakeholderItem | null>(null)
  const [comms, setComms] = useState<unknown[]>([])
  const [commForm] = Form.useForm()

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      setItems(await listStakeholders(projectId))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载干系人失败')
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

  const openEdit = (item: StakeholderItem) => {
    setEditing(item)
    form.setFieldsValue({
      person_type: item.person_type,
      name: item.name,
      org: item.org,
      role: item.role,
      sub_pos: item.sub_pos,
      influence: item.influence,
      interest: item.interest,
      priority: item.priority,
      demands: item.demands,
      strategy: item.strategy,
      comm_frequency: item.comm_frequency,
      participation: item.participation,
      contact_phone: item.contact_phone,
      contact_wechat: item.contact_wechat,
      contact_email: item.contact_email,
    })
    setModalOpen(true)
  }

  const handleOk = async () => {
    if (!projectId) return
    const values = await form.validateFields()
    try {
      if (editing) {
        await updateStakeholder(editing.id, values)
        message.success('干系人已更新')
      } else {
        await createStakeholder(projectId, values)
        message.success('干系人已登记')
      }
      setModalOpen(false)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleDelete = async (item: StakeholderItem) => {
    try {
      await deleteStakeholder(item.id)
      message.success('干系人已删除')
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const openComms = async (item: StakeholderItem) => {
    setCommOpen(item)
    setComms(await listCommunications(item.id))
    commForm.resetFields()
  }

  const handleAddComm = async () => {
    if (!commOpen) return
    const values = await commForm.validateFields()
    try {
      await createCommunication(commOpen.id, values)
      message.success('沟通记录已添加')
      commForm.resetFields()
      setComms(await listCommunications(commOpen.id))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  return (
    <div>
      <Card
        title="干系人管理"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            登记干系人
          </Button>
        }
      >
        <Table<StakeholderItem>
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={false}
          size="small"
          scroll={{ x: 1200 }}
          columns={[
            {
              title: '干系人',
              dataIndex: 'name',
              width: 150,
              render: (v: string, r) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{v}</div>
                  {r.sub_pos ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.sub_pos}</Typography.Text> : null}
                </div>
              ),
            },
            { title: '单位', dataIndex: 'org', width: 170, render: (v: string | null) => v ?? '-' },
            { title: '角色', dataIndex: 'role', width: 130, render: (v: string | null) => v ?? '-' },
            {
              title: '优先级',
              dataIndex: 'priority',
              width: 80,
              render: (v: string | null) =>
                v ? <Tag color={v === 'P0' ? 'red' : v === 'P1' ? 'orange' : 'default'}>{v}</Tag> : '-',
            },
            {
              title: '影响力/关注度',
              key: 'matrix',
              width: 120,
              render: (_: unknown, r) => (
                <Tag color={r.influence >= 4 ? 'red' : r.interest >= 4 ? 'orange' : 'default'}>
                  {r.influence} / {r.interest}
                </Tag>
              ),
            },
            {
              title: '参与程度',
              dataIndex: 'participation',
              width: 170,
              render: (v: string | null) => v ?? '-',
            },
            { title: '诉求', dataIndex: 'demands', render: (v: string | null) => v ?? '-' },
            {
              title: '沟通计划',
              dataIndex: 'comm_frequency',
              width: 130,
              render: (v: string | null) => v ?? '-',
            },
            {
              title: '联系方式',
              key: 'contact',
              width: 150,
              render: (_: unknown, r) => (
                <div style={{ fontSize: 12 }}>
                  {r.contact_phone ? <div>📱 {r.contact_phone}</div> : null}
                  {r.contact_wechat ? <div>💬 {r.contact_wechat}</div> : null}
                  {r.contact_email ? <div>✉️ {r.contact_email}</div> : null}
                  {!r.contact_phone && !r.contact_wechat && !r.contact_email ? '-' : null}
                </div>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 200,
              fixed: 'right',
              render: (_: unknown, r) => (
                <Space size="small">
                  <Button size="small" icon={<MessageOutlined />} onClick={() => void openComms(r)}>
                    沟通
                  </Button>
                  <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
                  <Popconfirm title="确认删除该干系人？" onConfirm={() => void handleDelete(r)}>
                    <Button size="small" danger>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal title={editing ? '编辑干系人' : '登记干系人'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void handleOk()} width={640}>
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="org" label="单位">
              <Input />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="role" label="角色">
              <Input placeholder="职位角色" />
            </Form.Item>
            <Form.Item name="sub_pos" label="角色分类">
              <Input placeholder="决策层/管理层/执行层" />
            </Form.Item>
            <Form.Item name="priority" label="优先级">
              <Select allowClear options={['P0', 'P1', 'P2'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="influence" label="影响力(1-5)" initialValue={3}>
              <InputNumber min={1} max={5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="interest" label="关注度(1-5)" initialValue={3}>
              <InputNumber min={1} max={5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="comm_frequency" label="沟通计划">
              <Select allowClear mode="multiple" options={['日报', '周报', '月度远程会议', '线下会议', '按里程碑', '不定期'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </div>
          <Form.Item name="participation" label="参与程度（如：支持（当前）；领导（期望））">
            <Input placeholder="不知晓/抵制/中立/支持/领导 ×（当前/期望）" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="contact_phone" label="电话">
              <Input />
            </Form.Item>
            <Form.Item name="contact_wechat" label="微信">
              <Input />
            </Form.Item>
            <Form.Item name="contact_email" label="邮箱">
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="demands" label="诉求">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="strategy" label="沟通策略">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer title={commOpen ? `沟通历史 · ${commOpen.name}` : '沟通历史'} open={!!commOpen} onClose={() => setCommOpen(null)} width={560}>
        <Table
          rowKey="id"
          size="small"
          dataSource={comms as Record<string, unknown>[]}
          pagination={false}
          columns={[
            { title: '日期', dataIndex: 'comm_date', width: 100, render: (v: string | null) => v ?? '-' },
            { title: '渠道', dataIndex: 'channel', width: 80, render: (v: string | null) => v ?? '-' },
            { title: '内容/结论', key: 'content', render: (_: unknown, r) => `${r.content ?? ''}${r.conclusion ? `（结论：${r.conclusion}）` : ''}` },
            { title: '后续行动', dataIndex: 'follow_up_action', render: (v: string | null) => v ?? '-' },
          ]}
        />
        <Form form={commForm} layout="vertical" style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="comm_date" label="沟通日期">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="channel" label="渠道">
              <Select allowClear options={['电话', '微信', '邮件', '会议', '现场'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </div>
          <Form.Item name="content" label="沟通内容">
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="conclusion" label="结论">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="follow_up_action" label="后续行动">
              <Input.TextArea rows={2} />
            </Form.Item>
          </div>
          <Button type="primary" onClick={() => void handleAddComm()}>记录沟通</Button>
        </Form>
      </Drawer>
    </div>
  )
}