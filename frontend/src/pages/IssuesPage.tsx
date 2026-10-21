import { PlusOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
} from 'antd'
import type { TableProps } from 'antd'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import type { IssueItem } from '../api/stage3'
import { closeIssue, createIssue, deleteIssue, listIssues, updateIssue } from '../api/stage3'
import ExportMenu from '../components/ExportMenu'
import { useProjectContext } from '../hooks/useProjectContext'
import type { ReportConfig } from '../utils/reportHtml'
import { tableReport } from '../utils/reportBuilders'

const SEVERITY_TAG: Record<string, string> = { 高: 'red', 中: 'orange', 低: 'green' }
const CLOSED_STATUS = '已关闭'
/** 久拖阈值：> 7 天橙色提醒，> 14 天红色预警 */
const WARN_DAYS = 7
const DANGER_DAYS = 14

/**
 * 计算问题停留天数（按自然日）。
 * 未关闭 = 今天 − 创建日；已关闭 = 关闭/验证日 − 创建日。
 * 后端 Issue 模型无 closed_at 字段，关闭时写入 verified_at（backend/app/api/issues.py:91），
 * 缺失时回退到 updated_at；日期缺失返回 null。
 */
function stayDays(issue: IssueItem): number | null {
  const start = dayjs(issue.created_at)
  if (!start.isValid()) return null
  const end =
    issue.status === CLOSED_STATUS ? dayjs(issue.verified_at ?? issue.updated_at) : dayjs()
  if (!end.isValid()) return null
  const days = end.startOf('day').diff(start.startOf('day'), 'day')
  return days >= 0 ? days : null
}

/** 未关闭且停留超过阈值的天数着色 */
function stayColor(days: number): string {
  if (days > DANGER_DAYS) return 'red'
  if (days > WARN_DAYS) return 'orange'
  return 'green'
}

export default function IssuesPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { message } = App.useApp()

  const [items, setItems] = useState<IssueItem[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [severityFilter, setSeverityFilter] = useState<string | undefined>()
  const [overdue, setOverdue] = useState(false)
  // keyword = 输入框当前值（受控），search = 已提交的搜索词（后端 q 参数，匹配标题/详情）
  const [keyword, setKeyword] = useState<string>('')
  const [search, setSearch] = useState<string>('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<IssueItem | null>(null)
  const [closeOpen, setCloseOpen] = useState<IssueItem | null>(null)
  const [form] = Form.useForm()
  const [closeForm] = Form.useForm()

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      setItems(
        await listIssues(projectId, {
          status: statusFilter,
          severity: severityFilter,
          overdue: overdue || undefined,
          q: search || undefined,
        }),
      )
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载问题失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, statusFilter, severityFilter, overdue, search, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // 顶部汇总：未关闭条数 / 其中逾期（超过要求解决日期）/ 久拖（停留 > 14 天）
  const openItems = items.filter(i => i.status !== CLOSED_STATUS)
  const overdueItems = openItems.filter(
    i => !!i.due_date && dayjs(i.due_date).isBefore(dayjs(), 'day'),
  )
  const stalledItems = openItems.filter(i => {
    const days = stayDays(i)
    return days !== null && days > DANGER_DAYS
  })

  const projectContext = useProjectContext(projectId)

  /** 分享导出：干净 HTML 问题台账（含停留天数，与页面口径一致） */
  const buildShareReport = (): ReportConfig =>
    tableReport({
      title: `${projectContext.project?.name ?? '项目'} · 问题台账`,
      subtitle: '停留天数 = 今天 − 创建日（已关闭 = 关闭/验证日 − 创建日）',
      meta: `共 ${items.length} 项问题（未关闭 ${openItems.length} · 逾期 ${overdueItems.length} · 久拖 ${stalledItems.length}） · 生成日期 ${new Date().toISOString().slice(0, 10)}`,
      columns: [
        { key: 'title', header: '标题', align: 'left' },
        { key: 'severity', header: '严重度', align: 'center', width: 80 },
        { key: 'owner', header: '负责人', align: 'center', width: 90 },
        { key: 'due', header: '要求解决日期', align: 'center', width: 120 },
        { key: 'stay', header: '停留天数', align: 'center', width: 110 },
        { key: 'status', header: '状态', align: 'center', width: 90 },
        { key: 'closure', header: '关闭结论', align: 'left', width: 180 },
      ],
      rows: items.map(r => {
        const days = stayDays(r)
        return {
          title: r.title,
          severity: r.severity ?? '—',
          owner: r.owner ?? '—',
          due: r.due_date ?? '—',
          stay: days === null ? '—' : `${days} 天${r.status === CLOSED_STATUS ? '（已闭环）' : ''}`,
          status: r.status,
          closure: r.closure_result ?? '—',
        }
      }),
      emptyText: '暂无问题',
    })

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = useCallback(
    (issue: IssueItem) => {
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
    },
    [form],
  )

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

  const handleDelete = useCallback(
    async (issue: IssueItem) => {
      try {
        await deleteIssue(issue.id)
        message.success('问题已删除')
        await fetchData()
      } catch (err) {
        message.error(err instanceof Error ? err.message : '删除失败')
      }
    },
    [fetchData, message],
  )

  /** 列定义依赖的渲染函数/回调均已稳定（useCallback），memo 后引用仅在真正变化时更新 */
  const columns: TableProps<IssueItem>['columns'] = useMemo(
    () => [
      { title: '标题', dataIndex: 'title', width: 220 },
      {
        title: '严重度',
        dataIndex: 'severity',
        width: 90,
        render: (v: string | null) =>
          v ? <Tag color={SEVERITY_TAG[v] ?? 'default'}>{v}</Tag> : '-',
      },
      {
        title: '负责人',
        dataIndex: 'owner',
        width: 90,
        render: (v: string | null) => v ?? '-',
      },
      {
        title: '要求解决日期',
        dataIndex: 'due_date',
        width: 120,
        render: (v: string | null) => v ?? '-',
      },
      {
        title: (
          <Tooltip title="未关闭 = 今天 − 创建日；已关闭 = 关闭（验证）时间 − 创建日">
            停留天数 <QuestionCircleOutlined />
          </Tooltip>
        ),
        key: 'stay',
        width: 130,
        sorter: (a, b) => (stayDays(a) ?? -1) - (stayDays(b) ?? -1),
        render: (_: unknown, r) => {
          const days = stayDays(r)
          if (days === null) return '-'
          if (r.status === CLOSED_STATUS) return <Tag>{days} 天（已闭环）</Tag>
          return <Tag color={stayColor(days)}>{days} 天</Tag>
        },
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 200,
        render: (v: string, r) => {
          const days = stayDays(r)
          const stalled = v !== CLOSED_STATUS && days !== null && days > WARN_DAYS
          return (
            <Space size={4} wrap>
              <Tag color={v === CLOSED_STATUS ? 'green' : 'blue'}>{v}</Tag>
              {stalled ? <Tag color={stayColor(days as number)}>已停留 {days} 天</Tag> : null}
            </Space>
          )
        },
      },
      {
        title: '关闭结论',
        dataIndex: 'closure_result',
        render: (v: string | null) => v ?? '-',
      },
      {
        title: '操作',
        key: 'actions',
        width: 180,
        render: (_: unknown, r) => (
          <Space size="small">
            <Button size="small" onClick={() => openEdit(r)}>
              编辑
            </Button>
            {r.status !== CLOSED_STATUS ? (
              <Button
                size="small"
                type="primary"
                ghost
                onClick={() => {
                  setCloseOpen(r)
                  closeForm.resetFields()
                }}
              >
                关闭
              </Button>
            ) : null}
            <Popconfirm title="确认删除该问题？" onConfirm={() => void handleDelete(r)}>
              <Button size="small" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [closeForm, handleDelete, openEdit],
  )

  return (
    <div>
      <Card
        title="问题台账"
        extra={
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="搜索标题 / 详情"
              style={{ width: 180 }}
              value={keyword}
              onChange={e => {
                const next = e.target.value
                setKeyword(next)
                // 清空（含点击清除图标）时立即恢复全量，无需再点一次搜索
                if (next === '') setSearch('')
              }}
              onSearch={value => setSearch(value.trim())}
            />
            <Select
              placeholder="状态"
              allowClear
              style={{ width: 110 }}
              options={['待处理', '处理中', '已关闭'].map(v => ({ value: v, label: v }))}
              onChange={setStatusFilter}
            />
            <Select
              placeholder="严重度"
              allowClear
              style={{ width: 110 }}
              options={['高', '中', '低'].map(v => ({ value: v, label: v }))}
              onChange={setSeverityFilter}
            />
            <Button
              type={overdue ? 'primary' : 'default'}
              danger={overdue}
              onClick={() => setOverdue(v => !v)}
            >
              仅逾期
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建问题
            </Button>
            <ExportMenu resource="issues" projectId={projectId} shareReport={buildShareReport} />
          </Space>
        }
      >
        <Card size="small" style={{ marginBottom: 12 }}>
          <Space size="large" wrap>
            <Statistic title="未关闭问题（当前筛选结果）" value={openItems.length} suffix="条" />
            <Statistic
              title="其中逾期（超过要求解决日期）"
              value={overdueItems.length}
              suffix="条"
              valueStyle={{ color: overdueItems.length > 0 ? '#cf1322' : undefined }}
            />
            <Statistic
              title={`久拖未决（已停留 > ${DANGER_DAYS} 天）`}
              value={stalledItems.length}
              suffix="条"
              valueStyle={{ color: stalledItems.length > 0 ? '#cf1322' : undefined }}
            />
          </Space>
          <div style={{ marginTop: 8, fontSize: 12, color: '#8c8c8c' }}>
            停留天数口径：未关闭 = 今天 − 创建日；已关闭 = 关闭（验证）时间 − 创建日（后端无
            closed_at 字段，关闭时间取 verified_at，缺失回退 updated_at）
          </div>
        </Card>
        <Table<IssueItem>
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={false}
          size="small"
          scroll={{ x: 1100 }}
          onRow={record => {
            const days = stayDays(record)
            const stalled = record.status !== CLOSED_STATUS && days !== null && days > DANGER_DAYS
            return stalled ? { style: { background: '#fff1f0' } } : {}
          }}
          columns={columns}
        />
      </Card>

      <Modal
        title={editing ? '编辑问题' : '新建问题'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleOk()}
        width={600}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="title"
            label="问题标题"
            rules={[{ required: true, message: '请输入问题标题' }]}
          >
            <Input />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="severity" label="严重度">
              <Select allowClear options={['高', '中', '低'].map(v => ({ value: v, label: v }))} />
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

      <Modal
        title="关闭问题（必须填写解决结果）"
        open={!!closeOpen}
        onCancel={() => setCloseOpen(null)}
        onOk={() => void handleClose()}
        destroyOnClose
      >
        <Form form={closeForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="closure_result"
            label="解决结果"
            rules={[{ required: true, message: '关闭问题必须填写解决结果' }]}
          >
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
