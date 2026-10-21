import {
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import {
  type ConvertTarget,
  type RetroActionStatus,
  type RetroCategory,
  type RetroScope,
  type RetroItem,
  type RetroItemPayload,
  type RetroLinkType,
  type Retrospective,
  type RetroPayload,
  convertActionItem,
  createActionItem,
  createRetrospective,
  deleteRetrospective,
  listActionItems,
  listRetrospectives,
  updateActionItem,
  updateRetrospective,
} from '../api/retro'
import { listDeliverables, type DeliverableItem } from '../api/stage5'
import { listIssues, listRisks, type IssueItem, type RiskItem } from '../api/stage3'
import { useProjectContext } from '../hooks/useProjectContext'

const { Text, Title, Paragraph } = Typography

/** 三栏分类元信息 */
const CATEGORY_META: Record<RetroCategory, { label: string; color: string; bg: string }> = {
  good: { label: '做得好', color: '#059669', bg: '#ecfdf5' },
  improve: { label: '待改进', color: '#d97706', bg: '#fffbeb' },
  action: { label: '行动项', color: '#4f46e5', bg: '#eef2ff' },
}

/** 行动项状态元信息（与后端 RetroActionStatus 枚举对齐：open/in_progress/done/closed） */
const ACTION_STATUS_META: Record<string, { label: string; color: string }> = {
  open: { label: '待办', color: 'default' },
  in_progress: { label: '进行中', color: 'processing' },
  done: { label: '已完成', color: 'success' },
  closed: { label: '已关闭', color: 'default' },
}

/** 行动项转换目标（自动回写为任务/风险/问题） */
const CONVERT_TARGETS: { target: ConvertTarget; label: string }[] = [
  { target: 'task', label: '任务' },
  { target: 'risk', label: '风险' },
  { target: 'issue', label: '问题' },
]

/** 关联实体类型元信息 */
const LINK_TYPE_META: Record<RetroLinkType, { label: string }> = {
  risk: { label: '风险' },
  issue: { label: '问题' },
  deliverable: { label: '交付物' },
}

/** 复盘覆盖范围元信息（后端 RetroScope 枚举：phase/milestone/sprint/whole） */
const SCOPE_META: Record<RetroScope, { label: string }> = {
  phase: { label: '阶段' },
  milestone: { label: '里程碑' },
  sprint: { label: '迭代' },
  whole: { label: '项目整体' },
}

function isActionStatus(v: string | null | undefined): v is RetroActionStatus {
  return v === 'open' || v === 'in_progress' || v === 'done' || v === 'closed'
}

/** 由关联 risk/issue/deliverable 解析展示文案（依赖页面级预拉的实体映射） */
function describeLink(
  item: RetroItem,
  riskMap: Map<string, RiskItem>,
  issueMap: Map<string, IssueItem>,
  deliverableMap: Map<string, DeliverableItem>,
): string | null {
  if (!item.link_type || !item.link_id) return null
  let name = item.link_id
  if (item.link_type === 'risk') name = riskMap.get(item.link_id)?.description ?? item.link_id
  else if (item.link_type === 'issue') name = issueMap.get(item.link_id)?.title ?? item.link_id
  else if (item.link_type === 'deliverable')
    name = deliverableMap.get(item.link_id)?.name ?? item.link_id
  return `${LINK_TYPE_META[item.link_type].label}：${name}`
}

export default function RetroPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()
  const projectContext = useProjectContext(projectId)

  // ---- 复盘列表 ----
  const [retros, setRetros] = useState<Retrospective[]>([])
  const [retroLoading, setRetroLoading] = useState(false)
  const [selectedRetroId, setSelectedRetroId] = useState<string | null>(null)

  // ---- 选中复盘的条目（good/improve/action 三类） ----
  const [items, setItems] = useState<RetroItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)

  // ---- 关联实体（用于弹窗选择 & 卡片展示名称） ----
  const [risks, setRisks] = useState<RiskItem[]>([])
  const [issues, setIssues] = useState<IssueItem[]>([])
  const [deliverables, setDeliverables] = useState<DeliverableItem[]>([])

  // ---- 弹窗状态 ----
  const [retroModal, setRetroModal] = useState<{ open: boolean; editing: Retrospective | null }>({
    open: false,
    editing: null,
  })
  const [itemModal, setItemModal] = useState<{
    open: boolean
    editing: RetroItem | null
    defaultCategory: RetroCategory
  }>({ open: false, editing: null, defaultCategory: 'action' })
  const [linkModal, setLinkModal] = useState<{ open: boolean; item: RetroItem | null }>({
    open: false,
    item: null,
  })
  const [linkType, setLinkType] = useState<RetroLinkType | null>(null)
  const [linkId, setLinkId] = useState<string | null>(null)

  const [retroForm] = Form.useForm()
  const [itemForm] = Form.useForm()

  /** 复盘列表：首次/项目切换时拉取，并自动选中第一条 */
  const fetchRetros = useCallback(async () => {
    if (!projectId) return
    setRetroLoading(true)
    try {
      const list = await listRetrospectives(projectId)
      setRetros(list)
      setSelectedRetroId(prev =>
        prev && list.some(r => r.id === prev) ? prev : (list[0]?.id ?? null),
      )
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载复盘列表失败')
    } finally {
      setRetroLoading(false)
    }
  }, [projectId, message])

  /** 选中复盘的条目 */
  const fetchItems = useCallback(async () => {
    if (!projectId || !selectedRetroId) return
    setItemsLoading(true)
    try {
      setItems(await listActionItems(projectId, selectedRetroId))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载条目失败')
    } finally {
      setItemsLoading(false)
    }
  }, [projectId, selectedRetroId, message])

  /** 关联实体：一次并发拉全量，失败仅降级（不影响主流程） */
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    void (async () => {
      try {
        const [rs, iss, dels] = await Promise.all([
          listRisks(projectId),
          listIssues(projectId),
          listDeliverables(projectId),
        ])
        if (cancelled) return
        setRisks(rs)
        setIssues(iss)
        setDeliverables(dels)
      } catch {
        // 关联选择降级：主流程仍可继续
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    void fetchRetros()
  }, [fetchRetros])

  useEffect(() => {
    void fetchItems()
  }, [fetchItems])

  // 实体映射（卡片展示关联名称用）
  const riskMap = useMemo(() => new Map(risks.map(r => [r.id, r])), [risks])
  const issueMap = useMemo(() => new Map(issues.map(i => [i.id, i])), [issues])
  const deliverableMap = useMemo(() => new Map(deliverables.map(d => [d.id, d])), [deliverables])

  const selectedRetro = useMemo(
    () => retros.find(r => r.id === selectedRetroId) ?? null,
    [retros, selectedRetroId],
  )

  const grouped = useMemo(
    () => ({
      good: items.filter(i => i.category === 'good'),
      improve: items.filter(i => i.category === 'improve'),
      action: items.filter(i => i.category === 'action'),
    }),
    [items],
  )

  // ---- 复盘弹窗 ----
  const openCreateRetro = () => {
    setRetroModal({ open: true, editing: null })
    retroForm.resetFields()
    retroForm.setFieldsValue({ scope: 'whole', status: 'draft' })
  }
  const openEditRetro = (r: Retrospective) => {
    setRetroModal({ open: true, editing: r })
    retroForm.setFieldsValue({
      title: r.title,
      scope: r.scope,
      occurred_on: r.occurred_on ? dayjs(r.occurred_on) : null,
      facilitator: r.facilitator,
      participants: r.participants,
      atmosphere: r.atmosphere,
      summary: r.summary,
      status: r.status,
    })
  }
  const handleRetroOk = async () => {
    if (!projectId) return
    const v = await retroForm.validateFields()
    const payload: RetroPayload = {
      title: v.title,
      scope: v.scope ?? 'whole',
      occurred_on: v.occurred_on
        ? (v.occurred_on as dayjs.Dayjs).format('YYYY-MM-DD')
        : dayjs().format('YYYY-MM-DD'),
      facilitator: v.facilitator || null,
      participants: v.participants || null,
      atmosphere: v.atmosphere ?? null,
      summary: v.summary ?? null,
      status: v.status ?? 'draft',
    }
    try {
      if (retroModal.editing) {
        await updateRetrospective(projectId, retroModal.editing.id, payload)
        message.success('复盘已更新')
      } else {
        await createRetrospective(projectId, payload)
        message.success('复盘已创建')
      }
      setRetroModal({ open: false, editing: null })
      await fetchRetros()
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }
  const handleDeleteRetro = async (r: Retrospective) => {
    if (!projectId) return
    try {
      await deleteRetrospective(projectId, r.id)
      message.success('复盘已删除')
      setSelectedRetroId(null)
      await fetchRetros()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  // ---- 条目弹窗 ----
  const openCreateItem = (category: RetroCategory) => {
    setItemModal({ open: true, editing: null, defaultCategory: category })
    itemForm.resetFields()
    itemForm.setFieldsValue({ category, status: 'open' })
  }
  const openEditItem = (item: RetroItem) => {
    setItemModal({ open: true, editing: item, defaultCategory: item.category })
    itemForm.setFieldsValue({
      category: item.category,
      content: item.content,
      owner: item.owner,
      due_date: item.due_date ? dayjs(item.due_date) : null,
      status: item.status ?? 'open',
    })
  }
  const handleItemOk = async () => {
    if (!projectId || !selectedRetroId) return
    const v = await itemForm.validateFields()
    const category: RetroCategory = v.category ?? 'action'
    const payload: RetroItemPayload = {
      category,
      content: v.content,
      owner: v.owner || null,
      due_date: v.due_date ? (v.due_date as dayjs.Dayjs).format('YYYY-MM-DD') : null,
      status: category === 'action' && isActionStatus(v.status) ? v.status : null,
    }
    try {
      if (itemModal.editing) {
        await updateActionItem(projectId, selectedRetroId, itemModal.editing.id, payload)
        message.success('条目已更新')
      } else {
        await createActionItem(projectId, selectedRetroId, payload)
        message.success('条目已创建')
      }
      setItemModal({ open: false, editing: null, defaultCategory: 'action' })
      await fetchItems()
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  // ---- 关联弹窗 ----
  const openLink = (item: RetroItem) => {
    setLinkModal({ open: true, item })
    setLinkType(item.link_type)
    setLinkId(item.link_id)
  }
  const handleLinkOk = async () => {
    if (!projectId || !selectedRetroId || !linkModal.item) return
    try {
      await updateActionItem(projectId, selectedRetroId, linkModal.item.id, {
        link_type: linkType,
        link_id: linkId,
      })
      message.success(linkType && linkId ? '关联已更新' : '已取消关联')
      setLinkModal({ open: false, item: null })
      setLinkType(null)
      setLinkId(null)
      await fetchItems()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存关联失败')
    }
  }

  // ---- 行动项转换（自动回写） ----
  const handleConvert = useCallback(
    async (item: RetroItem, target: ConvertTarget) => {
      if (!projectId || !selectedRetroId) return
      try {
        const result = await convertActionItem(projectId, selectedRetroId, item.id, target)
        const label =
          CONVERT_TARGETS.find(t => t.target === result.entity_type)?.label ?? result.entity_type
        const ent = result.entity as Record<string, unknown>
        const name = (ent.name ?? ent.title ?? ent.id) as string
        message.success(`已转为${label}：${name}（已自动回写）`)
        await fetchItems()
      } catch (err) {
        message.error(err instanceof Error ? err.message : '转换失败')
      }
    },
    [projectId, selectedRetroId, fetchItems, message],
  )

  // ---- 条目卡片 ----
  const renderItemCard = (item: RetroItem) => {
    const isAction = item.category === 'action'
    const linkText = describeLink(item, riskMap, issueMap, deliverableMap)
    return (
      <Card
        key={item.id}
        size="small"
        style={{ marginBottom: 8, borderRadius: 10 }}
        styles={{ body: { padding: 12 } }}
      >
        <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13 }}>
          {item.content}
        </Paragraph>
        <div style={{ marginTop: 8 }}>
          <Space size={4} wrap>
            {item.owner ? <Tag color="default">负责人：{item.owner}</Tag> : null}
            {isAction && item.due_date ? <Tag color="default">截止：{item.due_date}</Tag> : null}
            {isAction && item.status && isActionStatus(item.status) ? (
              <Tag color={ACTION_STATUS_META[item.status].color}>
                {ACTION_STATUS_META[item.status].label}
              </Tag>
            ) : null}
            {linkText ? (
              <Tag icon={<LinkOutlined />} color="blue">
                {linkText}
              </Tag>
            ) : null}
          </Space>
        </div>
        <div style={{ marginTop: 10 }}>
          <Space size={4} wrap>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEditItem(item)}>
              编辑
            </Button>
            {isAction ? (
              <>
                <Button size="small" icon={<LinkOutlined />} onClick={() => openLink(item)}>
                  关联
                </Button>
                <Tooltip title="转为任务/风险/问题（自动回写新建实体）">
                  <Button size="small" icon={<SwapOutlined />}>
                    转
                  </Button>
                </Tooltip>
                <Space size={2}>
                  {CONVERT_TARGETS.map(t => (
                    <Button
                      key={t.target}
                      size="small"
                      onClick={() => void handleConvert(item, t.target)}
                    >
                      {t.label}
                    </Button>
                  ))}
                </Space>
              </>
            ) : null}
          </Space>
        </div>
      </Card>
    )
  }

  // ---- 单列渲染 ----
  const renderColumn = (category: RetroCategory) => {
    const meta = CATEGORY_META[category]
    const list = grouped[category]
    return (
      <Col xs={24} md={8} key={category}>
        <Card
          size="small"
          title={
            <Space>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: meta.color,
                  display: 'inline-block',
                }}
              />
              {meta.label}
              <Tag color={meta.color}>{list.length}</Tag>
            </Space>
          }
          extra={
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => openCreateItem(category)}
            >
              新建
            </Button>
          }
          styles={{ body: { background: meta.bg, maxHeight: 560, overflowY: 'auto' } }}
        >
          {list.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`暂无${meta.label}`} />
          ) : (
            list.map(renderItemCard)
          )}
        </Card>
      </Col>
    )
  }

  return (
    <div>
      {/* 项目信息条 */}
      <div
        style={{
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        {projectContext.project ? <Tag color="geekblue">{projectContext.project.code}</Tag> : null}
        <Title level={4} style={{ margin: 0 }}>
          {projectContext.project?.name ?? '项目'}
        </Title>
        <Text type="secondary">项目复盘</Text>
      </div>

      <Row gutter={16}>
        {/* 复盘列表（主从布局左侧） */}
        <Col xs={24} md={8} lg={7}>
          <Card
            title="复盘列表"
            extra={
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreateRetro}>
                新建复盘
              </Button>
            }
            styles={{ body: { maxHeight: 640, overflowY: 'auto', padding: 8 } }}
          >
            <Spin spinning={retroLoading}>
              {retros.length === 0 && !retroLoading ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无复盘" />
              ) : (
                retros.map(r => {
                  const active = r.id === selectedRetroId
                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelectedRetroId(r.id)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        cursor: 'pointer',
                        marginBottom: 8,
                        border: active ? '1px solid #4f46e5' : '1px solid #eceef4',
                        background: active ? '#eef2ff' : '#fff',
                        transition: 'all .15s ease',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <Text strong style={{ fontSize: 13 }}>
                          {r.title}
                        </Text>
                        <Tag color={r.status === 'published' ? 'green' : 'default'}>
                          {r.status === 'published' ? '已发布' : '草稿'}
                        </Tag>
                      </div>
                      {r.summary ? (
                        <Paragraph
                          type="secondary"
                          ellipsis={{ rows: 2 }}
                          style={{ margin: '4px 0 0', fontSize: 12 }}
                        >
                          {r.summary}
                        </Paragraph>
                      ) : null}
                      <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          onClick={e => {
                            e.stopPropagation()
                            openEditRetro(r)
                          }}
                        >
                          编辑
                        </Button>
                        <Popconfirm
                          title="确认删除该复盘？"
                          onConfirm={() => void handleDeleteRetro(r)}
                        >
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={e => e.stopPropagation()}
                          >
                            删除
                          </Button>
                        </Popconfirm>
                      </div>
                    </div>
                  )
                })
              )}
            </Spin>
          </Card>
        </Col>

        {/* 复盘看板（主从布局右侧） */}
        <Col xs={24} md={16} lg={17}>
          {selectedRetro ? (
            <div>
              <Card size="small" style={{ marginBottom: 12 }} styles={{ body: { padding: 12 } }}>
                <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                  <Space>
                    <Text strong style={{ fontSize: 15 }}>
                      {selectedRetro.title}
                    </Text>
                    <Tag>{SCOPE_META[selectedRetro.scope]?.label ?? selectedRetro.scope}</Tag>
                    {selectedRetro.occurred_on ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        发生日期：{selectedRetro.occurred_on}
                      </Text>
                    ) : null}
                  </Space>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => openEditRetro(selectedRetro)}
                  >
                    编辑复盘
                  </Button>
                </Space>
                {selectedRetro.summary ? (
                  <Paragraph
                    type="secondary"
                    style={{ margin: '8px 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}
                  >
                    {selectedRetro.summary}
                  </Paragraph>
                ) : null}
              </Card>

              <Spin spinning={itemsLoading}>
                <Row gutter={[16, 16]}>
                  {renderColumn('good')}
                  {renderColumn('improve')}
                  {renderColumn('action')}
                </Row>
              </Spin>
            </div>
          ) : (
            <Card>
              <Empty description={retroLoading ? '加载中…' : '请选择或新建一个复盘'} />
            </Card>
          )}
        </Col>
      </Row>

      {/* 复盘弹窗 */}
      <Modal
        title={retroModal.editing ? '编辑复盘' : '新建复盘'}
        open={retroModal.open}
        onCancel={() => setRetroModal({ open: false, editing: null })}
        onOk={() => void handleRetroOk()}
        destroyOnClose
        okText="保存"
        cancelText="取消"
      >
        <Form form={retroForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="如：Q3 阶段复盘" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="scope" label="覆盖范围">
              <Select
                options={[
                  { value: 'whole', label: '项目整体' },
                  { value: 'phase', label: '阶段' },
                  { value: 'milestone', label: '里程碑' },
                  { value: 'sprint', label: '迭代' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="occurred_on"
              label="发生日期"
              rules={[{ required: true, message: '请选择日期' }]}
            >
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { value: 'draft', label: '草稿' },
                  { value: 'published', label: '已发布' },
                ]}
              />
            </Form.Item>
            <Form.Item name="facilitator" label="主持人">
              <Input placeholder="可选" />
            </Form.Item>
          </div>
          <Form.Item name="participants" label="参与者">
            <Select mode="tags" placeholder="回车添加参与者" />
          </Form.Item>
          <Form.Item name="atmosphere" label="氛围">
            <Input placeholder="如：积极 / 紧张（可选）" />
          </Form.Item>
          <Form.Item name="summary" label="总结">
            <Input.TextArea rows={3} placeholder="复盘总体结论（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 条目弹窗 */}
      <Modal
        title={itemModal.editing ? '编辑条目' : '新建条目'}
        open={itemModal.open}
        onCancel={() => setItemModal({ open: false, editing: null, defaultCategory: 'action' })}
        onOk={() => void handleItemOk()}
        destroyOnClose
        okText="保存"
        cancelText="取消"
      >
        <Form form={itemForm} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item
              name="category"
              label="分类"
              rules={[{ required: true, message: '请选择分类' }]}
            >
              <Select
                options={[
                  { value: 'good', label: '做得好' },
                  { value: 'improve', label: '待改进' },
                  { value: 'action', label: '行动项' },
                ]}
              />
            </Form.Item>
            <Form.Item name="owner" label="负责人">
              <Input placeholder="可选" />
            </Form.Item>
          </div>
          <Form.Item
            name="content"
            label="内容"
            rules={[{ required: true, message: '请输入内容' }]}
          >
            <Input.TextArea rows={3} placeholder="具体描述" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="due_date" label="截止日期（行动项）">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="status" label="状态（行动项）">
              <Select
                allowClear
                options={[
                  { value: 'open', label: '待办' },
                  { value: 'in_progress', label: '进行中' },
                  { value: 'done', label: '已完成' },
                  { value: 'closed', label: '已关闭' },
                ]}
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      {/* 关联弹窗 */}
      <Modal
        title="关联风险 / 问题 / 交付物"
        open={linkModal.open}
        onCancel={() => setLinkModal({ open: false, item: null })}
        onOk={() => void handleLinkOk()}
        destroyOnClose
        okText="保存关联"
        cancelText="取消"
      >
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 8, fontSize: 13, color: '#8a919e' }}>关联类型</div>
          <Select
            style={{ width: '100%', marginBottom: 12 }}
            allowClear
            placeholder="选择关联类型"
            value={linkType}
            onChange={v => {
              setLinkType(v)
              setLinkId(null)
            }}
            options={[
              { value: 'risk', label: '风险' },
              { value: 'issue', label: '问题' },
              { value: 'deliverable', label: '交付物' },
            ]}
          />
          <div style={{ marginBottom: 8, fontSize: 13, color: '#8a919e' }}>关联对象</div>
          <Select
            style={{ width: '100%' }}
            allowClear
            placeholder={linkType ? '选择一个对象' : '请先选择关联类型'}
            disabled={!linkType}
            value={linkId}
            onChange={v => setLinkId(v)}
            options={
              linkType === 'risk'
                ? risks.map(r => ({ value: r.id, label: r.description || r.id }))
                : linkType === 'issue'
                  ? issues.map(i => ({ value: i.id, label: i.title || i.id }))
                  : linkType === 'deliverable'
                    ? deliverables.map(d => ({ value: d.id, label: d.name || d.id }))
                    : []
            }
          />
        </div>
      </Modal>
    </div>
  )
}
