import { FileWordOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Row,
  Segmented,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import ExportMenu from '../components/ExportMenu'
import { api } from '../api/client'
import { weeklyText } from '../api/stage5'

const { Text, Title, Paragraph } = Typography

type PeriodType = 'daily' | 'weekly' | 'monthly'

// ---- 报告接口数据结构（对接后端 GET /api/projects/{id}/reports?period_type=...） ----
interface ReportTask {
  id: string
  name: string
  owner: string | null
  status: string | null
  progress: number
  plan_start: string | null
  plan_end: string | null
}
interface ReportMilestone {
  id: string
  name: string
  plan_date: string | null
  actual_date: string | null
  status: string | null
}
interface ReportRisk {
  id: string
  description: string
  level: string | null
  owner: string | null
  status: string
}
interface ReportIssue {
  id: string
  title: string
  severity: string | null
  owner: string | null
  status: string
}
interface ReportDeliverable {
  id: string
  name: string
  owner: string | null
  submit_status: string
  review_status: string
}
interface ReportTodoItem {
  id: string
  name: string
  date: string | null
}
interface ReportOverviewTodos {
  milestones: ReportTodoItem[]
  tasks: ReportTodoItem[]
  deliverables: ReportTodoItem[]
}
interface ReportKpi {
  total: number
  done: number
  doing: number
  overdue: number
  progress_pct: number
  risk_open: number
  high_risk: number
  issue_open: number
}
/**
 * 后端 /api/projects/{id}/reports 返回结构（build_report 为平铺结构，无 meta/sections 包裹）。
 * 字段与 backend/app/services/report_service.py:build_report 一一对应。
 */
interface ReportResponse {
  project_id: string
  period_type: PeriodType
  start: string
  end: string
  generated_at: string
  text: string
  tasks: ReportTask[]
  milestones: ReportMilestone[]
  open_risks: ReportRisk[]
  open_issues: ReportIssue[]
  deliverables: ReportDeliverable[]
  overview_todos: ReportOverviewTodos
  kpi: ReportKpi
}

/** 自然周（周一~周日）：以周一为起点，修正 dayjs 默认周日起点 */
function startOfWeekMonday(d: Dayjs): Dayjs {
  const dow = d.day()
  const diff = dow === 0 ? -6 : dow - 1
  return d.subtract(diff, 'day').startOf('day')
}

/** 由周期类型 + 选择器值推导 [start, end]（ISO 日期） */
function computeRange(type: PeriodType, value: Dayjs): { start: string; end: string } {
  if (type === 'daily') {
    const s = value.format('YYYY-MM-DD')
    return { start: s, end: s }
  }
  if (type === 'weekly') {
    const start = startOfWeekMonday(value)
    return { start: start.format('YYYY-MM-DD'), end: start.add(6, 'day').format('YYYY-MM-DD') }
  }
  return {
    start: value.startOf('month').format('YYYY-MM-DD'),
    end: value.endOf('month').format('YYYY-MM-DD'),
  }
}

/** 周期默认选择器值 */
function defaultPickerValue(type: PeriodType): Dayjs {
  if (type === 'weekly') return startOfWeekMonday(dayjs())
  if (type === 'monthly') return dayjs().startOf('month')
  return dayjs()
}

const statusColor = (status: string | null | undefined): string => {
  if (!status) return 'default'
  if (['已完成', '已发布', '已通过', '已关闭', 'done', 'closed'].includes(status)) return 'success'
  if (['进行中', 'doing', '待审核', '审核中'].includes(status)) return 'processing'
  if (['逾期', '高危', '高', 'high', 'blocked'].includes(status)) return 'error'
  return 'default'
}

const taskColumns: TableProps<ReportTask>['columns'] = [
  { title: '名称', dataIndex: 'name' },
  { title: '负责人', dataIndex: 'owner', render: (v: string | null) => v ?? '-' },
  {
    title: '状态',
    dataIndex: 'status',
    render: (v: string | null) => <Tag color={statusColor(v)}>{v ?? '-'}</Tag>,
  },
  { title: '进度', dataIndex: 'progress', render: (v: number) => `${v ?? 0}%` },
  { title: '计划开始', dataIndex: 'plan_start', render: (v: string | null) => v ?? '-' },
  { title: '计划结束', dataIndex: 'plan_end', render: (v: string | null) => v ?? '-' },
]

const milestoneColumns: TableProps<ReportMilestone>['columns'] = [
  { title: '名称', dataIndex: 'name' },
  { title: '计划日期', dataIndex: 'plan_date', render: (v: string | null) => v ?? '-' },
  { title: '实际日期', dataIndex: 'actual_date', render: (v: string | null) => v ?? '-' },
  {
    title: '状态',
    dataIndex: 'status',
    render: (v: string | null) => <Tag color={statusColor(v)}>{v ?? '-'}</Tag>,
  },
]

const riskColumns: TableProps<ReportRisk>['columns'] = [
  { title: '描述', dataIndex: 'description' },
  {
    title: '等级',
    dataIndex: 'level',
    render: (v: string | null) => <Tag color={statusColor(v)}>{v ?? '-'}</Tag>,
  },
  { title: '负责人', dataIndex: 'owner', render: (v: string | null) => v ?? '-' },
  {
    title: '状态',
    dataIndex: 'status',
    render: (v: string | null) => <Tag color={statusColor(v)}>{v ?? '-'}</Tag>,
  },
]

const issueColumns: TableProps<ReportIssue>['columns'] = [
  { title: '标题', dataIndex: 'title' },
  {
    title: '严重度',
    dataIndex: 'severity',
    render: (v: string | null) => <Tag color={statusColor(v)}>{v ?? '-'}</Tag>,
  },
  { title: '负责人', dataIndex: 'owner', render: (v: string | null) => v ?? '-' },
  {
    title: '状态',
    dataIndex: 'status',
    render: (v: string | null) => <Tag color={statusColor(v)}>{v ?? '-'}</Tag>,
  },
]

const deliverableColumns: TableProps<ReportDeliverable>['columns'] = [
  { title: '名称', dataIndex: 'name' },
  { title: '负责人', dataIndex: 'owner', render: (v: string | null) => v ?? '-' },
  { title: '提交状态', dataIndex: 'submit_status', render: (v: string) => <Tag>{v}</Tag> },
  {
    title: '审核状态',
    dataIndex: 'review_status',
    render: (v: string) => <Tag color={statusColor(v)}>{v}</Tag>,
  },
]

export default function ReportsPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const pid = projectId ?? ''
  const { message } = App.useApp()

  const [periodType, setPeriodType] = useState<PeriodType>('weekly')
  const [pickerValue, setPickerValue] = useState<Dayjs>(defaultPickerValue('weekly'))
  const [report, setReport] = useState<ReportResponse | null>(null)
  const [loading, setLoading] = useState(false)

  // 旧版周报文本（兼容接口，按需加载）
  const [legacy, setLegacy] = useState<{ meta: string; content: string } | null>(null)
  const [legacyLoading, setLegacyLoading] = useState(false)

  const fetchReport = useCallback(async () => {
    if (!pid) return
    const { start, end } = computeRange(periodType, pickerValue)
    setLoading(true)
    try {
      const resp = await api.get<ReportResponse>(
        `/projects/${pid}/reports?period_type=${periodType}&start=${start}&end=${end}`,
      )
      setReport(resp)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '生成报告失败')
    } finally {
      setLoading(false)
    }
  }, [pid, periodType, pickerValue, message])

  useEffect(() => {
    void fetchReport()
  }, [fetchReport])

  const handlePeriodChange = (val: string | number) => {
    const t = val as PeriodType
    setPeriodType(t)
    setPickerValue(defaultPickerValue(t))
  }

  const loadLegacy = useCallback(async () => {
    if (!pid) return
    setLegacyLoading(true)
    try {
      setLegacy(await weeklyText(pid))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载旧版周报失败')
    } finally {
      setLegacyLoading(false)
    }
  }, [pid, message])

  const exportWordUrl = useMemo(() => {
    const { start, end } = computeRange(periodType, pickerValue)
    return `/api/projects/${pid}/reports/export?period_type=${periodType}&start=${start}&end=${end}&fmt=docx`
  }, [pid, periodType, pickerValue])

  const kpi = report?.kpi
  const sections = report

  const statCard = (label: string, value: number | string, color: string) => (
    <Col xs={12} sm={8} md={6} lg={4} key={label}>
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: '14px 16px',
          border: '1px solid #eceef4',
          boxShadow: '0 1px 4px rgba(17,20,40,.05)',
        }}
      >
        <div style={{ fontSize: 12, color: '#8a919e' }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1.2, marginTop: 4 }}>
          {value}
        </div>
      </div>
    </Col>
  )

  return (
    <div>
      {/* 工具栏（不进入打印区） */}
      <Card size="small" style={{ marginBottom: 12 }} styles={{ body: { padding: 12 } }}>
        <Space wrap size={12} style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Segmented
              value={periodType}
              onChange={handlePeriodChange}
              options={[
                { label: '日', value: 'daily' },
                { label: '周', value: 'weekly' },
                { label: '月', value: 'monthly' },
              ]}
            />
            {periodType === 'daily' ? (
              <DatePicker value={pickerValue} onChange={v => setPickerValue(v ?? dayjs())} />
            ) : null}
            {periodType === 'weekly' ? (
              <DatePicker
                picker="week"
                value={pickerValue}
                onChange={v => setPickerValue(v ?? startOfWeekMonday(dayjs()))}
              />
            ) : null}
            {periodType === 'monthly' ? (
              <DatePicker
                picker="month"
                value={pickerValue}
                onChange={v => setPickerValue(v ?? dayjs().startOf('month'))}
              />
            ) : null}
            <Button icon={<ReloadOutlined />} onClick={() => void fetchReport()} loading={loading}>
              生成 / 刷新
            </Button>
          </Space>
          <Space wrap>
            <Button icon={<FileWordOutlined />} onClick={() => window.open(exportWordUrl)}>
              导出 Word
            </Button>
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>
              导出 PDF（打印）
            </Button>
          </Space>
        </Space>
      </Card>

      {/* 预览区：稳定 id，供 print.css 控制打印范围 */}
      <div id="report-print-area">
        <Spin spinning={loading}>
          {!report ? (
            <Card>
              <Empty description={loading ? '生成中…' : '暂无报告'} />
            </Card>
          ) : (
            <>
              <Card size="small" style={{ marginBottom: 12 }} styles={{ body: { padding: 12 } }}>
                <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                  <Title level={5} style={{ margin: 0 }}>
                    项目报告
                  </Title>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    周期：
                    {report.period_type === 'daily'
                      ? '日'
                      : report.period_type === 'weekly'
                        ? '周'
                        : '月'}
                    （{report.start} ~ {report.end}）
                  </Text>
                </Space>
                {kpi ? (
                  <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
                    {statCard('任务总数', kpi.total, '#171b2e')}
                    {statCard('已完成', kpi.done, '#059669')}
                    {statCard('进行中', kpi.doing, '#0284c7')}
                    {statCard('逾期', kpi.overdue, '#dc2626')}
                    {statCard('整体进度', `${kpi.progress_pct}%`, '#4f46e5')}
                    {statCard('风险(开)', kpi.risk_open, '#d97706')}
                    {statCard('高风险', kpi.high_risk, '#dc2626')}
                    {statCard('问题(开)', kpi.issue_open, '#d97706')}
                  </Row>
                ) : null}
              </Card>

              <Card
                size="small"
                title="任务"
                style={{ marginBottom: 12 }}
                extra={<ExportMenu projectId={pid} resource="tasks" />}
              >
                <Table<ReportTask>
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={sections?.tasks ?? []}
                  columns={taskColumns}
                  locale={{ emptyText: '本周期无任务' }}
                />
              </Card>

              <Card
                size="small"
                title="里程碑"
                style={{ marginBottom: 12 }}
                extra={<ExportMenu projectId={pid} resource="milestones" />}
              >
                <Table<ReportMilestone>
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={sections?.milestones ?? []}
                  columns={milestoneColumns}
                  locale={{ emptyText: '本周期无里程碑' }}
                />
              </Card>

              <Card
                size="small"
                title="风险"
                style={{ marginBottom: 12 }}
                extra={<ExportMenu projectId={pid} resource="risks" />}
              >
                <Table<ReportRisk>
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={sections?.open_risks ?? []}
                  columns={riskColumns}
                  locale={{ emptyText: '本周期无风险' }}
                />
              </Card>

              <Card
                size="small"
                title="问题"
                style={{ marginBottom: 12 }}
                extra={<ExportMenu projectId={pid} resource="issues" />}
              >
                <Table<ReportIssue>
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={sections?.open_issues ?? []}
                  columns={issueColumns}
                  locale={{ emptyText: '本周期无问题' }}
                />
              </Card>

              <Card
                size="small"
                title="交付物"
                style={{ marginBottom: 12 }}
                extra={<ExportMenu projectId={pid} resource="deliverables" />}
              >
                <Table<ReportDeliverable>
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={sections?.deliverables ?? []}
                  columns={deliverableColumns}
                  locale={{ emptyText: '本周期无交付物' }}
                />
              </Card>

              {/* 待办区（复用三类分组样式，按周期过滤） */}
              <Card
                size="small"
                title="待办区"
                style={{ marginBottom: 12 }}
                extra={<ExportMenu projectId={pid} resource="overview" />}
              >
                {sections ? (
                  <Row gutter={[12, 12]}>
                    <Col xs={24} md={8}>
                      <TodoGroup
                        title="到期里程碑"
                        items={sections.overview_todos?.milestones ?? []}
                        color="#d97706"
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <TodoGroup
                        title="逾期任务"
                        items={sections.overview_todos?.tasks ?? []}
                        color="#dc2626"
                      />
                    </Col>
                    <Col xs={24} md={8}>
                      <TodoGroup
                        title="待审核交付物"
                        items={sections.overview_todos?.deliverables ?? []}
                        color="#0284c7"
                      />
                    </Col>
                  </Row>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无待办" />
                )}
              </Card>
            </>
          )}
        </Spin>
      </div>

      {/* 旧版周报文本（兼容接口，按需加载） */}
      <Card size="small" title="周报文本预览（旧版兼容）" style={{ marginTop: 12 }}>
        <Space wrap style={{ marginBottom: 8 }}>
          <Button size="small" onClick={() => void loadLegacy()} loading={legacyLoading}>
            加载旧版周报
          </Button>
          {legacy ? <Tag color="blue">已加载</Tag> : <Tag>未加载</Tag>}
        </Space>
        {legacy ? (
          <>
            <Paragraph type="secondary" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
              {legacy.meta}
            </Paragraph>
            <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{legacy.content}</Paragraph>
          </>
        ) : (
          <Text type="secondary">点击「加载旧版周报」查看由旧接口生成的周报正文。</Text>
        )}
      </Card>
    </div>
  )
}

/** 待办分组卡片（复用 /overview/todos 的三类分组样式，简化展示） */
function TodoGroup({
  title,
  items,
  color,
}: {
  title: string
  items: ReportTodoItem[]
  color: string
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #eceef4',
        borderRadius: 10,
        padding: 12,
        height: '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span
          style={{
            width: 6,
            height: 14,
            borderRadius: 3,
            background: color,
            display: 'inline-block',
          }}
        />
        <Text strong style={{ fontSize: 13 }}>
          {title}
        </Text>
        <Tag color={color} style={{ marginInlineStart: 'auto' }}>
          {items.length}
        </Tag>
      </div>
      {items.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          无
        </Text>
      ) : (
        items.slice(0, 8).map(it => (
          <div
            key={it.id}
            style={{
              fontSize: 12,
              padding: '4px 0',
              borderBottom: '1px dashed #f0f2f7',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {it.name}
            </span>
            <span style={{ color: '#8a919e', flexShrink: 0 }}>{it.date ?? '-'}</span>
          </div>
        ))
      )}
    </div>
  )
}
