import {
  ApartmentOutlined,
  AuditOutlined,
  BarChartOutlined,
  BugOutlined,
  DashboardOutlined,
  FieldTimeOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  FlagOutlined,
  FundProjectionScreenOutlined,
  LinkOutlined,
  ProjectOutlined,
  SettingOutlined,
  TableOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { Layout, Menu, Tag, Typography } from 'antd'
import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'

const { Header, Content } = Layout

/** 项目模块清单：进入任意项目后侧边栏一键直达 */
export const PROJECT_MODULES = [
  { key: 'kanban', label: '任务看板', icon: <TableOutlined />, path: 'kanban' },
  { key: 'wbs', label: 'WBS 任务', icon: <ApartmentOutlined />, path: 'wbs' },
  { key: 'gantt', label: '甘特图', icon: <BarChartOutlined />, path: 'gantt' },
  { key: 'milestones', label: '里程碑', icon: <FlagOutlined />, path: 'milestones' },
  { key: 'baselines', label: '计划基线', icon: <LinkOutlined />, path: 'baselines' },
  { key: 'risks', label: '风险', icon: <WarningOutlined />, path: 'risks' },
  { key: 'issues', label: '问题', icon: <BugOutlined />, path: 'issues' },
  { key: 'changes', label: '变更', icon: <FundProjectionScreenOutlined />, path: 'changes' },
  { key: 'stakeholders', label: '干系人', icon: <TeamOutlined />, path: 'stakeholders' },
  { key: 'deliverables', label: '交付资料', icon: <FileDoneOutlined />, path: 'deliverables' },
  { key: 'progress', label: '燃尽图/快照', icon: <FieldTimeOutlined />, path: 'progress' },
  { key: 'reports', label: '报告中心', icon: <FileTextOutlined />, path: 'reports' },
  { key: 'audit', label: '审计日志', icon: <AuditOutlined />, path: 'audit' },
]

function useProjectIdFromPath(): string | null {
  const params = useParams()
  return params.id ?? null
}

function pageTitle(pathname: string, projectId: string | null): { title: string; subtitle?: string } {
  if (pathname === '/dashboard') return { title: '驾驶舱', subtitle: '全局总览' }
  if (pathname === '/projects' || pathname === '/') return { title: '项目列表', subtitle: '全部项目' }
  if (pathname === '/settings') return { title: '系统设置' }
  if (projectId) {
    const suffix = pathname.split(`/projects/${projectId}`)[1]?.replace(/^\//, '')
    if (!suffix) return { title: '项目详情' }
    const module = PROJECT_MODULES.find((m) => m.path === suffix)
    return { title: module?.label ?? '项目', subtitle: '项目空间' }
  }
  return { title: 'Project Toolkit' }
}

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const projectId = useProjectIdFromPath()

  const activeModuleKey = (() => {
    if (projectId && location.pathname.startsWith(`/projects/${projectId}/`)) {
      return location.pathname.split(`/projects/${projectId}/`)[1]?.split('/')[0] ?? null
    }
    return null
  })()

  const { title, subtitle } = pageTitle(location.pathname, projectId)

  useEffect(() => {
    document.title = `${title} · Project Toolkit`
  }, [title])

  const menuItems = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '驾驶舱' },
    { key: '/projects', icon: <ProjectOutlined />, label: '项目列表' },
    ...(projectId
      ? [
          { type: 'divider' as const },
          {
            key: 'project-modules',
            label: '项目模块',
            icon: <ApartmentOutlined />,
            children: PROJECT_MODULES.map((m) => ({
              key: `module:${m.key}`,
              icon: m.icon,
              label: m.label,
            })),
          },
        ]
      : []),
    { type: 'divider' as const },
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
  ]

  const selectedKeys = [
    activeModuleKey ? `module:${activeModuleKey}` : null,
    location.pathname === '/dashboard' ? '/dashboard' : null,
    !projectId && location.pathname === '/projects' ? '/projects' : null,
    location.pathname === '/settings' ? '/settings' : null,
  ].filter(Boolean) as string[]

  return (
    <Layout style={{ minHeight: '100vh', background: '#f4f5fa' }}>
      {/* 固定宽度侧边栏：sticky 常驻不随页面滚动消失；菜单区超高时内部滚动 */}
      <aside
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          width: 224,
          flex: '0 0 224px',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, #1b2035 0%, #12151f 100%)',
          zIndex: 20,
        }}
      >
        <div
          style={{
            height: 40,
            margin: '10px 12px 4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            background: 'linear-gradient(135deg, #4f46e5 0%, #6d67f5 100%)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 1,
            borderRadius: 10,
            boxShadow: '0 4px 12px rgba(79,70,229,.35)',
            flexShrink: 0,
          }}
        >
          <ApartmentOutlined />
          <span>Project Toolkit</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0 8px' }}>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={selectedKeys}
            defaultOpenKeys={projectId ? ['project-modules'] : []}
            onClick={({ key }) => {
              if (key === '/dashboard' || key === '/projects' || key === '/settings') {
                navigate(key)
              } else if (key.startsWith('module:') && projectId) {
                const moduleKey = key.replace('module:', '')
                const module = PROJECT_MODULES.find((m) => m.key === moduleKey)
                if (module) navigate(`/projects/${projectId}/${module.path}`)
              }
            }}
            items={menuItems}
            style={{ background: 'transparent', borderRight: 'none' }}
          />
        </div>
        <div style={{ flexShrink: 0, textAlign: 'center', padding: '8px 0 10px' }}>
          <Typography.Text style={{ fontSize: 12, color: 'rgba(255,255,255,.28)' }}>
            v1.0 · 自托管
          </Typography.Text>
        </div>
      </aside>
      <Layout>
        <Header
          style={{
            background: 'rgba(255,255,255,.92)',
            backdropFilter: 'blur(8px)',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #eceef4',
            position: 'sticky',
            top: 0,
            zIndex: 10,
            height: 56,
            lineHeight: '56px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 6, height: 22, borderRadius: 3,
                background: 'linear-gradient(180deg, #4f46e5, #6d67f5)',
                display: 'inline-block',
              }}
            />
            <Typography.Title level={5} style={{ margin: 0 }}>
              {title}
            </Typography.Title>
            {subtitle ? <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>{subtitle}</Tag> : null}
          </div>
          {projectId ? <Tag color="purple">项目空间</Tag> : null}
        </Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}