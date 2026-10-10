import {
  ApartmentOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  BugOutlined,
  DashboardOutlined,
  FileDoneOutlined,
  FlagOutlined,
  FundProjectionScreenOutlined,
  LinkOutlined,
  ProjectOutlined,
  SettingOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { Layout, Menu, Tag, Typography } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

const { Sider, Header, Content } = Layout

const FUTURE_MODULES = [
  { key: 'wbs', label: 'WBS 任务', icon: <ApartmentOutlined /> },
  { key: 'gantt', label: '甘特图', icon: <BarChartOutlined /> },
  { key: 'milestone', label: '里程碑', icon: <FlagOutlined /> },
  { key: 'baseline', label: '计划基线', icon: <LinkOutlined /> },
  { key: 'risk', label: '风险', icon: <WarningOutlined /> },
  { key: 'issue', label: '问题', icon: <BugOutlined /> },
  { key: 'change', label: '变更', icon: <FundProjectionScreenOutlined /> },
  { key: 'stakeholder', label: '干系人', icon: <TeamOutlined /> },
  { key: 'deliverable', label: '交付资料', icon: <FileDoneOutlined /> },
]

const PAGE_TITLES: Record<string, string> = {
  '/projects': '项目列表',
  '/settings': '系统设置',
}

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const selectedKey = location.pathname.startsWith('/projects') ? '/projects' : location.pathname

  const title =
    PAGE_TITLES[location.pathname] ?? (location.pathname.startsWith('/projects') ? '项目详情' : 'Project Toolkit')

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="dark" breakpoint="lg" collapsedWidth={64}>
        <div
          style={{
            height: 48,
            margin: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: 1,
            background: 'rgba(255,255,255,0.08)',
            borderRadius: 8,
          }}
        >
          <AppstoreOutlined style={{ marginRight: 6 }} />
          Project Toolkit
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          onClick={({ key }) => {
            if (key === '/projects' || key === '/settings') navigate(key)
          }}
          items={[
            { key: '/projects', icon: <ProjectOutlined />, label: '项目列表' },
            { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
            { type: 'divider' },
            {
              key: 'future',
              icon: <DashboardOutlined />,
              label: (
                <span>
                  后续模块
                  <Tag color="default" style={{ marginLeft: 8, fontSize: 12 }}>
                    待开发
                  </Tag>
                </span>
              ),
              children: FUTURE_MODULES.map((m) => ({
                ...m,
                disabled: true,
              })),
            },
          ]}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Typography.Title level={4} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          <Tag color="blue">阶段 1 · 基础框架</Tag>
        </Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}