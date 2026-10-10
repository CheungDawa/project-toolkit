import { api } from './client'

export interface Setting {
  key: string
  value: unknown
  description: string | null
  updated_at: string
}

export const listSettings = () => api.get<Setting[]>('/settings')
export const updateSetting = (key: string, value: unknown) =>
  api.put<Setting>(`/settings/${key}`, { value })