import Gantt from 'frappe-gantt'
import '../assets/frappe-gantt.css'
import '../assets/gantt-extra.css'
import { useEffect, useRef } from 'react'

/**
 * 任务条输入结构。与 frappe-gantt 的 task 结构保持一致，
 * `status` 为 Project Toolkit 扩展字段，用于自动计算 custom_class（状态着色）。
 */
export interface GanttItemInput {
  id: string
  name: string
  start: string
  end: string
  progress: number
  dependencies?: string[]
  custom_class?: string
  status?: string
}

export type GanttViewMode = 'Day' | 'Week' | 'Month'

/** 周末底纹颜色（frappe-gantt 的 holidays option 以颜色为 key） */
const WEEKEND_FILL = '#f5f5f5'
/** 项目日历中法定节假日的底纹颜色 */
const HOLIDAY_FILL = '#fff1f0'
/** 默认周末定义：周日(0)、周六(6) */
const DEFAULT_WEEKEND_DAYS: number[] = [0, 6]

interface GanttViewProps {
  items: GanttItemInput[]
  language?: string
  /** 受控视图模式：日 / 周 / 月 */
  viewMode?: GanttViewMode
  /** 项目日历中的节假日（YYYY-MM-DD 列表），用淡红底纹标出 */
  holidayDates?: string[]
  /** 项目中被定义为周末的星期（0=周日 … 6=周六），默认 [0, 6] */
  weekendDays?: number[]
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

/**
 * 依据任务状态 / 进度 / 计划结束日期推导 bar 的 custom_class。
 * 优先级：已完成 > 逾期 > 进行中 > 未开始。
 * 调用方若已显式给出 custom_class（汇总条、里程碑），则原样保留。
 */
export function resolveBarClass(item: GanttItemInput, today: string = toDateString(new Date())): string {
  if (item.custom_class) return item.custom_class
  const isDone = item.status === '已完成' || item.progress >= 100
  if (isDone) return 'pt-done'
  // 字符串比较等价于日期比较：plan_end 与 today 均为 YYYY-MM-DD
  if (item.end < today) return 'pt-overdue'
  if (item.status === '进行中' || item.progress > 0) return 'pt-doing'
  return 'pt-todo'
}

export default function GanttView({
  items,
  language = 'zh',
  viewMode = 'Day',
  holidayDates = [],
  weekendDays = DEFAULT_WEEKEND_DAYS,
  onDateChange,
  onProgressChange,
  onTaskClick,
  onViewModeChange,
  readonly = false,
}: GanttViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // 仅在首次挂载时自动滚动到「今日」；后续重建（切换视图/刷新数据）保留用户当前滚动位置，避免拖动后被拉回今日
  const didScrollRef = useRef(false)

  /**
   * 回调放进 ref：甘特图实例只在必要依赖变化时重建，
   * 通过 ref 读取最新回调，避免闭包里持有旧的 props。
   */
  const handlersRef = useRef({ onDateChange, onProgressChange, onTaskClick, onViewModeChange })
  handlersRef.current = { onDateChange, onProgressChange, onTaskClick, onViewModeChange }

  // 数组 props 每次渲染都是新引用，用字符串 key 参与依赖比较，避免无谓重建
  const holidayKey = holidayDates.join('|')
  const weekendKey = weekendDays.join('|')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const weekendSet = new Set(weekendDays.length > 0 ? weekendDays : DEFAULT_WEEKEND_DAYS)

    /**
     * holidays option（官方支持，见 node_modules/frappe-gantt/src/defaults.js:122
     * 默认值即 `{'var(--g-weekend-highlight-color)': 'weekend'}`）：
     * key = 底纹颜色，value 可为 'weekend' | 判定函数 | 日期数组。
     * 这里用 'weekend' 让库自动覆盖整个渲染区间（含 padding 区域），
     * 比手工按任务区间枚举周六周日更可靠。
     */
    const holidaysOption: Record<string, 'weekend' | string[]> = { [WEEKEND_FILL]: 'weekend' }
    if (holidayDates.length > 0) {
      holidaysOption[HOLIDAY_FILL] = holidayDates
    }

    const ganttItems = items.map((item) => ({ ...item, custom_class: resolveBarClass(item) }))

    new Gantt(container, ganttItems, {
      language,
      readonly,
      readonly_dates: readonly,
      readonly_progress: readonly,
      snap_at: '1d',
      view_mode: viewMode,
      view_mode_select: true,
      // 今日按钮：默认即 true（defaults.js:157），显式声明以免被上游配置覆盖
      today_button: true,
      // 渲染后滚动到今日（defaults.js:155），今日竖线由库自身绘制（index.js:696 highlight_current）
      // 仅首次挂载滚动到今日；后续重建（切换视图/刷新）保留当前位置，避免拖动后页面被拉回今日
      scroll_to: didScrollRef.current ? undefined : 'today',
      popup_on: 'click',
      move_dependencies: true,
      // 官方 option（defaults.js:161），默认周日/周六；这里允许按项目日历覆盖
      is_weekend: (d: Date) => weekendSet.has(d.getDay()),
      holidays: holidaysOption,
      on_date_change: (task: { id: string | number }, start: Date, end: Date) => {
        handlersRef.current.onDateChange?.(String(task.id), toDateString(start), toDateString(end))
      },
      on_progress_change: (task: { id: string | number }, progress: number) => {
        handlersRef.current.onProgressChange?.(String(task.id), Math.round(progress))
      },
      on_click: (task: { id: string | number }) => {
        handlersRef.current.onTaskClick?.(String(task.id))
      },
      on_view_change: (mode: { name?: string } | string) => {
        const name = typeof mode === 'string' ? mode : mode?.name
        if (name === 'Day' || name === 'Week' || name === 'Month') {
          handlersRef.current.onViewModeChange?.(name)
        }
      },
    })

    didScrollRef.current = true

    return () => {
      container.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, language, viewMode, holidayKey, weekendKey, readonly])

  return <div ref={containerRef} className="pt-gantt-view" />
}
