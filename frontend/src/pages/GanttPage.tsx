import { App, Button, Card, Checkbox, DatePicker, Segmented, Space, Tag, Tooltip, Typography } from 'antd'
import { toPng } from 'html-to-image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'

import type { GanttItemInput, GanttViewHandle, GanttViewMode } from '../components/GanttView'
import GanttView from '../components/GanttView'
import { getProject } from '../api/projects'
import type { DependencyItem, Milestone, TaskItem } from '../api/stage2'
import { getCalendar, listMilestones, listTasks, updateTask } from '../api/stage2'

/** 视图模式中文名，用于导出图标题 */
const VIEW_MODE_LABEL: Record<GanttViewMode, string> = { Day: '日', Week: '周', Month: '月' }

/** 汇总条 / 里程碑的 id 前缀：与真实任务 id 区分，避免误更新 */
const SUMMARY_PREFIX = 'summary-'
const MILESTONE_PREFIX = 'ms-'

/** 导出图单边安全上限：超过浏览器 canvas 上限（约 16384）会导出失败/全黑，这里留余量 */
const SAFE_SIDE = 12000

/** 导出图片时排除的交互性元素（今日按钮/视图下拉、弹窗、调试按钮） */
const EXCLUDED_EXPORT_CLASSES = ['side-header', 'popup-wrapper', 'adjust']

const LEGEND: { color: string; text: string }[] = [
  { color: '#595959', text: '汇总条（父任务，按子任务区间汇总）' },
  { color: '#52c41a', text: '已完成' },
  { color: '#1677ff', text: '进行中' },
  { color: '#bfbfbf', text: '未开始' },
  { color: '#ff4d4f', text: '逾期（计划结束已过且未完成）' },
  { color: '#722ed1', text: '里程碑' },
]

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 导出图标题里的生成时间：YYYY-MM-DD HH:mm */
function formatStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

/** 文件名里的时间戳：YYYYMMDD-HHmm */
function formatFileStamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}`
}

/** 文件名非法字符兜底（Windows 不允许 \ / : * ? " < > |） */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned.length > 0 ? cleaned : '项目'
}

/** html-to-image 的 filter：返回 false 的节点（及其子树）不会出现在导出图中 */
function isExportableNode(domNode: HTMLElement): boolean {
  const classList = domNode?.classList
  if (!classList || typeof classList.contains !== 'function') return true
  return !EXCLUDED_EXPORT_CLASSES.some((cls) => classList.contains(cls))
}

/**
 * 由 CSS 决定、克隆时会丢失的 SVG 呈现属性。
 *
 * 根因（已在 html-to-image 1.11.13 源码里确认）：
 * clone-node.js::cloneChildren() 里对 SVG 根节点直接 `return clonedNode`，
 * 即 **整个 <svg> 子树不再逐节点执行 cloneCSSStyle**，只做一次 cloneNode(true) 深拷贝。
 * 于是依赖样式表着色的 <rect>/<path>/<text> 在克隆体里没有任何内联样式，
 * 浏览器按 SVG 初始值 fill=black 渲染 → 导出的甘特图正文整片黑（HTML 表头/图例却正常）。
 * 把 computed 颜色写成同名「呈现属性」后，深拷贝会把它一起带走，不依赖库的样式复制逻辑。
 *
 * opacity / visibility 也必须内联：拖拽手柄（.handle）在实时页面里 opacity:0 不可见，
 * 克隆体丢了这条规则后会按 opacity=1 渲染成黑色小方块贴在条两端。
 */
const SVG_PAINT_ATTRS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'visibility',
  'dominant-baseline',
  'text-anchor',
  'font-size',
  'font-weight',
  'font-family',
  'letter-spacing',
]

/**
 * 修复「导出全黑」：把导出范围内每个 SVG 元素的 computed 颜色写成同名呈现属性。
 * HTML 中的 CSS 规则优先级高于呈现属性，所以实时页面外观不变；
 * 而克隆/序列化出来的节点拿不到样式表，只能靠这些属性着色。返回还原函数。
 */
function inlineSvgPaint(root: HTMLElement): () => void {
  const nodes = Array.from(root.querySelectorAll<SVGElement>('svg, svg *'))
  const snapshot = nodes.map((el) => ({
    el,
    attrs: SVG_PAINT_ATTRS.map((name) => [name, el.getAttribute(name)] as const),
  }))
  for (const el of nodes) {
    const computed = window.getComputedStyle(el)
    for (const name of SVG_PAINT_ATTRS) {
      const value = computed.getPropertyValue(name)
      if (value) el.setAttribute(name, value)
    }
  }
  return () => {
    for (const { el, attrs } of snapshot) {
      for (const [name, value] of attrs) {
        if (value === null) el.removeAttribute(name)
        else el.setAttribute(name, value)
      }
    }
  }
}

/**
 * 复刻 frappe-gantt 的日期差函数（源码 node_modules/frappe-gantt/dist/frappe-gantt.es.js
 * 的 utils/date.js::diff），口径必须逐位一致，否则区间导出的像素偏移会和库渲染错位：
 * - day：毫秒差（含时区偏移修正）/ 86400000
 * - month：(年差×12 + 月差) + 日期/31，且日期小于基准日期时再减 1
 * - 结果统一按两位小数四舍五入（库用 Math.round(x*100)/100）
 */
function frappeDateDiff(target: Date, ganttStart: Date, unit: string): number {
  const ms =
    target.getTime() -
    ganttStart.getTime() +
    (ganttStart.getTimezoneOffset() - target.getTimezoneOffset()) * 60000
  const months =
    (target.getFullYear() - ganttStart.getFullYear()) * 12 +
    (target.getMonth() - ganttStart.getMonth()) +
    target.getDate() / 31 -
    (target.getDate() < ganttStart.getDate() ? 1 : 0)
  const table: Record<string, number> = {
    millisecond: ms,
    second: ms / 1000,
    minute: ms / 60000,
    hour: ms / 3600000,
    day: ms / 86400000,
    month: months,
    year: months / 12,
  }
  const value = table[unit] ?? table.day
  return Math.round(value * 100) / 100
}

/**
 * 把日期换算成甘特图内的横向像素偏移（与 frappe-gantt 渲染公式一致）。
 * 库内部：`x = diff(date, gantt_start, unit) / step * column_width`
 * （bar.js::compute_x 与 setup_date_values 均用此式，gantt_start 由
 * setup_gantt_dates 归一到当天 0 点）。这里不依赖库私有 API，用等价复算。
 * - day/week 视图 unit='day'、step 分别为 1 / 7
 * - month 视图 unit='month'（gantt_start 为月初，列边界即日历月）
 */
function dateToX(
  dateStr: string,
  metrics: { ganttStart: Date; columnWidth: number; unit: string; step: number },
): number {
  const target = new Date(`${dateStr}T00:00:00`)
  return (
    (frappeDateDiff(target, metrics.ganttStart, metrics.unit) / metrics.step) * metrics.columnWidth
  )
}

/** 取某日期在甘特图刻度列中的左缘像素（日期所在列的起始位置，而非日期自身的偏移） */
function dateToColumnStart(
  dateStr: string,
  metrics: { ganttStart: Date; columnWidth: number; unit: string; step: number },
): number {
  if (metrics.unit === 'month') {
    // 月视图列边界=日历月：对齐到当月 1 号（库在月视图下 gantt_start 必为月初）
    return dateToX(dayjs(dateStr).startOf('month').format('YYYY-MM-DD'), metrics)
  }
  // 天/周视图：向下取整到所在列（day step=1 时即日期自身）
  const target = new Date(`${dateStr}T00:00:00`)
  const diffDays = frappeDateDiff(target, metrics.ganttStart, 'day')
  return Math.floor(diffDays / metrics.step) * metrics.columnWidth
}

/** 取某日期所在刻度列的右缘像素（把结束日完整包进一列，避免半列截断） */
function dateToColumnEnd(
  dateStr: string,
  metrics: { ganttStart: Date; columnWidth: number; unit: string; step: number },
): number {
  if (metrics.unit === 'month') {
    // 月视图：右缘=下月初的像素位置（库的 dates 递推即 add(gantt_start, k, 'month')）
    return dateToX(dayjs(dateStr).add(1, 'month').startOf('month').format('YYYY-MM-DD'), metrics)
  }
  const target = new Date(`${dateStr}T00:00:00`)
  const diffDays = frappeDateDiff(target, metrics.ganttStart, 'day')
  return (Math.floor(diffDays / metrics.step) + 1) * metrics.columnWidth
}

/**
 * WBS 编码比较器：'1.10' 应排在 '1.2' 之后，字符串比较会得出相反结果。
 * 逐段转数字比元组；非数字段用 1e6 兜底（与后端 app/services/wbs.py::wbs_sort_key 同口径）。
 */
function compareWbsCode(a: string, b: string): number {
  const toKey = (code: string): number[] =>
    code.split('.').map((part) => {
      const value = Number.parseInt(part, 10)
      return Number.isFinite(value) ? value : 1e6
    })
  const left = toKey(a)
  const right = toKey(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** 构建 parent_id -> 直接子任务 的索引（key 为 null 表示顶级任务） */
function buildChildrenMap(tasks: TaskItem[]): Map<string | null, TaskItem[]> {
  const map = new Map<string | null, TaskItem[]>()
  for (const task of tasks) {
    const key = task.parent_id
    const list = map.get(key) ?? []
    list.push(task)
    map.set(key, list)
  }
  return map
}

/** 汇总某任务全部后代（含所有层级）的计划区间 */
function descendantRange(
  parentId: string,
  childrenMap: Map<string | null, TaskItem[]>,
): { start: string | null; end: string | null } {
  let start: string | null = null
  let end: string | null = null
  const stack: TaskItem[] = [...(childrenMap.get(parentId) ?? [])]
  while (stack.length > 0) {
    const node = stack.pop() as TaskItem
    if (node.plan_start && (!start || node.plan_start < start)) start = node.plan_start
    if (node.plan_end && (!end || node.plan_end > end)) end = node.plan_end
    const kids = childrenMap.get(node.id)
    if (kids) stack.push(...kids)
  }
  return { start, end }
}

function GanttLegend() {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px 18px',
        marginTop: 12,
        padding: '10px 12px',
        background: '#fafafa',
        border: '1px solid #f0f0f0',
        borderRadius: 6,
        fontSize: 12,
        color: '#595959',
      }}
    >
      {LEGEND.map((item) => (
        <span key={item.text} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              display: 'inline-block',
              width: 14,
              height: 14,
              borderRadius: 3,
              background: item.color,
              border: '1px solid rgba(0,0,0,0.15)',
            }}
          />
          {item.text}
        </span>
      ))}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            borderRadius: 3,
            background: '#f5f5f5',
            border: '1px solid rgba(0,0,0,0.15)',
          }}
        />
        周末 / 节假日底纹
      </span>
    </div>
  )
}

export default function GanttPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()

  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [deps, setDeps] = useState<DependencyItem[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [holidayDates, setHolidayDates] = useState<string[]>([])
  const [weekendDays, setWeekendDays] = useState<number[]>([0, 6])
  const [projectName, setProjectName] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<GanttViewMode>('Day')
  const [saving, setSaving] = useState(false)
  const [showSummary, setShowSummary] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [generatedAt, setGeneratedAt] = useState(() => formatStamp(new Date()))
  /** 导出区间（默认 null = 导出整条时间轴）；选中后只截取该区间 */
  const [exportRange, setExportRange] = useState<[Dayjs, Dayjs] | null>(null)
  const didInitRange = useRef(false)

  const exportRef = useRef<HTMLDivElement>(null)
  const ganttRef = useRef<GanttViewHandle>(null)

  const fetchData = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [taskData, milestoneData, project] = await Promise.all([
        listTasks(projectId),
        // 里程碑不是所有项目都有，失败时降级为空列表，不阻塞甘特图
        listMilestones(projectId).catch(() => [] as Milestone[]),
        getProject(projectId).catch(() => null),
      ])
      setTasks(taskData.items)
      setDeps(taskData.dependencies)
      setMilestones(milestoneData)
      setProjectName(project?.name ?? '')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载甘特图失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, message])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // 项目日历（周末定义 + 节假日）：失败时静默降级为默认周六周日
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    void (async () => {
      try {
        const calendar = await getCalendar(projectId)
        if (cancelled) return
        setHolidayDates(Array.isArray(calendar.holidays) ? calendar.holidays : [])
        if (Array.isArray(calendar.weekends) && calendar.weekends.length > 0) {
          setWeekendDays(calendar.weekends)
        }
      } catch {
        // 日历不可用时保持默认周末底纹，不影响主流程
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  /** 传给甘特图的条目 + 计划区间（用于导出图标题） */
  const { items: ganttItems, rangeStart, rangeEnd } = useMemo(() => {
    const childrenMap = buildChildrenMap(tasks)
    const sortNodes = (list: TaskItem[]) =>
      list.slice().sort((a, b) => a.sort_order - b.sort_order || compareWbsCode(a.wbs_code, b.wbs_code))

    const toItem = (task: TaskItem): GanttItemInput => ({
      id: task.id,
      name: `${task.wbs_code} ${task.name}`,
      start: task.plan_start as string,
      end: task.plan_end as string,
      progress: Math.round(task.effective_progress ?? task.progress ?? 0),
      status: task.status,
      dependencies: deps.filter((d) => d.successor_id === task.id).map((d) => d.predecessor_id),
    })

    const result: GanttItemInput[] = []

    if (showSummary) {
      // 前序遍历：父任务画汇总条，其下再画已排期的叶子任务，形成 WBS 缩进观感
      const walk = (parentId: string | null) => {
        for (const child of sortNodes(childrenMap.get(parentId) ?? [])) {
          const kids = childrenMap.get(child.id) ?? []
          if (kids.length > 0) {
            const range = descendantRange(child.id, childrenMap)
            if (range.start && range.end) {
              result.push({
                id: `${SUMMARY_PREFIX}${child.id}`,
                name: `${child.wbs_code} ${child.name}（汇总）`,
                start: range.start,
                end: range.end,
                progress: Math.round(child.effective_progress ?? child.progress ?? 0),
                custom_class: 'pt-summary',
              })
            }
            walk(child.id)
          } else if (child.plan_start && child.plan_end) {
            result.push(toItem(child))
          }
        }
      }
      walk(null)
    } else {
      for (const task of sortNodes(tasks)) {
        if (task.plan_start && task.plan_end) result.push(toItem(task))
      }
    }

    // 里程碑：零长度条目（start == end），日期取计划日期，未排期则退化为实际日期
    for (const milestone of milestones) {
      const date = milestone.plan_date ?? milestone.actual_date
      if (!date) continue
      result.push({
        id: `${MILESTONE_PREFIX}${milestone.id}`,
        name: `◆ ${milestone.name}`,
        start: date,
        end: date,
        progress: milestone.status === '已完成' ? 100 : 0,
        custom_class: 'pt-milestone',
      })
    }

    let start: string | null = null
    let end: string | null = null
    for (const item of result) {
      if (!start || item.start < start) start = item.start
      if (!end || item.end > end) end = item.end
    }
    return { items: result, rangeStart: start, rangeEnd: end }
  }, [tasks, deps, milestones, showSummary])

  // 数据首次加载后，把导出区间默认设为整条计划区间（与「导出全部」等价），用户可再收窄
  useEffect(() => {
    if (!didInitRange.current && rangeStart && rangeEnd) {
      setExportRange([dayjs(rangeStart), dayjs(rangeEnd)])
      didInitRange.current = true
    }
  }, [rangeStart, rangeEnd])

  const handleDateChange = async (taskId: string, start: string, end: string) => {
    if (taskId.startsWith(SUMMARY_PREFIX) || taskId.startsWith(MILESTONE_PREFIX)) {
      message.info('汇总条与里程碑不支持拖动改期：请在 WBS 页维护子任务日期，或在里程碑页维护里程碑')
      return
    }
    setSaving(true)
    try {
      await updateTask(taskId, { plan_start: start, plan_end: end })
      // 本地同步（不重新拉取）：仅更新这一条，甘特图不会因整体重载而丢失滚动位置
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, plan_start: start, plan_end: end } : t)),
      )
      message.success(`已保存 ${start} ~ ${end}`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '日期保存失败')
      // 失败才整体重新拉取，让拖动的条回弹到服务端真实值
      await fetchData()
    } finally {
      setSaving(false)
    }
  }

  const handleProgressChange = async (taskId: string, progress: number) => {
    if (taskId.startsWith(SUMMARY_PREFIX) || taskId.startsWith(MILESTONE_PREFIX)) {
      message.info('汇总条与里程碑的进度由子任务/里程碑状态推导，不支持直接拖动')
      return
    }
    try {
      await updateTask(taskId, { progress })
    } catch (err) {
      message.error(err instanceof Error ? err.message : '进度保存失败')
    }
  }

  const handleTaskClick = (taskId: string) => {
    if (taskId.startsWith(MILESTONE_PREFIX)) {
      const milestone = milestones.find((m) => `${MILESTONE_PREFIX}${m.id}` === taskId)
      message.info(`里程碑：${milestone?.name ?? ''}（${milestone?.plan_date ?? '未排期'}）`)
      return
    }
    message.info('提示：拖动条身改日期，拖动进度条改进度，均自动保存')
  }

  const handleExportPng = async () => {
    const node = exportRef.current
    if (!node) {
      message.error('甘特图尚未渲染完成，请稍后再导出')
      return
    }
    setExporting(true)

    /**
     * 截图完整性关键：甘特图本体有三层横向滚动容器
     * （导出壳 .pt-gantt-export → .pt-gantt-view → 库自建的 .gantt-container），
     * 默认只渲染「一屏宽」。导出前把三层统一撑到内容全宽并临时关闭 overflow，
     * 结束后用保存的 cssText 原样还原。
     */
    const ganttView = node.querySelector<HTMLElement>('.pt-gantt-view')
    const ganttContainer = node.querySelector<HTMLElement>('.gantt-container')
    const ganttSvg = node.querySelector<SVGElement>('svg.gantt')
    const gridHeader = node.querySelector<HTMLElement>('.grid-header')
    const saved: { el: HTMLElement; cssText: string }[] = []
    const remember = (el: HTMLElement | SVGElement | null) => {
      if (el) saved.push({ el: el as HTMLElement, cssText: el.style.cssText })
    }
    remember(node)
    remember(ganttView)
    remember(ganttContainer)
    remember(ganttSvg)
    remember(gridHeader)
    let restoreSvgPaint: (() => void) | null = null

    try {
      const stamp = formatStamp(new Date())
      setGeneratedAt(stamp)
      // 让「生成时间」先落盘到 DOM 再截图（React 18 的批处理需要让出一次事件循环）
      await new Promise((resolve) => window.setTimeout(resolve, 60))

      // 甘特图真实内容宽（区间夹紧用它：导出卡片本身可能比内容宽，不能用卡片宽度判断越界）
      const ganttContentW = Math.max(ganttView?.scrollWidth ?? 0, ganttContainer?.scrollWidth ?? 0)
      const contentW = Math.max(ganttContentW, node.scrollWidth, node.offsetWidth)
      /** 读取元素左右内边距 + 边框之和：把「内容宽度」换算成样式宽度，
       *  同一公式在 border-box 与 content-box 下都成立（加的是盒子额外占位） */
      const boxExtrasX = (el: Element): number => {
        const cs = window.getComputedStyle(el)
        return (
          (parseFloat(cs.paddingLeft) || 0) +
          (parseFloat(cs.paddingRight) || 0) +
          (parseFloat(cs.borderLeftWidth) || 0) +
          (parseFloat(cs.borderRightWidth) || 0)
        )
      }
      /**
       * 把元素撑到「内容宽度 + 自身左右内边距/边框 + 少量余量」：
       * 项目全局若使用 box-sizing: border-box，只写内容宽度会让右侧被裁掉几十像素。
       */
      const expand = (el: HTMLElement | null, contentWidth: number) => {
        if (!el) return
        el.style.width = `${Math.ceil(contentWidth + boxExtrasX(el) + 4)}px`
        el.style.overflow = 'visible'
      }
      expand(node, contentW)
      expand(ganttView, contentW)
      expand(ganttContainer, contentW)

      // 区间导出：把整条时间轴「平移 + 裁剪」到用户选定的日期范围。
      // frappe-gantt 1.2.2 的 start/end options 不约束渲染窗口，只能靠读取渲染后的
      // 列宽与起始日期反算像素偏移，再对 SVG 与表头做 translateX 并裁掉溢出部分。
      const metrics = exportRange ? ganttRef.current?.getMetrics() : null
      let cropWidth = contentW
      if (exportRange && (!metrics || !ganttView || !ganttSvg || !gridHeader || !ganttContainer)) {
        // 甘特图实例未就绪时拿不到像素度量：降级为整条时间轴导出，并明确告知用户
        message.warning('未能读取甘特图渲染度量，已按整条时间轴导出')
      }
      if (exportRange && metrics && ganttView && ganttSvg && gridHeader && ganttContainer) {
        const [rs, re] = exportRange
        // 起止都对齐到刻度列边界：结束日所在列必须完整纳入（避免半列截断），
        // 月视图列边界即日历月（gantt_start 为月初），天/周视图按 step 取整
        const startX = dateToColumnStart(rs.format('YYYY-MM-DD'), metrics)
        const endX = dateToColumnEnd(re.format('YYYY-MM-DD'), metrics)
        // 区间可能超出已渲染窗口：起点夹紧到可见范围，终点夹紧到内容右缘
        const maxOffsetX = Math.max(0, ganttContentW - metrics.columnWidth)
        const offsetX = Math.min(Math.max(0, startX), maxOffsetX)
        let rangeWidth = Math.max(metrics.columnWidth, endX - startX)
        if (offsetX + rangeWidth > ganttContentW) {
          rangeWidth = Math.max(metrics.columnWidth, ganttContentW - offsetX)
        }
        if (endX <= 0 || startX >= ganttContentW) {
          message.warning('所选导出区间超出当前渲染的时间范围，已按可见部分导出')
        }
        cropWidth = rangeWidth
        // 平移内层内容使区间起点对齐左边缘，再裁掉容器外的溢出
        ganttSvg.style.transform = `translateX(${-offsetX}px)`
        gridHeader.style.transform = `translateX(${-offsetX}px)`
        ganttContainer.style.overflow = 'hidden'
        ganttContainer.style.width = `${rangeWidth}px`
        node.style.overflow = 'hidden'
        // 壳层宽度按实测盒子额外占位收窄，使导出图左右边框完整、宽度与区间严格一致
        ganttView.style.width = `${Math.ceil(rangeWidth + boxExtrasX(ganttView))}px`
        node.style.width = `${Math.ceil(rangeWidth + boxExtrasX(ganttView) + boxExtrasX(node))}px`
      }

      /**
       * 全部宽度变更完成后再测量高宽：区间导出收窄宽度后，标题/图例会换行、高度变大，
       * 若沿用变更前测的高度会把图例裁掉；offsetWidth 即元素外宽（含内边距与边框）。
       */
      const nodeCS = window.getComputedStyle(node)
      const finalHeight =
        node.scrollHeight +
        (parseFloat(nodeCS.borderTopWidth) || 0) +
        (parseFloat(nodeCS.borderBottomWidth) || 0)
      const captureWidth = Math.min(node.offsetWidth, SAFE_SIDE)
      const captureHeight = Math.min(finalHeight, SAFE_SIDE)
      // canvas 单边上限约 16384px：ratio 同时作用在宽高两个方向，必须两个方向都夹紧，
      // 否则窄区间 + 高图会把高度顶破上限导致导出失败/全黑；再封顶 4 倍，避免无意义的放大
      const pixelRatio = Math.max(
        0.5,
        Math.min(
          4,
          Math.floor(Math.min(SAFE_SIDE / cropWidth, SAFE_SIDE / finalHeight) * 100) / 100,
        ),
      )
      if (cropWidth > SAFE_SIDE || finalHeight > SAFE_SIDE) {
        message.warning(
          `时间轴较宽（${Math.round(cropWidth)}×${Math.round(finalHeight)}），已自动缩小清晰度以保证图片可用；如需更清晰可切到「周/月」视图再导出`,
        )
      }

      // 兜底：把 SVG 的 fill / stroke 写成呈现属性后再截图，避免克隆丢色导致整片黑
      restoreSvgPaint = inlineSvgPaint(node)

      const dataUrl = await toPng(node, {
        pixelRatio,
        backgroundColor: '#ffffff',
        width: captureWidth,
        height: captureHeight,
        // 注意：includeStyleProperties 对 <svg> 子树无效（库会整棵跳过），
        // 颜色只能靠 inlineSvgPaint() 写成的呈现属性，见上方注释
        filter: isExportableNode,
      })

      const rangeLabel = exportRange
        ? `_${exportRange[0].format('YYYYMMDD')}-${exportRange[1].format('YYYYMMDD')}`
        : ''
      const link = document.createElement('a')
      link.download = `甘特图_${sanitizeFileName(projectName)}${rangeLabel}_${formatFileStamp(new Date())}.png`
      link.href = dataUrl
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      message.success('甘特图已导出 PNG')
    } catch (err) {
      message.error(`导出图片失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      for (const item of saved) item.el.style.cssText = item.cssText
      restoreSvgPaint?.()
      setExporting(false)
    }
  }

  const rangeText = rangeStart && rangeEnd ? `${rangeStart} ~ ${rangeEnd}` : '暂无已排期任务'
  const leafCount = tasks.filter((t) => t.plan_start && t.plan_end).length

  return (
    <div>
      <Card
        title="甘特图"
        extra={
          <Space wrap>
            <Typography.Text type="secondary">
              {loading ? '加载中…' : `${tasks.length} 个任务，${deps.length} 条依赖`}
            </Typography.Text>
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as GanttViewMode)}
              options={[
                { label: '日', value: 'Day' },
                { label: '周', value: 'Week' },
                { label: '月', value: 'Month' },
              ]}
            />
            <Checkbox checked={showSummary} onChange={(e) => setShowSummary(e.target.checked)}>
              显示汇总条
            </Checkbox>
            <Tooltip title="选择要导出的日期区间；清空（或点「全部」）则导出整条时间轴。建议配合「周/月」视图使用，图片更窄更易读。">
              <DatePicker.RangePicker
                value={exportRange}
                onChange={(v) => setExportRange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
                disabled={!rangeStart || !rangeEnd}
                allowClear
                placeholder={['导出起始日', '导出结束日']}
                style={{ width: 240 }}
              />
            </Tooltip>
            {exportRange ? (
              <Button size="small" onClick={() => setExportRange(null)}>
                全部
              </Button>
            ) : null}
            {saving ? <Tag color="processing">保存中…</Tag> : null}
            <Button onClick={() => void fetchData()} loading={loading}>
              刷新
            </Button>
            <Button type="primary" loading={exporting} onClick={() => void handleExportPng()}>
              导出图片
            </Button>
            <Button onClick={() => navigate(`/projects/${projectId}/wbs`)}>去 WBS 编辑</Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary">
          <Tag color="blue">BR-01</Tag>
          拖动任务条修改日期 / 拖动进度条改进度：拖动过程中只改变画面，<b>松开鼠标后</b>
          才一次性提交保存，因此可以连续拖 2–3 天再松手。汇总条与里程碑仅供查看。
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
          视图说明：日=逐日刻度；周=按周标注（上排月份 / 下排每周起始日）；月=逐月。导出图片建议先切到「周 / 月」视图，图片宽度更小、更易阅读；工具栏的日期区间选择器可只截取某段日期导出，不选则导出整条时间轴；进入 WBS 页会拉取最新数据。
        </Typography.Paragraph>
        {ganttItems.length === 0 && !loading ? (
          <Typography.Text type="secondary">暂无已排期任务：请先在 WBS 页为任务设置计划日期。</Typography.Text>
        ) : null}

        {/* 导出范围：标题区 + 甘特图本体 + 图例，整块作为 PNG 导出 */}
        <div ref={exportRef} className="pt-gantt-export">
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#171717' }}>
              {projectName ? `${projectName} · 项目甘特图` : '项目甘特图'}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: '#7c7c7c' }}>
              {exportRange
                ? `导出范围：${exportRange[0].format('YYYY-MM-DD')} ~ ${exportRange[1].format('YYYY-MM-DD')} ｜ `
                : '导出范围：全部时间轴 ｜ '}
              视图：{VIEW_MODE_LABEL[mode]}视图 ｜ 计划区间：{rangeText} ｜ 已排期任务 {leafCount} 项
              {showSummary ? '（含汇总条）' : ''} ｜ 生成时间：{generatedAt}
            </div>
          </div>

          <GanttView
            ref={ganttRef}
            items={ganttItems}
            viewMode={mode}
            holidayDates={holidayDates}
            weekendDays={weekendDays}
            onDateChange={(taskId, start, end) => void handleDateChange(taskId, start, end)}
            onProgressChange={(taskId, progress) => void handleProgressChange(taskId, progress)}
            onTaskClick={handleTaskClick}
            onViewModeChange={setMode}
          />

          <GanttLegend />
        </div>
      </Card>
    </div>
  )
}
