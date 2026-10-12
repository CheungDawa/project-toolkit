import {
  ArrowRightOutlined,
  BugOutlined,
  CheckCircleOutlined,
  ProjectOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { App, Card, Progress, Table, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
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

export default function DashboardPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        setData(await api.get<OverviewData>('/overview'))
      } catch (err) {
        message.error(err instanceof Error ? err.message : '加载总览失败')
      } finally {
        setLoading(false)
      }
    })()
  }, [message])

  const bigCard = (
    label: string,
    value: number | string,
    sub?: string,
    icon: React.ReactNode,
    color: string,
  ) => (
    <Card loading={loading} style={{ borderRadius: 12 }} styles={{ body: { padding: '18px 20px' } }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            color: '#fff',
            background: color,
            boxShadow: '0 4px 10px rgba(17,20,40,.15)',
          }}
        >
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7c8c' }}>{label}</div>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>{value}</div>
          {sub ? <div style={{ fontSize: 11, color: '#8a9ba8' }}>{sub}</div> : null}
        </div>
      </div>
    </Card>
  )

  return (
    <div>
      <Typography.Title level={5} style={{ marginBottom: 14 }}>
        🚀 驾驶舱 · 全局总览
      </Typography.Title>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginBottom: 16 }}>
        {bigCard('项目总数', data?.totals.projects ?? '-', '进行中/已启动', <ProjectOutlined />, 'linear-gradient(135deg,#4f46e5,#6d67f5)')}
        {bigCard('任务总数', data?.totals.tasks ?? '-', `已完成 ${data?.totals.tasks_done ?? 0} · 进行中 ${data?.totals.tasks_doing ?? 0}`, <ThunderboltOutlined />, 'linear-gradient(135deg,#0ea5e9,#38bdf8)')}
        {bigCard('开放风险', data?.totals.risks_open ?? '-', `高风险 ${data?.totals.high_risks ?? 0} 项`, <WarningOutlined />, 'linear-gradient(135deg,#ef4444,#f87171)')}
        {bigCard('未关闭问题', data?.totals.issues_open ?? '-', '待处理', <BugOutlined />, 'linear-gradient(135deg,#d97706,#f59e0b)')}
        {bigCard('完成率', data && data.totals.tasks > 0 ? `${Math.round((data.totals.tasks_done / data.totals.tasks) * 100)}%` : '-', '全部项目任务', <CheckCircleOutlined />, 'linear-gradient(135deg,#10b981,#34d399)')}
      </div>

      <Card title="项目进度排行" style={{ borderRadius: 12 }}>
        <Table<OverviewProject>
          rowKey="id"
          loading={loading}
          dataSource={data?.projects ?? []}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 个项目` }}
          columns={[
            {
              title: '项目',
              key: 'name',
              render: (_, r) => (
                <div>
                  <a onClick={() => navigate(`/projects/${r.id}`)} style={{ fontWeight: 600 }}>{r.name}</a>
                  <div style={{ fontSize: 11, color: '#8a9ba8' }}>{r.code}</div>
                </div>
              ),
            },
            { title: '状态', dataIndex: 'status', width: 90, render: (v: string | null) => (v ? <Tag>{v}</Tag> : '-') },
            { title: '计划周期', key: 'plan', width: 200, render: (_, r) => (r.plan_start && r.plan_end ? `${r.plan_start} ~ ${r.plan_end}` : '-') },
            {
              title: '任务',
              key: 'tasks',
              width: 110,
              render: (_, r) => (
                <span>
                  <Tag color="green">{r.task_done}</Tag> / {r.task_total}
                </span>
              ),
            },
            {
              title: '进度',
              key: 'progress',
              width: 220,
              render: (_, r) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Progress percent={r.progress} size="small" style={{ flex: 1, marginBottom: 0 }} strokeColor={r.progress >= 80 ? '#10b981' : r.progress >= 40 ? '#e8a33d' : '#94a3b8'} />
                  <span style={{ fontSize: 12, color: '#6b7c8c', minWidth: 38 }}>{r.progress}%</span>
                </div>
              ),
            },
            {
              title: '风险/问题',
              key: 'risk',
              width: 140,
              render: (_, r) => (
                <span>
                  <Tag color={r.high_risk > 0 ? 'red' : 'default'}>风险 {r.risk_open}{r.high_risk > 0 ? `（高${r.high_risk}）` : ''}</Tag>
                  {r.issue_open > 0 ? <Tag color="orange">问题 {r.issue_open}</Tag> : null}
                </span>
              ),
            },
            {
              title: '',
              key: 'go',
              width: 60,
              render: (_, r) => (
                <a onClick={() => navigate(`/projects/${r.id}`)}>
                  <ArrowRightOutlined />
                </a>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}