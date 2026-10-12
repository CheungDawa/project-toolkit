import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import AppLayout from './components/AppLayout'
import { withProjectGuard } from './hooks/withProjectGuard'
import AuditPage from './pages/AuditPage'
import BaselinesPage from './pages/BaselinesPage'
import ChangesPage from './pages/ChangesPage'
import DashboardPage from './pages/DashboardPage'
import DeliverablesPage from './pages/DeliverablesPage'
import GanttPage from './pages/GanttPage'
import IssuesPage from './pages/IssuesPage'
import KanbanPage from './pages/KanbanPage'
import MilestonesPage from './pages/MilestonesPage'
import ProgressPage from './pages/ProgressPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import ProjectListPage from './pages/ProjectListPage'
import ProjectOverviewPage from './pages/ProjectOverviewPage'
import ReportsPage from './pages/ReportsPage'
import RisksPage from './pages/RisksPage'
import SettingsPage from './pages/SettingsPage'
import StakeholdersPage from './pages/StakeholdersPage'
import WbsPage from './pages/WbsPage'

/** 项目内模块：统一包项目守卫（无效项目 ID → 404 错误态 + 返回列表；项目切换强制重挂载防串数据） */
const Guarded = {
  audit: withProjectGuard(AuditPage),
  baselines: withProjectGuard(BaselinesPage),
  changes: withProjectGuard(ChangesPage),
  deliverables: withProjectGuard(DeliverablesPage),
  gantt: withProjectGuard(GanttPage),
  issues: withProjectGuard(IssuesPage),
  kanban: withProjectGuard(KanbanPage),
  milestones: withProjectGuard(MilestonesPage),
  progress: withProjectGuard(ProgressPage),
  reports: withProjectGuard(ReportsPage),
  risks: withProjectGuard(RisksPage),
  stakeholders: withProjectGuard(StakeholdersPage),
  wbs: withProjectGuard(WbsPage),
}

export default function App() {
  return (
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
  )
}