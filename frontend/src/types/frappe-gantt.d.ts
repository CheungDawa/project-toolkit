declare module 'frappe-gantt' {
  export interface GanttTaskInput {
    id: string | number
    name: string
    start: string
    end: string
    progress: number
    dependencies?: string[]
    custom_class?: string
  }

  export interface GanttOptions {
    language?: string
    readonly?: boolean
    readonly_dates?: boolean
    readonly_progress?: boolean
    snap_at?: string
    view_mode_select?: boolean | string
    popup_on?: 'click' | 'hover'
    move_dependencies?: boolean
    view_mode?: string
    view_modes?: unknown[]
    popup?: unknown
    on_date_change?: (task: { id: string | number }, start: Date, end: Date) => void
    on_progress_change?: (task: { id: string | number }, progress: number) => void
    on_click?: (task: { id: string | number }) => void
    on_double_click?: (task: { id: string | number }) => void
    on_hover?: (task: { id: string | number }) => void
    on_date_click?: (date: string | null) => void
    on_view_change?: (mode: { name?: string } | string) => void
    [key: string]: unknown
  }

  export default class Gantt {
    constructor(element: HTMLElement | string, tasks: GanttTaskInput[], options?: GanttOptions)
    change_view_mode(mode: string | { name: string }, maintain_pos?: boolean): void
    scroll_current(): void
    update_task(id: string | number, details: Record<string, unknown>): void
    update_options(options: Partial<GanttOptions>): void
  }
}
