import {
  DownloadOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { DeliverableItem } from '../api/stage5'
import {
  createDeliverable,
  deleteDeliverable,
  deliverableExportUrl,
  importDeliverables,
  instantiateTemplate,
  listDeliverables,
  listTemplates,
  updateDeliverable,
  uploadAttachment,
} from '../api/stage5'

const CATEGORIES = ['设备到货', '安装调试', '测试', '培训', '试运行', '验收', '运维移交']
const SUBMIT_STATUS = ['未提交', '已提交', '已归档']
const REVIEW_STATUS = ['待审核', '已通过', '已驳回']

export default function DeliverablesPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [items, setItems] = useState<DeliverableItem[]>([])
  const [templates, setTemplates] = useState<{ name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<DeliverableItem | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>()
  const [form] = Form.useForm()

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      setItems(await listDeliverables(projectId, { category: categoryFilter }))
      setTemplates((await listTemplates()).templates)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载交付资料失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, categoryFilter, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const instantiate = async (templateName: string) => {
    if (!projectId) return
    try {
      const r = await instantiateTemplate(projectId, templateName)
      message.success(`已按模板生成 ${r.created} 条交付资料`)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '实例化模板失败')
    }
  }

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (item: DeliverableItem) => {
    setEditing(item)
    form.setFieldsValue({
      category: item.category,
      name: item.name,
      owner: item.owner,
      plan_date: item.plan_date,
      submit_status: item.submit_status,
      review_status: item.review_status,
      note: item.note,
    })
    setModalOpen(true)
  }

  const handleOk = async () => {
    if (!projectId) return
    const values = await form.validateFields()
    try {
      if (editing) {
        await updateDeliverable(editing.id, values)
        message.success('交付资料已更新')
      } else {
        await createDeliverable(projectId, values)
        message.success('交付资料已创建')
      }
      setModalOpen(false)
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleDelete = async (item: DeliverableItem) => {
    try {
      await deleteDeliverable(item.id)
      message.success('已删除')
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const handleUpload = async (item: DeliverableItem, file: File) => {
    try {
      await uploadAttachment(item.id, file)
      message.success(`已上传 ${file.name}`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '上传失败')
    }
    return false
  }

  const handleImport = async (file: File) => {
    if (!projectId) return false
    try {
      const r = await importDeliverables(projectId, file)
      message.success(r.errors.length ? `导入 ${r.created} 条，失败 ${r.errors.length} 条（详见提示）` : `导入成功 ${r.created} 条`)
      if (r.errors.length) {
        message.warning(`错误行：${r.errors.slice(0, 5).map((e) => `第${e.row}行 ${e.message}`).join('；')}`)
      }
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导入失败')
    }
    return false
  }

  return (
    <div>
      <Card
        title="交付资料清单"
        extra={
          <Space wrap>
            <Select
              placeholder="模板"
              style={{ width: 200 }}
              options={templates.map((t) => ({ value: t.name, label: t.name }))}
              onChange={(v) => void instantiate(String(v))}
            />
            <Button icon={<DownloadOutlined />} onClick={() => window.open(deliverableExportUrl(projectId!))}>
              导出
            </Button>
            <Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => handleImport(file)}>
              <Button icon={<UploadOutlined />}>导入</Button>
            </Upload>
            <Select
              placeholder="类别筛选"
              allowClear
              style={{ width: 130 }}
              options={CATEGORIES.map((v) => ({ value: v, label: v }))}
              onChange={setCategoryFilter}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增
            </Button>
          </Space>
        }
      >
        <Table<DeliverableItem>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={items}
          pagination={false}
          scroll={{ x: 1000 }}
          columns={[
            { title: '类别', dataIndex: 'category', width: 100, render: (v: string | null) => (v ? <Tag>{v}</Tag> : '-') },
            { title: '资料名称', dataIndex: 'name', width: 200 },
            { title: '责任人', dataIndex: 'owner', width: 90, render: (v: string | null) => v ?? '-' },
            { title: '计划完成', dataIndex: 'plan_date', width: 110, render: (v: string | null) => v ?? '-' },
            {
              title: '提交状态',
              dataIndex: 'submit_status',
              width: 100,
              render: (v: string) => <Tag color={v === '已提交' ? 'blue' : 'default'}>{v}</Tag>,
            },
            {
              title: '审核状态',
              dataIndex: 'review_status',
              width: 100,
              render: (v: string) => <Tag color={v === '已通过' ? 'green' : v === '已驳回' ? 'red' : 'default'}>{v}</Tag>,
            },
            { title: '备注', dataIndex: 'note', render: (v: string | null) => v ?? '-' },
            {
              title: '操作',
              key: 'actions',
              width: 190,
              render: (_: unknown, r) => (
                <Space size="small" wrap>
                  <Upload showUploadList={false} beforeUpload={(file) => handleUpload(r, file)}>
                    <Button size="small" type="link">上传附件</Button>
                  </Upload>
                  <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
                  <Popconfirm title="确认删除？" onConfirm={() => void handleDelete(r)}>
                    <Button size="small" danger>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal title={editing ? '编辑交付资料' : '新增交付资料'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void handleOk()} width={560}>
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <Form.Item name="category" label="类别">
              <Select allowClear options={CATEGORIES.map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="name" label="资料名称" rules={[{ required: true, message: '请输入资料名称' }]}>
              <Input />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="owner" label="责任人">
              <Input />
            </Form.Item>
            <Form.Item name="plan_date" label="计划完成日期">
              <Input placeholder="YYYY-MM-DD" />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="submit_status" label="提交状态" initialValue="未提交">
              <Select options={SUBMIT_STATUS.map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="review_status" label="审核状态" initialValue="待审核">
              <Select options={REVIEW_STATUS.map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </div>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}