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
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProjectOutlined,
  SettingOutlined,
  TableOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { Breadcrumb, Button, Layout, Menu, Select, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'

import { listProjects, type Project } from '../api/projects'
import { useProjectContext } from '../hooks/useProjectContext'

const { Header, Content } = Layout

const SIDEBAR_COLLAPSED_KEY = 'pt.sidebar-collapsed'

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
    if (!suffix) return { title: '项目概览' }
    if (suffix === 'detail') return { title: '项目档案' }
    const module = PROJECT_MODULES.find((m) => m.path === suffix)
    return { title: module?.label ?? '项目', subtitle: '项目空间' }
  }
  return { title: 'Project Toolkit' }
}

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const projectId = useProjectIdFromPath()

  // 侧边栏折叠（localStorage 记忆）
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1',
  )
  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  // 项目清单：Header 项目切换器数据源（进入项目空间后可见当前项目，可直换）
  // 分页拉全量（后端 size 上限 100），循环至取完，上限 10 页防御异常
  const [projects, setProjects] = useState<Project[]>([])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const all: Project[] = []
        let page = 1
        for (let i = 0; i < 10; i++) {
          const resp = await listProjects({ size: 100, page })
          if (cancelled) return
          all.push(...resp.items)
          if (resp.items.length === 0 || all.length >= resp.total) break
          page += 1
        }
        if (!cancelled) setProjects(all)
      } catch {
        // 拉取失败时选择器显示占位，不影响导航
      }
    })()
    return () => {
      cancelled = true
    }
  }, [location.pathname])

  const activeModuleKey = (() => {
    if (projectId && location.pathname.startsWith(`/projects/${projectId}/`)) {
      return location.pathname.split(`/projects/${projectId}/`)[1]?.split('/')[0] ?? null
    }
    return null
  })()

  const activeModule = projectId
    ? PROJECT_MODULES.find((m) => m.path === activeModuleKey) ?? null
    : null

  // 面包屑：项目列表 / 项目名 / 模块名（逐级可点，面包屑本身即项目归属提示）
  const breadcrumbItems = (() => {
    if (!projectId) return []
    const items = [
      { title: <Link to="/projects">项目列表</Link> },
      {
        title: (
          <Link to={`/projects/${projectId}`}>
            {currentProject ? `${currentProject.code} ${currentProject.name}` : '项目空间'}
          </Link>
        ),
      },
    ]
    if (activeModule) {
      items.push({ title: <span style={{ color: '#4f46e5', fontWeight: 600 }}>{activeModule.label}</span> })
    } else {
      items.push({ title: <span style={{ color: '#4f46e5', fontWeight: 600 }}>项目概览</span> })
    }
    return items
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
          { key: 'module:overview', icon: <ProjectOutlined />, label: '项目概览' },
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

  // 项目概览高亮：/projects/:id 无后缀时
  const isProjectOverview = !!projectId && location.pathname === `/projects/${projectId}`

  const selectedKeys = [
    activeModuleKey ? `module:${activeModuleKey}` : null,
    isProjectOverview ? 'module:overview' : null,
    location.pathname === '/dashboard' || location.pathname === '/' ? '/dashboard' : null,
    !projectId && location.pathname === '/projects' ? '/projects' : null,
    location.pathname === '/settings' ? '/settings' : null,
  ].filter(Boolean) as string[]

  const switchProject = (newId: string) => {
    const suffix = projectId ? location.pathname.split(`/projects/${projectId}`)[1] ?? '' : ''
    navigate(`/projects/${newId}${suffix}`)
  }

  // 项目上下文：唯一事实来源（URL 项目 ID → 项目档案），Header 标签/面包屑共用
  const projectContext = useProjectContext(projectId ?? undefined)
  const currentProject = projectContext.project

  return (
    <Layout hasSider style={{ minHeight: '100vh', background: '#f4f5fa' }}>
      {/* 固定宽度侧边栏：sticky 常驻不随页面滚动消失；菜单区超高时内部滚动；可折叠（图标态） */}
      <aside
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          width: collapsed ? 64 : 224,
          flex: `0 0 ${collapsed ? 64 : 224}px`,
          transition: 'width .2s ease, flex-basis .2s ease',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, #1b2035 0%, #12151f 100%)',
          zIndex: 20,
        }}
      >
        <div
          style={{
            height: 40,
            margin: collapsed ? '10px 8px 4px' : '10px 12px 4px',
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
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            transition: 'margin .2s ease',
          }}
        >
          <ApartmentOutlined />
          {!collapsed && <span>Project Toolkit</span>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0 8px' }}>
          <Menu
            theme="dark"
            mode="inline"
            inlineCollapsed={collapsed}
            selectedKeys={selectedKeys}
            defaultOpenKeys={projectId ? ['project-modules'] : []}
            onClick={({ key }) => {
              if (key === '/dashboard' || key === '/projects' || key === '/settings') {
                navigate(key)
              } else if (key === 'module:overview' && projectId) {
                navigate(`/projects/${projectId}`)
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
        {/* 项目空间常驻当前项目标识（折叠时隐藏文字，避免被截断） */}
        {!collapsed && currentProject && (
          <div
            style={{
              flexShrink: 0,
              margin: '0 10px 8px',
              padding: '6px 10px',
              borderRadius: 8,
              background: 'rgba(79,70,229,.18)',
              border: '1px solid rgba(122,113,245,.28)',
              fontSize: 12,
              color: '#c7c9f5',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              overflow: 'hidden',
            }}
            title={`${currentProject.code} ${currentProject.name}`}
          >
            <ProjectOutlined style={{ flexShrink: 0 }} />
            <span
              style={{
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                fontWeight: 600, color: '#e3e4fb',
              }}
            >
              {currentProject.name}
            </span>
          </div>
        )}
        {!collapsed && (
          <div style={{ flexShrink: 0, textAlign: 'center', padding: '8px 0 10px' }}>
            <Typography.Text style={{ fontSize: 12, color: 'rgba(255,255,255,.28)' }}>
              v1.0 · 自托管
            </Typography.Text>
          </div>
        )}
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
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <Button
              type="text"
              aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((c) => !c)}
              style={{ flexShrink: 0 }}
            />
            {projectId ? (
              <Breadcrumb items={breadcrumbItems} style={{ whiteSpace: 'nowrap' }} />
            ) : (
              <>
                <span
                  style={{
                    width: 6, height: 22, borderRadius: 3,
                    background: 'linear-gradient(180deg, #4f46e5, #6d67f5)',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                <Typography.Title level={5} style={{ margin: 0, whiteSpace: 'nowrap' }}>
                  {title}
                </Typography.Title>
                {subtitle ? (
                  <Tag color="geekblue" style={{ marginInlineEnd: 0, flexShrink: 0 }}>{subtitle}</Tag>
                ) : null}
              </>
            )}
          </div>
          {projectId ? (
            <Select
              showSearch
              size="middle"
              value={projectId}
              onChange={switchProject}
              placeholder="切换项目"
              optionFilterProp="label"
              style={{ width: 280, flexShrink: 0, textAlign: 'left' }}
              popupMatchSelectWidth={false}
              notFoundContent={<span style={{ fontSize: 12, color: '#8a919e' }}>暂无项目</span>}
              options={projects.map((p) => ({
                value: p.id,
                label: `${p.code} · ${p.name}`,
              }))}
            />
          ) : null}
        </Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}