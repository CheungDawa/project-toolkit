import Gantt from 'frappe-gantt'
import 'frappe-gantt/dist/frappe-gantt.css'
import { useEffect, useRef } from 'react'

export interface GanttItemInput {
  id: string
  name: string
  start: string
  end: string
  progress: number
  dependencies?: string[]
  custom_class?: string
}

export type GanttViewMode = 'Day' | 'Week' | 'Month'

interface GanttViewProps {
  items: GanttItemInput[]
  language?: string
  onDateChange?: (taskId: string, start: string, end: string) => void
  onProgressChange?: (taskId: string, progress: number) => void
  onTaskClick?: (taskId: string) => void
  onViewModeChange?: (mode: GanttViewMode) => void
  readonly?: boolean
}

function toDateString(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function GanttView({
  items,
  language = 'zh',
  onDateChange,
  onProgressChange,
  onTaskClick,
  onViewModeChange,
  readonly = false,
}: GanttViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    new Gantt(container, items, {
      language,
      readonly,
      readonly_dates: readonly,
      readonly_progress: readonly,
      snap_at: '1d',
      view_mode_select: true,
      popup_on: 'click',
      move_dependencies: true,
on_date_change: (task: { id: string | number }, start: Date, end: Date) => {
        onDateChange?.(String(task.id), toDateString(start), toDateString(end))
      },
      on_progress_change: (task: { id: string | number }, progress: number) => {
        onProgressChange?.(String(task.id), Math.round(progress))
      },
      on_click: (task: { id: string | number }) => {
        onTaskClick?.(String(task.id))
      },
      on_progress_change: (task: { id: string }, progress: number) => {
        onProgressChange?.(String(task.id), Math.round(progress))
      },
      on_click: (task: { id: string }) => {
        onTaskClick?.(String(task.id))
      },
      on_view_change: (mode: { name?: string } | string) => {
        const name = typeof mode === 'string' ? mode : mode?.name
        if (name === 'Day' || name === 'Week' || name === 'Month') {
          onViewModeChange?.(name)
        }
      },
    })

    return () => {
      container.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, language, readonly])

  return (
    <div
      ref={containerRef}
      style={{ overflowX: 'auto', background: '#fff', border: '1px solid #f0f0f0', borderRadius: 8 }}
    />
  )
}