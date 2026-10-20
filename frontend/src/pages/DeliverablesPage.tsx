import {
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
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
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { AttachmentItem, DeliverableItem } from '../api/stage5'
import {
  attachmentDownloadUrl,
  createDeliverable,
  deleteAttachment,
  deleteDeliverable,
  deliverableExportUrl,
  importDeliverables,
  instantiateTemplate,
  listAttachments,
  listDeliverables,
  listProjectAttachments,
  listTemplates,
  updateDeliverable,
  uploadAttachment,
} from '../api/stage5'

const CATEGORIES = ['设备到货', '安装调试', '测试', '培训', '试运行', '验收', '运维移交']
const SUBMIT_STATUS = ['未提交', '已提交', '已归档']
const REVIEW_STATUS = ['待审核', '已通过', '已驳回']
/** 可用浏览器原生能力预览的类型（后端对 inline 也做同样的白名单校验） */
const PREVIEWABLE_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp']
const OFFICE_PREVIEW_TIP = 'Office 文件请先下载后用 WPS/Office 打开（自托管环境不支持在线转换）'

const isPreviewable = (fileName: string): boolean =>
  PREVIEWABLE_EXT.includes((fileName.split('.').pop() ?? '').toLowerCase())

const formatBytes = (bytes: number): string => {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const formatTime = (value: string): string => value.slice(0, 19).replace('T', ' ')

export default function DeliverablesPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [items, setItems] = useState<DeliverableItem[]>([])
  const [templates, setTemplates] = useState<{ name: string }[]>([])
  /** 交付资料 id -> 附件列表（进入页面时按项目拉一次） */
  const [attachments, setAttachments] = useState<Record<string, AttachmentItem[]>>({})
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
      const grouped: Record<string, AttachmentItem[]> = {}
      for (const item of (await listProjectAttachments(projectId)).attachments) {
        grouped[item.deliverable_id] = [...(grouped[item.deliverable_id] ?? []), item]
      }
      setAttachments(grouped)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载交付资料失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, categoryFilter, message])

  /** 单个交付资料的附件刷新（上传/删除后调用） */
  const refreshAttachments = useCallback(async (deliverableId: string) => {
    const rows = await listAttachments(deliverableId)
    setAttachments((prev) => ({ ...prev, [deliverableId]: rows }))
  }, [])

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

  const openEdit = useCallback((item: DeliverableItem) => {
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
  }, [form])

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

  const handleDelete = useCallback(async (item: DeliverableItem) => {
    try {
      await deleteDeliverable(item.id)
      message.success('已删除')
      await fetchData()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }, [fetchData, message])

  const handleUpload = useCallback(async (item: DeliverableItem, file: File) => {
    try {
      await uploadAttachment(item.id, file)
      await refreshAttachments(item.id)
      message.success(`已上传 ${file.name}`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '上传失败')
    }
    return false
  }, [refreshAttachments, message])

  const handleDeleteAttachment = useCallback(async (deliverableId: string, attachmentId: string) => {
    try {
      await deleteAttachment(attachmentId)
      await refreshAttachments(deliverableId)
      message.success('附件已删除')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除附件失败')
    }
  }, [refreshAttachments, message])

  /** 展开行：附件清单（文件名/大小/下载/预览/删除/继续上传） */
  const renderAttachments = useCallback((item: DeliverableItem) => {
    const rows = attachments[item.id] ?? []
    return (
      <div style={{ padding: '4px 8px 8px' }}>
        <Space wrap style={{ marginBottom: 8 }}>
          <Upload showUploadList={false} beforeUpload={(file) => handleUpload(item, file)}>
            <Button size="small" icon={<UploadOutlined />}>上传附件</Button>
          </Upload>
          <Typography.Text type="secondary">
            单个附件不超过 50MB；PDF 与图片可直接预览，Office 文件请下载后本地打开
          </Typography.Text>
        </Space>
        <Table<AttachmentItem>
          rowKey="id"
          size="small"
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: '暂无附件，点击上方「上传附件」添加' }}
          columns={[
            {
              title: '文件名',
              dataIndex: 'file_name',
              render: (v: string) => (
                <Tooltip title={v}>
                  <Typography.Text style={{ maxWidth: 420 }} ellipsis>{v}</Typography.Text>
                </Tooltip>
              ),
            },
            { title: '大小', dataIndex: 'size_bytes', width: 90, render: (v: number) => formatBytes(v) },
            { title: '上传时间', dataIndex: 'uploaded_at', width: 160, render: (v: string) => formatTime(v) },
            {
              title: '操作',
              key: 'actions',
              width: 210,
              render: (_: unknown, a: AttachmentItem) => (
                <Space size={0}>
                  <Button
                    size="small"
                    type="link"
                    icon={<DownloadOutlined />}
                    onClick={() => window.open(attachmentDownloadUrl(a.id))}
                  >
                    下载
                  </Button>
                  {isPreviewable(a.file_name) ? (
                    <Button
                      size="small"
                      type="link"
                      icon={<EyeOutlined />}
                      onClick={() => window.open(attachmentDownloadUrl(a.id, true))}
                    >
                      预览
                    </Button>
                  ) : (
                    <Tooltip title={OFFICE_PREVIEW_TIP}>
                      {/* 禁用按钮不触发鼠标事件，外套 span 保证提示可悬浮 */}
                      <span>
                        <Button size="small" type="link" disabled icon={<EyeOutlined />}>预览</Button>
                      </span>
                    </Tooltip>
                  )}
                  <Popconfirm title="确认删除该附件？" onConfirm={() => void handleDeleteAttachment(item.id, a.id)}>
                    <Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </div>
    )
  }, [attachments, handleDeleteAttachment, handleUpload])

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

  /** 主表列定义：依赖附件分组（附件数）与已稳定的回调，memo 后引用仅在附件变化时更新 */
  const columns: TableProps<DeliverableItem>['columns'] = useMemo(
    () => [
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
        title: '附件',
        key: 'attachment_count',
        width: 90,
        render: (_: unknown, r) => {
          const count = (attachments[r.id] ?? []).length
          return <Tag color={count ? 'blue' : 'default'}>附件 {count}</Tag>
        },
      },
      {
        title: '操作',
        key: 'actions',
        width: 180,
        fixed: 'right',
        render: (_: unknown, r) => (
          <Space size={4} wrap={false}>
            <Upload showUploadList={false} beforeUpload={(file) => handleUpload(r, file)}>
              <Button size="small" type="link">上传</Button>
            </Upload>
            <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
            <Popconfirm title="确认删除？" onConfirm={() => void handleDelete(r)}>
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [attachments, handleDelete, handleUpload, openEdit],
  )

  /** 展开行配置：稳定对象引用，避免每次渲染都新建 expandable 导致展开行重挂载 */
  const expandable = useMemo<TableProps<DeliverableItem>['expandable']>(
    () => ({ expandedRowRender: renderAttachments }),
    [renderAttachments],
  )

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
          expandable={expandable}
          columns={columns}
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