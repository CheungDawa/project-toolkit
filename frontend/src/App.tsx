import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import AppLayout from './components/AppLayout'
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
import ReportsPage from './pages/ReportsPage'
import RisksPage from './pages/RisksPage'
import SettingsPage from './pages/SettingsPage'
import StakeholdersPage from './pages/StakeholdersPage'
import WbsPage from './pages/WbsPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/projects/:id/kanban" element={<KanbanPage />} />
          <Route path="/projects/:id/wbs" element={<WbsPage />} />
          <Route path="/projects/:id/gantt" element={<GanttPage />} />
          <Route path="/projects/:id/milestones" element={<MilestonesPage />} />
          <Route path="/projects/:id/baselines" element={<BaselinesPage />} />
          <Route path="/projects/:id/risks" element={<RisksPage />} />
          <Route path="/projects/:id/issues" element={<IssuesPage />} />
          <Route path="/projects/:id/changes" element={<ChangesPage />} />
          <Route path="/projects/:id/stakeholders" element={<StakeholdersPage />} />
          <Route path="/projects/:id/audit" element={<AuditPage />} />
          <Route path="/projects/:id/progress" element={<ProgressPage />} />
          <Route path="/projects/:id/deliverables" element={<DeliverablesPage />} />
          <Route path="/projects/:id/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}