import { lazy } from 'react'
import type { ComponentType } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

// 骨架必须首屏直出：AppLayout 保持静态导入，不进懒加载链路
import AppLayout from './components/AppLayout'
import ErrorBoundary from './components/ErrorBoundary'
import { withProjectGuard } from './hooks/withProjectGuard'

/**
 * 路由级代码分割（P0-1）：所有页面改为 React.lazy 按需加载。
 * AppLayout 静态引入并渲染 <ErrorBoundary><Suspense><Outlet /></Suspense></ErrorBoundary>，
 * 因此侧边栏/顶栏常驻；内容区在切页时短暂显示加载态，或降级为「页面加载失败」兜底。
 */

/*
 * 关于「chunk 加载失败自动重试」——实测结论：不做（保持裸 lazy）。
 *
 * 发版后旧标签页切页面时，旧 chunk hash 已 404。曾评估在 lazy 外层包一次自动重试
 * （首次失败 → 短暂延迟后再 import 一次），headless 实测（Chrome 131，本仓库构建产物）：
 *   第 1 次 /assets/WbsPage-*.js 返回 404 后，即使代码再次 import 同一模块，浏览器也
 *   不再发出任何网络请求——ES module map 会按 URL 缓存加载失败结果，第二次 import 直接
 *   拿到同一个 rejected promise。服务端恢复 200 后重试同样不重发请求（实测请求数恒为 1）。
 * 也就是说 lazy 层的重试在本场景是空转，塞进来只会让人误以为已自愈。
 *
 * 结论：chunk 404 的唯一可靠自救手段是重新加载文档（拿新的 index.html 与新 chunk 表）。
 * 因此只在 ErrorBoundary 兜底页里给用户一个显式的「重新加载」按钮，不做自动刷新
 * （自动刷新会打断用户操作，服务端持续 5xx 时还会形成刷新死循环）。
 */

/**
 * 懒加载 + 项目守卫组合器。
 * React.lazy 返回 LazyExoticComponent，其 props 类型带 ref 包装（PropsWithoutRef/PropsWithRef），
 * 与 withProjectGuard 声明的 ComponentType<P> 不直接兼容；在组合边界做一次受控断言消化，
 * 页面组件与 Guarded 的对外用法、13 个 key 均保持不变。
 */
function guard<P extends object>(loader: () => Promise<{ default: ComponentType<P> }>) {
  const LazyPage = lazy(loader) as unknown as ComponentType<P>
  return withProjectGuard<P>(LazyPage)
}

// 全局页面（无项目上下文依赖）
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ProjectListPage = lazy(() => import('./pages/ProjectListPage'))
const ProjectOverviewPage = lazy(() => import('./pages/ProjectOverviewPage'))
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

/** 项目内模块：统一包项目守卫（无效项目 ID → 404 错误态 + 返回列表；项目切换强制重挂载防串数据） */
const Guarded = {
  audit: guard(() => import('./pages/AuditPage')),
  baselines: guard(() => import('./pages/BaselinesPage')),
  changes: guard(() => import('./pages/ChangesPage')),
  deliverables: guard(() => import('./pages/DeliverablesPage')),
  gantt: guard(() => import('./pages/GanttPage')),
  issues: guard(() => import('./pages/IssuesPage')),
  kanban: guard(() => import('./pages/KanbanPage')),
  milestones: guard(() => import('./pages/MilestonesPage')),
  progress: guard(() => import('./pages/ProgressPage')),
  reports: guard(() => import('./pages/ReportsPage')),
  risks: guard(() => import('./pages/RisksPage')),
  stakeholders: guard(() => import('./pages/StakeholdersPage')),
  wbs: guard(() => import('./pages/WbsPage')),
}

/**
 * 外层兜底：包住 BrowserRouter，接住布局自身（侧边栏/顶栏/路由解析）的崩溃——
 * 与 AppLayout 内容区那道边界互补，两道边界共用组件但实例彼此独立。
 * 注意本层默认兜底只依赖 antd 与 window.location，不使用任何路由 Hook：
 * 它位于 Router 之外，兜底页里若用 Link/useNavigate 会二次抛错。
 */
export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            {/* 根路径即全局工作台：直接渲染驾驶舱（与 /dashboard 同一组件，非重定向，消除旧版页面感知） */}
            <Route path="/" element={<DashboardPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectListPage />} />
            <Route path="/projects/:id" element={<ProjectOverviewPage />} />
            <Route path="/projects/:id/detail" element={<ProjectDetailPage />} />
            <Route path="/projects/:id/kanban" element={<Guarded.kanban />} />
            <Route path="/projects/:id/wbs" element={<Guarded.wbs />} />
            <Route path="/projects/:id/gantt" element={<Guarded.gantt />} />
            <Route path="/projects/:id/milestones" element={<Guarded.milestones />} />
            <Route path="/projects/:id/baselines" element={<Guarded.baselines />} />
            <Route path="/projects/:id/risks" element={<Guarded.risks />} />
            <Route path="/projects/:id/issues" element={<Guarded.issues />} />
            <Route path="/projects/:id/changes" element={<Guarded.changes />} />
            <Route path="/projects/:id/stakeholders" element={<Guarded.stakeholders />} />
            <Route path="/projects/:id/audit" element={<Guarded.audit />} />
            <Route path="/projects/:id/progress" element={<Guarded.progress />} />
            <Route path="/projects/:id/deliverables" element={<Guarded.deliverables />} />
            <Route path="/projects/:id/reports" element={<Guarded.reports />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
