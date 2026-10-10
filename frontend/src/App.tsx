import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import AppLayout from './components/AppLayout'
import BaselinesPage from './pages/BaselinesPage'
import GanttPage from './pages/GanttPage'
import MilestonesPage from './pages/MilestonesPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import ProjectListPage from './pages/ProjectListPage'
import SettingsPage from './pages/SettingsPage'
import WbsPage from './pages/WbsPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/projects/:id/wbs" element={<WbsPage />} />
          <Route path="/projects/:id/gantt" element={<GanttPage />} />
          <Route path="/projects/:id/milestones" element={<MilestonesPage />} />
          <Route path="/projects/:id/baselines" element={<BaselinesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}