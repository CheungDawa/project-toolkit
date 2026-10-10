import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  AuditOutlined,
  BarChartOutlined,
  BugOutlined,
  DeleteOutlined,
  EditOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  FlagOutlined,
  FundProjectionScreenOutlined,
  InboxOutlined,
  LinkOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { App, Button, Card, Descriptions, Popconfirm, Skeleton, Space, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { archiveProject, deleteProject, getProject, updateProject } from '../api/projects'
import type { Project, ProjectPayload } from '../api/projects'
import ProjectFormModal from '../components/ProjectFormModal'

const ACTIVE_MODULES = [
  { icon: <ApartmentOutlined />, name: 'WBS 任务', to: (id: string) => `/projects/${id}/wbs` },
  { icon: <BarChartOutlined />, name: '甘特图', to: (id: string) => `/projects/${id}/gantt` },
  { icon: <FlagOutlined />, name: '里程碑', to: (id: string) => `/projects/${id}/milestones` },
  { icon: <LinkOutlined />, name: '计划基线', to: (id: string) => `/projects/${id}/baselines` },
  { icon: <WarningOutlined />, name: '风险', to: (id: string) => `/projects/${id}/risks` },
  { icon: <BugOutlined />, name: '问题', to: (id: string) => `/projects/${id}/issues` },
  { icon: <FundProjectionScreenOutlined />, name: '变更', to: (id: string) => `/projects/${id}/changes` },
  { icon: <TeamOutlined />, name: '干系人', to: (id: string) => `/projects/${id}/stakeholders` },
  { icon: <FileDoneOutlined />, name: '交付资料', to: (id: string) => `/projects/${id}/deliverables` },
  { icon: <BarChartOutlined />, name: '燃尽图/快照', to: (id: string) => `/projects/${id}/progress` },
  { icon: <FileTextOutlined />, name: '报告中心', to: (id: string) => `/projects/${id}/reports` },
  { icon: <AuditOutlined />, name: '审计日志', to: (id: string) => `/projects/${id}/audit` },
]

const FUTURE_CARDS: never[] = []

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  const fetchDetail = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      setProject(await getProject(id))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载失败')
      navigate('/projects')
    } finally {
      setLoading(false)
    }
  }, [id, navigate, message])

  useEffect(() => {
    void fetchDetail()
  }, [fetchDetail])

  const handleUpdate = async (values: ProjectPayload) => {
    if (!project) return
    try {
      await updateProject(project.id, values)
      message.success('项目已更新')
      setModalOpen(false)
      await fetchDetail()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleArchive = async () => {
    if (!project) return
    try {
      await archiveProject(project.id)
      message.success('项目已归档')
      await fetchDetail()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '归档失败')
    }
  }

  const handleDelete = async () => {
    if (!project) return
    try {
      await deleteProject(project.id)
      message.success('项目已删除')
      navigate('/projects')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  if (loading) {
    return <Card><Skeleton active /></Card>
  }
  if (!project) {
    return null
  }

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')}>
          返回列表
        </Button>
        {project.archived_at && <Tag color="gold">已归档</Tag>}
      </Space>

      <Card
        title={`项目详情 · ${project.code} ${project.name}`}
        extra={
          <Space>
            <Button icon={<EditOutlined />} onClick={() => setModalOpen(true)}>
              编辑
            </Button>
            <Popconfirm
              title="确认归档该项目？"
              onConfirm={() => void handleArchive()}
            >
              <Button icon={<InboxOutlined />} disabled={!!project.archived_at}>
                归档
              </Button>
            </Popconfirm>
            <Popconfirm
              title="确认删除该项目？"
              description="删除为软删除，编号不释放；操作记录将写入审计日志"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handleDelete()}
            >
              <Button danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <Descriptions bordered column={2} size="middle">
          <Descriptions.Item label="项目编号">{project.code}</Descriptions.Item>
          <Descriptions.Item label="项目名称">{project.name}</Descriptions.Item>
          <Descriptions.Item label="客户">{project.customer ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="项目经理">{project.manager ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="项目阶段">{project.phase ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={project.status === '已完成' ? 'green' : project.status === '进行中' ? 'blue' : 'default'}>
              {project.status ?? '-'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="计划起止">
            {project.plan_start && project.plan_end
              ? `${project.plan_start} ~ ${project.plan_end}`
              : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="实际起止">
            {project.actual_start && project.actual_end
              ? `${project.actual_start} ~ ${project.actual_end}`
              : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="项目描述">{project.description ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{project.created_at}</Descriptions.Item>
          <Descriptions.Item label="归档时间">{project.archived_at ?? '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="项目模块" style={{ marginTop: 16 }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          全部 12 个模块已启用（阶段 1-5 完成）；部署加固与最终验收见阶段 6。
        </Typography.Paragraph>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {ACTIVE_MODULES.map((m) => (
            <Card key={m.name} size="small" hoverable onClick={() => navigate(m.to(project.id))}>
              <Space>
                {m.icon}
                <span>{m.name}</span>
                <Tag color="green">已启用</Tag>
              </Space>
            </Card>
          ))}
          {FUTURE_CARDS.map((m) => (
            <Card key={m.name} size="small" style={{ opacity: 0.55, background: '#fafafa' }}>
              <Space>
                {m.icon}
                <span>{m.name}</span>
                <Tag color="default">{m.phase} 待开发</Tag>
              </Space>
            </Card>
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
  )
}