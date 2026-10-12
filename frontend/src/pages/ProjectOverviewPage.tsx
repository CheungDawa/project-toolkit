import {
  ApartmentOutlined,
  BarChartOutlined,
  BugOutlined,
  ClockCircleOutlined,
  EditOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  FlagOutlined,
  FundProjectionScreenOutlined,
  InboxOutlined,
  LinkOutlined,
  PercentageOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  Col,
  Popconfirm,
  Progress,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import {
  archiveProject,
  deleteProject,
  updateProject,
  type Project,
  type ProjectPayload,
} from '../api/projects'
import { listMilestones, listTasks } from '../api/stage2'
import { listRisks } from '../api/stage3'
import ProjectFormModal from '../components/ProjectFormModal'
import ProjectGuard from '../components/ProjectGuard'
import { useProjectContext } from '../hooks/useProjectContext'
import type { RiskItem } from '../api/stage3'
import type { Milestone, TaskItem } from '../api/stage2'
import type { DeliverableItem } from '../api/stage5'
import { listDeliverables } from '../api/stage5'

const { Text, Title } = Typography

/** 快捷入口（项目工作空间模块地图，全部为已实现模块） */
const QUICK_MODULES = [
  { icon: <ApartmentOutlined />, name: 'WBS 任务', to: (id: string) => `/projects/${id}/wbs`, color: '#4f46e5' },
  { icon: <BarChartOutlined />, name: '甘特图', to: (id: string) => `/projects/${id}/gantt`, color: '#0ea5e9' },
  { icon: <FlagOutlined />, name: '里程碑', to: (id: string) => `/projects/${id}/milestones`, color: '#f59e0b' },
  { icon: <LinkOutlined />, name: '计划基线', to: (id: string) => `/projects/${id}/baselines`, color: '#14b8a6' },
  { icon: <WarningOutlined />, name: '风险', to: (id: string) => `/projects/${id}/risks`, color: '#ef4444' },
  { icon: <BugOutlined />, name: '问题', to: (id: string) => `/projects/${id}/issues`, color: '#d97706' },
  { icon: <FundProjectionScreenOutlined />, name: '变更', to: (id: string) => `/projects/${id}/changes`, color: '#8b5cf6' },
  { icon: <TeamOutlined />, name: '干系人', to: (id: string) => `/projects/${id}/stakeholders`, color: '#06b6d4' },
  { icon: <FileDoneOutlined />, name: '交付资料', to: (id: string) => `/projects/${id}/deliverables`, color: '#10b981' },
]

const RISK_CLOSED = ['已关闭', '已转问题', '已转任务']

function statusColor(status: string | null): string {
  return status === '已完成' ? 'green' : status === '进行中' ? 'blue' : 'default'
}

/** 概览指标卡 */
function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  color: string
}) {
  return (
    <Card size="small" styles={{ body: { padding: '14px 16px' } }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            width: 36, height: 36, borderRadius: 10, display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 17, color: '#fff',
            background: color, flexShrink: 0,
          }}
        >
          {icon}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, color: '#8a919e' }}>{label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1c2230', lineHeight: 1.3 }}>{value}</div>
          {sub ? <div style={{ fontSize: 11.5, color: '#8a919e', marginTop: 1 }}>{sub}</div> : null}
        </div>
      </div>
    </Card>
  )
}

export default function ProjectOverviewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const context = useProjectContext(id)
  const { message } = App.useApp()

  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [risks, setRisks] = useState<RiskItem[]>([])
  const [deliverables, setDeliverables] = useState<DeliverableItem[]>([])
  const [bizLoading, setBizLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  /** 业务数据全部按 URL 项目 ID 拉取（服务端按 project_id 过滤，无跨项目数据） */
  const fetchBusiness = useCallback(async () => {
    if (!id) return
    setBizLoading(true)
    try {
      const [taskResp, mileResp, riskResp, dlvResp] = await Promise.all([
        listTasks(id),
        listMilestones(id),
        listRisks(id),
        listDeliverables(id),
      ])
      setTasks(taskResp.items)
      setMilestones(mileResp)
      setRisks(riskResp)
      setDeliverables(dlvResp)
    } catch {
      // 局部数据失败不阻塞整页：已有部分仍展示
    } finally {
      setBizLoading(false)
    }
  }, [id])

  useEffect(() => {
    void fetchBusiness()
  }, [fetchBusiness])

  const handleUpdate = async (values: ProjectPayload) => {
    if (!context.project) return
    try {
      await updateProject(context.project.id, values)
      message.success('项目已更新')
      setModalOpen(false)
      context.reload()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleArchive = async () => {
    if (!context.project) return
    try {
      await archiveProject(context.project.id)
      message.success('项目已归档')
      context.reload()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '归档失败')
    }
  }

  const handleDelete = async () => {
    if (!context.project) return
    try {
      await deleteProject(context.project.id)
      message.success('项目已删除')
      navigate('/projects')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  // ---------- 纯前端汇总派生（数据源自真实 API，未涉及的项目如实显示 0） ----------
  const today = new Date().toISOString().slice(0, 10)
  const leafTaskIds = new Set(tasks.filter((t) => t.parent_id).map((t) => t.parent_id))
  const leaf = tasks.filter((t) => !leafTaskIds.has(t.id))
  const doneCount = leaf.filter((t) => t.status === '已完成').length
  const progress = leaf.length ? Math.round((doneCount / leaf.length) * 100) : 0
  const overdueTasks = leaf.filter((t) => t.status !== '已完成' && t.plan_end && t.plan_end < today)
  const doingCount = leaf.filter((t) => t.status === '进行中').length
  const nextMilestones = milestones
    .filter((m) => !m.actual_date)
    .sort((a, b) => (a.plan_date ?? '9999').localeCompare(b.plan_date ?? '9999'))
    .slice(0, 4)
  const overdueMilestones = milestones.filter((m) => m.plan_date && !m.actual_date && m.plan_date < today)
  const openRisks = risks.filter((r) => !RISK_CLOSED.includes(r.status))
  const highRisks = openRisks.filter((r) => r.level === '高')
  const pendingDeliverables = deliverables.filter((d) => d.submit_status === '未提交')
  const reviewDeliverables = deliverables.filter((d) => d.submit_status === '已提交' && d.review_status === '待审核')

  return (
    <ProjectGuard context={context}>
      {(project: Project) => (
        <div>
          {/* ========== 项目头：名称/编号/操作 ========== */}
          <Card styles={{ body: { padding: '16px 20px' } }} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <Space size={8} align="center" wrap>
                  <Title level={4} style={{ margin: 0 }}>{project.name}</Title>
                  <Tag color="geekblue">{project.code}</Tag>
                  {project.status ? <Tag color={statusColor(project.status)}>{project.status}</Tag> : null}
                  {project.archived_at ? <Tag color="gold">已归档</Tag> : null}
                </Space>
                <div style={{ marginTop: 6, fontSize: 12.5, color: '#8a919e', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {project.customer ? <span>客户：{project.customer}</span> : null}
                  <span>项目经理：{project.manager ?? '—'}</span>
                  <span>
                    计划周期：{project.plan_start && project.plan_end ? `${project.plan_start} ~ ${project.plan_end}` : '—'}
                  </span>
                  <span>阶段：{project.phase ?? '—'}</span>
                </div>
              </div>
              <Space>
                <Button icon={<EditOutlined />} onClick={() => setModalOpen(true)}>编辑</Button>
                <Popconfirm title="确认归档该项目？" onConfirm={() => void handleArchive()}>
                  <Button icon={<InboxOutlined />} disabled={!!project.archived_at}>归档</Button>
                </Popconfirm>
                <Popconfirm
                  title="确认删除该项目？"
                  description="删除为软删除，编号不释放；操作记录将写入审计日志"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => void handleDelete()}
                >
                  <Button danger>删除</Button>
                </Popconfirm>
              </Space>
            </div>
          </Card>

          {/* ========== 指标行：进度/任务/逾期/风险/问题/交付 ========== */}
          <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
            <Col xs={12} md={8} lg={4}>
              <StatCard
                icon={<PercentageOutlined />}
                label="总体进度"
                color="#4f46e5"
                value={<span>{progress}%</span>}
                sub={
                  <div style={{ marginTop: 4 }}>
                    <Progress percent={progress} size="small" showInfo={false} strokeColor="#4f46e5" />
                  </div>
                }
              />
            </Col>
            <Col xs={12} md={8} lg={4}>
              <StatCard
                icon={<ApartmentOutlined />}
                label="任务（叶子）"
                color="#0ea5e9"
                value={`${doneCount} / ${leaf.length}`}
                sub={`进行中 ${doingCount}`}
              />
            </Col>
            <Col xs={12} md={8} lg={4}>
              <StatCard
                icon={<ClockCircleOutlined />}
                label="逾期事项"
                color={overdueTasks.length + overdueMilestones.length > 0 ? '#dc2626' : '#10b981'}
                value={overdueTasks.length + overdueMilestones.length}
                sub={`任务 ${overdueTasks.length} · 里程碑 ${overdueMilestones.length}`}
              />
            </Col>
            <Col xs={12} md={8} lg={4}>
              <StatCard
                icon={<WarningOutlined />}
                label="开放风险"
                color={highRisks.length > 0 ? '#dc2626' : '#f59e0b'}
                value={openRisks.length}
                sub={highRisks.length > 0 ? `高风险 ${highRisks.length} 项` : '无高风险'}
              />
            </Col>
            <Col xs={12} md={8} lg={4}>
              <StatCard
                icon={<FileDoneOutlined />}
                label="待验收交付物"
                color="#f59e0b"
                value={reviewDeliverables.length}
                sub={`未提交 ${pendingDeliverables.length} 项`}
              />
            </Col>
            <Col xs={12} md={8} lg={4}>
              <StatCard
                icon={<FileTextOutlined />}
                label="交付物总数"
                color="#10b981"
                value={deliverables.length}
                sub="档案与验收资料"
              />
            </Col>
          </Row>

          {/* ========== 里程碑 + 风险摘要 ========== */}
          <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
            <Col xs={24} lg={14}>
              <Card
                size="small"
                title="近期里程碑"
                extra={<a onClick={() => navigate(`/projects/${project.id}/milestones`)}>全部 →</a>}
              >
                {bizLoading ? (
                  <div style={{ textAlign: 'center', padding: '18px 0' }}><Spin /></div>
                ) : nextMilestones.length === 0 ? (
                  <Text type="secondary">暂无未完成里程碑</Text>
                ) : (
                  nextMilestones.map((m) => {
                    const overdue = m.plan_date && m.plan_date < today
                    return (
                      <div
                        key={m.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 4px', borderBottom: '1px solid #f5f6fa',
                        }}
                      >
                        <FlagOutlined style={{ color: overdue ? '#dc2626' : '#f59e0b' }} />
                        <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{m.name}</span>
                        <Text type="secondary" style={{ fontSize: 12 }}>{m.plan_date ?? '未定'}</Text>
                        {overdue ? <Tag color="red">逾期</Tag> : <Tag>未完成</Tag>}
                      </div>
                    )
                  })
                )}
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card
                size="small"
                title="风险与问题"
                extra={<a onClick={() => navigate(`/projects/${project.id}/risks`)}>风险台账 →</a>}
              >
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{ flex: 1, border: '1px solid #f0f2f7', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 12, color: '#8a919e' }}>开放风险</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: highRisks.length > 0 ? '#dc2626' : '#1c2230' }}>
                      {openRisks.length}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#8a919e' }}>高风险 {highRisks.length} 项</div>
                  </div>
                  <div style={{ flex: 1, border: '1px solid #f0f2f7', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 12, color: '#8a919e' }}>逾期任务</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: overdueTasks.length > 0 ? '#dc2626' : '#1c2230' }}>
                      {overdueTasks.length}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#8a919e' }}>
                      {overdueTasks.length > 0 ? overdueTasks.slice(0, 2).map((t) => t.name).join('、') : '无逾期'}
                    </div>
                  </div>
                </div>
              </Card>
            </Col>
          </Row>

          {/* ========== 模块快捷入口 ========== */}
          <Card size="small" title="项目模块" style={{ marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
              {QUICK_MODULES.map((m) => (
                <div
                  key={m.name}
                  className="pt-module-card"
                  onClick={() => navigate(m.to(project.id))}
                  style={{
                    border: '1px solid #eeeef4', borderRadius: 10, padding: '12px 14px',
                    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: '#fff',
                  }}
                >
                  <span
                    style={{
                      width: 30, height: 30, borderRadius: 9, display: 'inline-flex',
                      alignItems: 'center', justifyContent: 'center', fontSize: 15, color: '#fff',
                      background: m.color, flexShrink: 0,
                    }}
                  >
                    {m.icon}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#2c3242' }}>{m.name}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* ========== 档案信息（原项目详情） ========== */}
          <Card size="small" title="项目档案">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px 24px', fontSize: 12.5 }}>
              {[
                ['项目编号', project.code],
                ['客户', project.customer ?? '—'],
                ['项目经理', project.manager ?? '—'],
                ['实际起止', project.actual_start && project.actual_end ? `${project.actual_start} ~ ${project.actual_end}` : '—'],
                ['创建时间', project.created_at.slice(0, 10)],
                ['创建记录', project.description || '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
                  <div>{value}</div>
                </div>
              ))}
            </div>
          </Card>

          <ProjectFormModal
            open={modalOpen}
            project={project}
            onCancel={() => setModalOpen(false)}
            onSubmit={handleUpdate}
          />
        </div>
      )}
    </ProjectGuard>
  )
}
