import {
  ArrowRightOutlined,
  BugOutlined,
  CheckCircleOutlined,
  ProjectOutlined,
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
}

/** 卡片配色：正常=靛蓝系；警示=红/橙，带描边强调 */
const CARD_THEME: Record<string, { grad: string; warn: boolean }> = {
  projects: { grad: 'linear-gradient(135deg,#4f46e5,#7c6ff5)', warn: false },
  tasks: { grad: 'linear-gradient(135deg,#0284c7,#38bdf8)', warn: false },
  risks: { grad: 'linear-gradient(135deg,#dc2626,#f05252)', warn: true },
  issues: { grad: 'linear-gradient(135deg,#d97706,#f59e0b)', warn: true },
  done: { grad: 'linear-gradient(135deg,#059669,#10b981)', warn: false },
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
          background: 'linear-gradient(160deg,#1e2338 0%,#14172a 100%)',
          borderRadius: 14,
          padding: '18px 18px 14px',
          color: '#fff',
          cursor: config.onClick ? 'pointer' : 'default',
          overflow: 'hidden',
          border: isWarn ? '1px solid rgba(240,82,82,.55)' : '1px solid rgba(255,255,255,.06)',
          boxShadow: isWarn
            ? '0 6px 20px rgba(220,38,38,.25)'
            : '0 6px 16px rgba(17,20,40,.14)',
          transition: 'transform .18s ease, box-shadow .18s ease',
        }}
        className="pt-dashboard-card"
      >
        {/* 顶部大号装饰图标（低透明度背景层） */}
        <div style={{ position: 'absolute', right: -6, top: -10, fontSize: 84, opacity: 0.08 }}>
          {config.icon}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, position: 'relative' }}>
          <span
            style={{
              width: 30, height: 30, borderRadius: 9, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 15,
              background: theme.grad,
            }}
          >
            {config.icon}
          </span>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,.68)' }}>{config.label}</span>
          {isWarn ? (
            <span
              style={{
                marginLeft: 'auto', fontSize: 10, padding: '1px 7px', borderRadius: 8,
                background: 'rgba(240,82,82,.22)', color: '#ff8484', fontWeight: 600,
              }}
            >
              需关注
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.05, letterSpacing: -0.5, position: 'relative' }}>
          {config.value}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, position: 'relative' }}>{config.foot}</div>
      </div>
    )
  }

  return (
    <div>
      {/* ===================== 统计卡区（暗色系仪表卡） ===================== */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, marginBottom: 14 }}>
        {statCard({
          key: 'projects',
          icon: <ProjectOutlined />,
          label: '项目总数',
          value: data?.totals.projects ?? '—',
          foot: <span style={{ color: 'rgba(255,255,255,.5)' }}>点击进入项目列表 →</span>,
          onClick: () => navigate('/projects'),
        })}
        {statCard({
          key: 'tasks',
          icon: <RiseOutlined />,
          label: '任务总数',
          value: data?.totals.tasks ?? '—',
          foot: (
            <span style={{ color: 'rgba(255,255,255,.78)' }}>
              <b style={{ color: '#34d399', fontSize: 13 }}>{data?.totals.tasks_done ?? 0}</b> 已完成 · <b style={{ color: '#60a5fa', fontSize: 13 }}>{data?.totals.tasks_doing ?? 0}</b> 进行中
            </span>
          ),
        })}
        {statCard({
          key: 'risks',
          icon: <WarningOutlined />,
          label: '开放风险',
          value: data ? data.totals.risks_open : '—',
          foot: data && data.totals.high_risks > 0 ? (
            <span style={{ color: '#ff8484', fontWeight: 600 }}>⚠ 高风险 {data.totals.high_risks} 项，需重点管控</span>
          ) : (
            <span style={{ color: 'rgba(255,255,255,.5)' }}>暂无高风险</span>
          ),
        })}
        {statCard({
          key: 'issues',
          icon: <BugOutlined />,
          label: '未关闭问题',
          value: data ? data.totals.issues_open : '—',
          foot: data && data.totals.issues_open > 0 ? (
            <span style={{ color: '#fbbf24', fontWeight: 600 }}>有待处理事项</span>
          ) : (
            <span style={{ color: 'rgba(255,255,255,.5)' }}>全部闭环</span>
          ),
        })}
        {/* 完成率环形卡 */}
        <div
          style={{
            background: 'linear-gradient(160deg,#1e2338 0%,#14172a 100%)',
            borderRadius: 14,
            padding: '18px',
            color: '#fff',
            border: '1px solid rgba(255,255,255,.06)',
            boxShadow: '0 6px 16px rgba(17,20,40,.14)',
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
            trailColor="rgba(255,255,255,.09)"
            format={() => (
              <span style={{ color: '#fff', fontSize: 18, fontWeight: 800 }}>{doneColor.percent}%</span>
            )}
          />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
              <span
                style={{
                  width: 30, height: 30, borderRadius: 9, display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 15,
                  background: 'linear-gradient(135deg,#059669,#10b981)',
                }}
              >
                <CheckCircleOutlined />
              </span>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,.68)' }}>任务完成率</span>
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.78)' }}>
              <b style={{ color: '#34d399', fontSize: 15 }}>{data?.totals.tasks_done ?? 0}</b>
              <span style={{ color: 'rgba(255,255,255,.45)' }}> / {data?.totals.tasks ?? 0} 项任务已完成</span>
            </div>
          </div>
        </div>
      </div>

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
            <span style={{ fontSize: 12, color: '#8a919e' }}>按完成率排序</span>
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
              render: (_, _r, index) => {
                const medal = index === 0 ? '#f59e0b' : index === 1 ? '#94a3b8' : index === 2 ? '#d97706' : null
                return medal ? (
                  <span style={{ display: 'inline-flex', width: 22, height: 22, borderRadius: '50%', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', background: medal }}>
                    {index + 1}
                  </span>
                ) : (
                  <span style={{ color: '#b3bac5', fontSize: 12 }}>{index + 1}</span>
                )
              },
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
              title: '计划周期',
              key: 'plan',
              width: 190,
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
              width: 118,
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
                          background: `linear-gradient(90deg,${color}bb,${color})`,
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
        .pt-dashboard-card:hover { transform: translateY(-3px); box-shadow: 0 10px 26px rgba(17,20,40,.22); }
        .pt-dashboard-card .ant-progress-circle-trail { stroke: rgba(255,255,255,.09); }
        /* 表格密度与表头 */
        .ant-table-thead > tr > th { background: #f7f8fc !important; font-size: 12px; color: #5b6575 !important; padding: 9px 12px !important; }
        .ant-table-tbody > tr > td { padding: 10px 12px !important; }
        .ant-table-tbody > tr:hover > td { background: #f8f9fd !important; }
      `}</style>
    </div>
  )
}