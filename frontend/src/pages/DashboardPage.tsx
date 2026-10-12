import {
  ArrowRightOutlined,
  BugOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ProjectOutlined,
  RightOutlined,
  RiseOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { Progress, Table, Tag } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '../api/client'

interface OverviewProject {
  id: string
  code: string
  name: string
  status: string | null
  plan_start: string | null
  plan_end: string | null
  task_total: number
  task_done: number
  progress: number
  risk_open: number
  issue_open: number
  high_risk: number
  overdue_tasks: number
  overdue_milestones: number
}

export interface OverviewAlert {
  kind: 'project' | 'milestone' | 'risk' | 'deliverable' | 'coordination'
  severity: 'danger' | 'warning'
  days: number
  project_id: string
  project_label: string
  title: string
  detail: string
  overdue_count?: number
  risk_id?: string
  milestone_id?: string
  deliverable_id?: string
  issue_id?: string
  score?: number
}

interface OverviewData {
  totals: {
    projects: number
    tasks: number
    tasks_done: number
    tasks_doing: number
    risks_open: number
    high_risks: number
    issues_open: number
  }
  projects: OverviewProject[]
  alerts: OverviewAlert[]
  alert_summary: { danger: number; warning: number }
}

/** 卡片配色（浅色企业风）：图标块彩色渐变，卡片白底；警示=红/橙描边 */
const CARD_THEME: Record<string, { grad: string; warn: boolean; iconTint: string }> = {
  projects: { grad: 'linear-gradient(135deg,#4f46e5,#7c6ff5)', warn: false, iconTint: '#4f46e5' },
  tasks: { grad: 'linear-gradient(135deg,#0284c7,#38bdf8)', warn: false, iconTint: '#0284c7' },
  risks: { grad: 'linear-gradient(135deg,#dc2626,#f05252)', warn: true, iconTint: '#dc2626' },
  issues: { grad: 'linear-gradient(135deg,#d97706,#f59e0b)', warn: true, iconTint: '#d97706' },
  done: { grad: 'linear-gradient(135deg,#059669,#10b981)', warn: false, iconTint: '#059669' },
}

/** 预警类型 → 标签 + 跳转路径（点击直达对应模块处理） */
const ALERT_META: Record<OverviewAlert['kind'], { label: string; icon: React.ReactNode; route: string }> = {
  project: { label: '异常项目', icon: <ProjectOutlined />, route: '' },
  milestone: { label: '逾期里程碑', icon: <ClockCircleOutlined />, route: '/milestones' },
  risk: { label: '高优风险', icon: <WarningOutlined />, route: '/risks' },
  deliverable: { label: '待验收交付物', icon: <CheckCircleOutlined />, route: '/deliverables' },
  coordination: { label: '需协调事项', icon: <BugOutlined />, route: '/issues' },
}

const SEV_STYLE: Record<OverviewAlert['severity'], { bar: string; bg: string; tag: string }> = {
  danger: { bar: '#dc2626', bg: '#fef2f2', tag: '#b91c1c' },
  warning: { bar: '#d97706', bg: '#fffbeb', tag: '#b45309' },
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        setData(await api.get<OverviewData>('/overview'))
      } catch {
        // 错误时保持骨架屏
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  /** 按完成进度计算环形图颜色 */
  const doneColor = useMemo(() => {
    const p = data ? Math.round((data.totals.tasks_done / Math.max(data.totals.tasks, 1)) * 100) : 0
    return { percent: p, color: p >= 80 ? '#059669' : p >= 40 ? '#d97706' : '#94a3b8' }
  }, [data])

  const statCard = (config: {
    key: string
    icon: React.ReactNode
    label: string
    value: number | string
    foot?: React.ReactNode
    onClick?: () => void
  }) => {
    const theme = CARD_THEME[config.key]
    const isWarn = theme.warn && typeof config.value === 'number' && config.value > 0
    return (
      <div
        onClick={config.onClick}
        style={{
          position: 'relative',
          background: '#fff',
          borderRadius: 14,
          padding: '16px 18px 14px',
          cursor: config.onClick ? 'pointer' : 'default',
          overflow: 'hidden',
          border: isWarn ? '1px solid rgba(240,82,82,.45)' : '1px solid #eceef4',
          boxShadow: isWarn
            ? '0 6px 18px rgba(220,38,38,.12)'
            : '0 1px 4px rgba(17,20,40,.05)',
          transition: 'transform .18s ease, box-shadow .18s ease',
        }}
        className="pt-dashboard-card"
      >
        {/* 顶部大号装饰图标（低透明度背景层） */}
        <div style={{ position: 'absolute', right: -6, top: -10, fontSize: 84, opacity: 0.05, color: theme.iconTint }}>
          {config.icon}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, position: 'relative' }}>
          <span
            style={{
              width: 30, height: 30, borderRadius: 9, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 15,
              background: theme.grad, color: '#fff',
            }}
          >
            {config.icon}
          </span>
          <span style={{ fontSize: 12.5, color: '#8a919e' }}>{config.label}</span>
          {isWarn ? (
            <span
              style={{
                marginLeft: 'auto', fontSize: 10, padding: '1px 7px', borderRadius: 8,
                background: '#fef2f2', color: '#b91c1c', fontWeight: 600,
              }}
            >
              需关注
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.05, letterSpacing: -0.5, position: 'relative', color: '#171b2e' }}>
          {config.value}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, position: 'relative', color: '#5b6575' }}>{config.foot}</div>
      </div>
    )
  }

  const goAlert = (alert: OverviewAlert) => {
    const meta = ALERT_META[alert.kind]
    navigate(`/projects/${alert.project_id}${meta.route}`)
  }

  const alertPanel = () => {
    const alerts = data?.alerts ?? []
    const danger = data?.alert_summary.danger ?? 0
    const warning = data?.alert_summary.warning ?? 0
    return (
      <div
        style={{
          background: '#fff',
          borderRadius: 14,
          border: '1px solid #eceef4',
          boxShadow: '0 1px 4px rgba(17,20,40,.05)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '14px 18px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f2f7',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 4, height: 16, borderRadius: 2, background: danger > 0 ? '#dc2626' : warning > 0 ? '#d97706' : '#059669' }} />
            <span style={{ fontSize: 15, fontWeight: 700, color: '#171b2e' }}>需要关注</span>
            <span style={{ fontSize: 12, color: '#8a919e' }}>按紧急度排序（红=异常 · 黄=预警）</span>
          </div>
          {(danger > 0 || warning > 0) && (
            <span style={{ display: 'inline-flex', gap: 6 }}>
              {danger > 0 && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c' }}>
                  异常 {danger}
                </span>
              )}
              {warning > 0 && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 8, background: '#fffbeb', color: '#b45309' }}>
                  预警 {warning}
                </span>
              )}
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: '#8a919e', fontSize: 13 }}>加载中…</div>
        ) : alerts.length === 0 ? (
          <div style={{ padding: '36px 0', textAlign: 'center', color: '#8a919e', fontSize: 13 }}>
            <CheckCircleOutlined style={{ color: '#059669', marginRight: 6 }} />
            暂无需要关注的事项（无逾期里程碑、高风险、待验收交付物与需协调问题）
          </div>
        ) : (
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {alerts.map((a, idx) => {
              const meta = ALERT_META[a.kind]
              const sev = SEV_STYLE[a.severity]
              return (
                <div
                  key={idx}
                  onClick={() => goAlert(a)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 18px 10px 14px',
                    borderBottom: idx === alerts.length - 1 ? 'none' : '1px solid #f5f6fa',
                    cursor: 'pointer',
                    borderLeft: `3px solid ${sev.bar}`,
                    background: a.severity === 'danger' ? 'rgba(254,242,242,.4)' : 'rgba(255,251,235,.35)',
                    transition: 'background .15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f5fb')}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = a.severity === 'danger' ? 'rgba(254,242,242,.4)' : 'rgba(255,251,235,.35)')
                  }
                >
                  <span style={{ flexShrink: 0 }}>
                    <Tag style={{ marginInlineEnd: 0, fontSize: 11 }} color={a.severity === 'danger' ? 'red' : 'orange'}>
                      {meta.label}
                    </Tag>
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#2c3242', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#8a919e', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.detail}
                    </div>
                  </div>
                  <span style={{ flexShrink: 0, fontSize: 11.5, color: '#5b6575' }}>{a.project_label}</span>
                  {a.days > 0 && (
                    <span
                      style={{
                        flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 8,
                        background: sev.bg, color: sev.tag, minWidth: 52, textAlign: 'center',
                      }}
                    >
                      逾期{a.days}天
                    </span>
                  )}
                  <RightOutlined style={{ flexShrink: 0, fontSize: 11, color: '#c3c9d4' }} />
                </div>
              )
            })}
          </div>
        )}
        <div style={{ padding: '8px 18px', fontSize: 11, color: '#b3bac5', borderTop: '1px solid #f5f6fa' }}>
          口径：逾期任务/里程碑按计划日期与今天比对；高风险=评分矩阵等级「高」；待验收=已提交待审核或逾期未提交；需协调=高严重度/逾期/无责任人的开放问题
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* ===================== 统计卡区（浅色企业风） ===================== */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, marginBottom: 14 }}>
        {statCard({
          key: 'projects',
          icon: <ProjectOutlined />,
          label: '项目总数',
          value: data?.totals.projects ?? '—',
          foot: <span style={{ color: '#8a919e' }}>点击进入项目列表 →</span>,
          onClick: () => navigate('/projects'),
        })}
        {statCard({
          key: 'tasks',
          icon: <RiseOutlined />,
          label: '任务总数',
          value: data?.totals.tasks ?? '—',
          foot: (
            <span>
              <b style={{ color: '#059669', fontSize: 13 }}>{data?.totals.tasks_done ?? 0}</b> 已完成 · <b style={{ color: '#0284c7', fontSize: 13 }}>{data?.totals.tasks_doing ?? 0}</b> 进行中
            </span>
          ),
        })}
        {statCard({
          key: 'risks',
          icon: <WarningOutlined />,
          label: '开放风险',
          value: data ? data.totals.risks_open : '—',
          foot: data && data.totals.high_risks > 0 ? (
            <span style={{ color: '#b91c1c', fontWeight: 600 }}>⚠ 高风险 {data.totals.high_risks} 项，需重点管控</span>
          ) : (
            <span style={{ color: '#8a919e' }}>暂无高风险</span>
          ),
        })}
        {statCard({
          key: 'issues',
          icon: <BugOutlined />,
          label: '未关闭问题',
          value: data ? data.totals.issues_open : '—',
          foot: data && data.totals.issues_open > 0 ? (
            <span style={{ color: '#b45309', fontWeight: 600 }}>有待处理事项</span>
          ) : (
            <span style={{ color: '#8a919e' }}>全部闭环</span>
          ),
        })}
        {/* 完成率环形卡 */}
        <div
          style={{
            background: '#fff',
            borderRadius: 14,
            padding: '16px 18px 14px',
            border: '1px solid #eceef4',
            boxShadow: '0 1px 4px rgba(17,20,40,.05)',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
          className="pt-dashboard-card"
        >
          <Progress
            type="dashboard"
            percent={doneColor.percent}
            size={86}
            strokeColor={doneColor.color}
            trailColor="#eef0f5"
            format={() => (
              <span style={{ color: '#171b2e', fontSize: 18, fontWeight: 800 }}>{doneColor.percent}%</span>
            )}
          />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span
                style={{
                  width: 30, height: 30, borderRadius: 9, display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 15,
                  background: 'linear-gradient(135deg,#059669,#10b981)', color: '#fff',
                }}
              >
                <CheckCircleOutlined />
              </span>
              <span style={{ fontSize: 12.5, color: '#8a919e' }}>任务完成率</span>
            </div>
            <div style={{ fontSize: 12, color: '#5b6575' }}>
              <b style={{ color: '#059669', fontSize: 15 }}>{data?.totals.tasks_done ?? 0}</b>
              <span style={{ color: '#8a919e' }}> / {data?.totals.tasks ?? 0} 项任务已完成</span>
            </div>
          </div>
        </div>
      </div>

      {/* ===================== 需要关注（管理预警，按紧急度排序） ===================== */}
      <div style={{ marginBottom: 14 }}>{alertPanel()}</div>

      {/* ===================== 项目排行表 ===================== */}
      <div
        style={{
          background: '#fff',
          borderRadius: 14,
          border: '1px solid #eceef4',
          boxShadow: '0 1px 4px rgba(17,20,40,.05)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '14px 18px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f2f7',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 4, height: 16, borderRadius: 2, background: '#4f46e5' }} />
            <span style={{ fontSize: 15, fontWeight: 700, color: '#171b2e' }}>项目进度一览</span>
            <span style={{ fontSize: 12, color: '#8a919e' }}>支持按异常 / 进度排序</span>
          </div>
          <span style={{ fontSize: 12, color: '#8a919e' }}>{data?.totals.projects ?? 0} 个项目</span>
        </div>
        <Table<OverviewProject>
          rowKey="id"
          loading={loading}
          dataSource={data?.projects ?? []}
          pagination={data && data.projects.length > 10 ? { pageSize: 10 } : false}
          size="middle"
          style={{ padding: '0 6px' }}
          columns={[
            {
              title: '#',
              key: 'rank',
              width: 44,
              align: 'center',
              render: (_, _r, index) => (
                <span style={{ color: '#b3bac5', fontSize: 12 }}>{index + 1}</span>
              ),
            },
            {
              title: '项目',
              key: 'name',
              ellipsis: true,
              render: (_, r) => (
                <div style={{ minWidth: 0 }}>
                  <a onClick={() => navigate(`/projects/${r.id}`)} style={{ fontWeight: 600, fontSize: 13.5 }}>{r.name}</a>
                  <div style={{ fontSize: 11, color: '#9aa2b0', marginTop: 1 }}>{r.code}</div>
                </div>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 84,
              render: (v: string | null) =>
                v ? (
                  <Tag style={{ marginInlineEnd: 0 }} color={v === '进行中' ? 'blue' : v === '已完成' ? 'success' : 'default'}>{v}</Tag>
                ) : (
                  <span style={{ color: '#c3c9d4' }}>—</span>
                ),
            },
            {
              title: '异常',
              key: 'flags',
              width: 150,
              sorter: (a, b) =>
                b.overdue_tasks + b.overdue_milestones + (b.high_risk > 0 ? 1 : 0) -
                (a.overdue_tasks + a.overdue_milestones + (a.high_risk > 0 ? 1 : 0)),
              sortDirections: ['descend', 'ascend'],
              render: (_, r) => {
                const items: React.ReactNode[] = []
                if (r.overdue_tasks > 0) {
                  items.push(
                    <span key="ot" style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 8, background: '#fef2f2', color: '#dc2626' }}>
                      任务逾期{r.overdue_tasks}
                    </span>,
                  )
                }
                if (r.overdue_milestones > 0) {
                  items.push(
                    <span key="om" style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c' }}>
                      里程碑逾期{r.overdue_milestones}
                    </span>,
                  )
                }
                if (r.high_risk > 0) {
                  items.push(
                    <span key="hr" style={{ fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 8, background: '#fff1f2', color: '#dc2626' }}>
                      高风险{r.high_risk}
                    </span>,
                  )
                }
                if (items.length === 0) {
                  return <span style={{ color: '#059669', fontSize: 11.5 }}>✓ 正常</span>
                }
                return <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{items}</span>
              },
            },
            {
              title: '计划周期',
              key: 'plan',
              width: 170,
              render: (_, r) => {
                if (!r.plan_start || !r.plan_end) return <span style={{ color: '#c3c9d4' }}>—</span>
                return (
                  <span style={{ fontSize: 12, color: '#5b6575' }}>
                    {r.plan_start.slice(0, 7)} ~ {r.plan_end.slice(0, 7)}
                  </span>
                )
              },
            },
            {
              title: '任务',
              key: 'tasks',
              width: 100,
              align: 'center',
              render: (_, r) => (
                <span style={{ fontSize: 12.5 }}>
                  <b style={{ color: '#059669', fontSize: 13.5 }}>{r.task_done}</b>
                  <span style={{ color: '#b3bac5' }}> / </span>
                  <span style={{ color: '#5b6575' }}>{r.task_total}</span>
                </span>
              ),
            },
            {
              title: '进度',
              key: 'progress',
              width: 150,
              sorter: (a, b) => a.progress - b.progress,
              defaultSortOrder: 'descend',
              render: (_, r) => {
                const color = r.progress >= 80 ? '#059669' : r.progress >= 40 ? '#d97706' : '#94a3b8'
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 140 }}>
                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#eef0f5', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${r.progress}%`,
                          height: '100%',
                          borderRadius: 4,
                          background: color,
                          transition: 'width .4s ease',
                        }}
                      />
                    </div>
                    <b style={{ fontSize: 12.5, color, minWidth: 36, textAlign: 'right' }}>{r.progress}%</b>
                  </div>
                )
              },
            },
            {
              title: '风险 / 问题',
              key: 'risk',
              width: 132,
              align: 'center',
              render: (_, r) => {
                if (r.risk_open === 0 && r.issue_open === 0) {
                  return <span style={{ color: '#c3c9d4', fontSize: 12 }}>—</span>
                }
                return (
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    {r.risk_open > 0 ? (
                      <span
                        style={{
                          fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 8,
                          background: r.high_risk > 0 ? '#fef2f2' : '#f4f6fa',
                          color: r.high_risk > 0 ? '#dc2626' : '#5b6575',
                        }}
                      >
                        {r.high_risk > 0 ? `⚠${r.risk_open}` : `风险${r.risk_open}`}
                      </span>
                    ) : null}
                    {r.issue_open > 0 ? (
                      <span
                        style={{
                          fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 8,
                          background: '#fffbeb', color: '#b45309',
                        }}
                      >
                        问题{r.issue_open}
                      </span>
                    ) : null}
                  </span>
                )
              },
            },
            {
              title: '',
              key: 'go',
              width: 46,
              render: (_, r) => (
                <a
                  onClick={() => navigate(`/projects/${r.id}`)}
                  style={{ color: '#7c6ff5', fontSize: 14 }}
                >
                  <ArrowRightOutlined />
                </a>
              ),
            },
          ]}
        />
      </div>

      <style>{`
        .pt-dashboard-card { transition: transform .18s ease, box-shadow .18s ease; }
        .pt-dashboard-card:hover { transform: translateY(-3px); box-shadow: 0 8px 22px rgba(17,20,40,.10); border-color: #d9d6ff; }
        .pt-dashboard-card .ant-progress-circle-trail { stroke: #eef0f5; }
        /* 表格密度与表头 */
        .ant-table-thead > tr > th { background: #f7f8fc !important; font-size: 12px; color: #5b6575 !important; padding: 9px 12px !important; }
        .ant-table-tbody > tr > td { padding: 10px 12px !important; }
        .ant-table-tbody > tr:hover > td { background: #f8f9fd !important; }
      `}</style>
    </div>
  )
}
