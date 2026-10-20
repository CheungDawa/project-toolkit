import { App, Button, Card, Checkbox, DatePicker, Segmented, Space, Tag, Tooltip, Typography } from 'antd'
import { toPng } from 'html-to-image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'

import type { GanttItemInput, GanttViewHandle, GanttViewMode } from '../components/GanttView'
import GanttView from '../components/GanttView'
import { getProject } from '../api/projects'
import type { DependencyItem, Milestone, TaskItem } from '../api/stage2'
import { getCalendar, listMilestones, listTasks, updateTask } from '../api/stage2'
// 树工具与 WbsPage 共用一个公共模块（原先两份实现只差一段重复代码，行为逐字等价）。
// 注意：descendantRange 内部按 childrenMap 对象做 WeakMap 缓存，前提是该 map 建好后不再增删 ——
// 这里在 useMemo 里现建现用、只读，满足前提；若将来改成跨渲染复用一个 map，请改调
// buildDescendantRanges() 一次拿全表，避免读到过期聚合。
import { buildChildrenMap, compareWbsCode, descendantRange } from '../utils/wbsTree'

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
 * 复刻 frappe-gantt 的日期差函数（源码 node_modules/frappe-gantt/dist/frappe-gantt.es.js:65-84
 * 的 utils/date.js::diff，dist 里压缩成单字母变量），逐行对齐如下：
 * ```js
 * i = n - t + (t.getTimezoneOffset() - n.getTimezoneOffset()) * 6e4   // 毫秒差（含时区偏移修正）
 * o = i / 1e3 / 60 / 60 / 24                                          // days
 * let l = n.getFullYear() - t.getFullYear(), _ = n.getMonth() - t.getMonth();
 * _ += n.getDate() / 31;                                               // 日期按 31 天近似
 * h = l * 12 + _;                                                      // months
 * n.getDate() < t.getDate() && h--;                                     // 跨月修正
 * return Math.round({...,months: h,...}[unit] * 100) / 100;
 * ```
 * 结论：库的月分支用的就是 `day / 31`（不是当月实际天数）+ 日期回退修正，
 * 因此这里保持同一口径（bar 位置、今日线、周末底纹都走这个 diff）。
 * 注意它**不等于**竖刻度线的位置，刻度线另见 monthColumnStartX()。
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

/** 两个日期相差多少个自然月（只看年月，不看日） */
function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
}

/**
 * 取某日期在甘特图刻度列中的左缘像素（日期所在列的起始位置，而非日期自身的偏移）。
 *
 * 月视图为什么直接用「月序号 × 列宽」而不是 frappe 的 diff：
 * 库内部渲染竖刻度线时写的是
 *   `this.view_is("month") ? t += get_days_in_month(d) * column_width / 30 : t += column_width`
 * （dist:1123），但 `view_is`（dist:1668）是 `options.view_mode.name === t` 的**大小写敏感**比较，
 * 而内置视图名是 `"Month"`（dist:762）—— 所以那段「按实际天数累加」的分支对内置月视图是死代码，
 * 刻度线实际就是等距 `column_width`。HTML 表头也是等距
 * （`get_date_info`：`x = 上一列.x + column_width`，dist:1287）。
 * 反观 diff 的月分支（day/31）会给每个月首日固定带来 `column_width/31` 的偏移
 * （实测 column_width=120 时恒定偏 3.87px），跨月天数近似完全不参与累加。
 * 因此这里按等距列取整：月序号 × columnWidth，与刻度线/表头严格一致。
 */
function dateToColumnStart(
  dateStr: string,
  metrics: { ganttStart: Date; columnWidth: number; unit: string; step: number },
): number {
  if (metrics.unit === 'month') {
    const monthStart = dayjs(dateStr).startOf('month').toDate()
    return monthsBetween(metrics.ganttStart, monthStart) * metrics.columnWidth
  }
  if (metrics.unit === 'year') {
    // 年视图当前不提供入口，按等距年列兜底（同上：view_is("year") 同样是死分支）
    const yearStart = dayjs(dateStr).startOf('year').toDate()
    return (yearStart.getFullYear() - metrics.ganttStart.getFullYear()) * metrics.columnWidth
  }
  // 天/周视图：刻度线就是等距的 column_width，向下取整到所在列即可（day step=1 时即日期自身）
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
    // 月视图：右缘 = 下一个月的列左缘（即相邻刻度线）
    const nextMonthStart = dayjs(dateStr).startOf('month').add(1, 'month').toDate()
    return monthsBetween(metrics.ganttStart, nextMonthStart) * metrics.columnWidth
  }
  if (metrics.unit === 'year') {
    const nextYearStart = dayjs(dateStr).startOf('year').add(1, 'year').toDate()
    return (nextYearStart.getFullYear() - metrics.ganttStart.getFullYear()) * metrics.columnWidth
  }
  const target = new Date(`${dateStr}T00:00:00`)
  const diffDays = frappeDateDiff(target, metrics.ganttStart, 'day')
  return (Math.floor(diffDays / metrics.step) + 1) * metrics.columnWidth
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
  /**
   * 导出进行中的重入锁。故意用 ref 而不是 state：
   * 它只在同步流程里判断，不需要触发渲染（用 state 反而会多一轮重渲染，
   * 甚至让甘特图容器在截图过程中重排）。
   */
  const exportingRef = useRef(false)

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
      const updated = await updateTask(taskId, { progress })
      /**
       * 本地同步（与 handleDateChange 同款，不能省）：
       * 甘特图只要因为**任何别的原因**重建一次（切视图、汇总条拖动归位、错误边界重挂载、
       * 数据回流），就会完全按 props 重画进度条。若这里不同步，重建后进度条会**视觉回退**
       * 到拖动前那个百分比，而服务端其实已经是新值 —— 也就是「刷新一下才对」的现象。
       * 优先用 PATCH 响应体（后端可能夹紧或重算），响应体没给该字段时退回提交值；
       * effective_progress 必须一起写，因为 item.progress 取的是
       * `effective_progress ?? progress`（见上面的 toItem）。
       */
      const nextProgress = typeof updated?.progress === 'number' ? updated.progress : progress
      const nextEffective =
        typeof updated?.effective_progress === 'number' ? updated.effective_progress : nextProgress
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, progress: nextProgress, effective_progress: nextEffective }
            : t,
        ),
      )
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
    if (exportingRef.current) return
    exportingRef.current = true
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
    /** 导出前 .pt-gantt-view 的行内 pointer-events，结束时原样恢复 */
    const previousPointerEvents = ganttView ? ganttView.style.pointerEvents : ''

    try {
      /**
       * 导出期间禁止拖拽：有人在中途拖出新的 bar 位置，截图里就会出现半截/重影
       * （拖拽会改 SVG 的 x/width，而截图是分步克隆的）。直接锁在甘特图容器上，
       * 不额外渲染任何遮罩，也不影响导出图本身（pointer-events 不参与绘制）。
       */
      if (ganttView) ganttView.style.pointerEvents = 'none'

      const stamp = formatStamp(new Date())
      /**
       * 「生成时间」必须先进 DOM 再截图。这里不再用「等 60ms」这类经验性定时：
       * flushSync 同步提交这次状态写入（DOM 立刻带新文案），
       * 再等两帧（rAF）确保浏览器完成样式重算与布局，之后读到的 scrollWidth/offsetWidth 才是终值。
       *
       * 但 rAF 在**后台标签页 / 窗口最小化**时会被暂停，只等 rAF 会让这个 await 永不返回：
       * 导出既不报错也不结束，`pointer-events: none` 一直挂在甘特图上（看起来像页面卡死）。
       * 因此与 300ms 超时赛跑：后台时靠定时器兜底往下走，此时页面没在绘制，
       * 布局同样已是最新的，量出来的尺寸依然正确。
       */
      flushSync(() => {
        setGeneratedAt(stamp)
      })
      const twoFrames = new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve())
        })
      })
      const framesTimeout = new Promise<void>((resolve) => {
        window.setTimeout(resolve, 300)
      })
      await Promise.race([twoFrames, framesTimeout])

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
        // 月视图按等距月列（月序号 × 列宽，与刻度线/表头一致），天/周视图按 step 取整
        const startX = dateToColumnStart(rs.format('YYYY-MM-DD'), metrics)
        const endX = dateToColumnEnd(re.format('YYYY-MM-DD'), metrics)
        /**
         * 三段 clamp，各管一件事：
         * ① offsetX：区间起点夹到 [0, 内容宽 - 1列]。起点早于渲染窗口时从左缘截取；
         *    起点晚于右缘时退到最后一列，至少还能导出一列。
         * ② desiredWidth：区间期望宽度 = 终点 - 起点（不足一列补足一列，避免 0 宽图）。
         *    注意起点可能为负（区间跨到渲染窗口之前），此时 endX - startX 大于实际可见量，
         *    所以还要 ③。
         * ③ availableWidth：从**未夹紧**的起点到内容右缘的可用量（同样不足一列补足一列），
         *    用 min(desired, available) 收口。原实现用「终点夹到内容右缘」，
         *    在 startX < 0 且跨度大于内容宽时会把宽度算成 contentW - offsetX 而过度收窄。
         */
        const maxOffsetX = Math.max(0, ganttContentW - metrics.columnWidth)
        const offsetX = Math.min(Math.max(0, startX), maxOffsetX)
        const desiredWidth = Math.max(metrics.columnWidth, endX - startX)
        const availableWidth = Math.max(
          metrics.columnWidth,
          ganttContentW - Math.max(0, startX),
        )
        const rangeWidth = Math.min(desiredWidth, availableWidth)
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
        /**
         * 宽度只把各层的「额外占位」算一次。
         * 原实现把 .pt-gantt-export 的 padding/border 算了两遍：先加进 style.width，
         * 随后 captureWidth = node.offsetWidth 在 content-box 下又把它加了一遍
         * → 导出图右侧多出 34px 纯白（padding 16×2 + border 1×2）。
         *
         * 现在的口径（本项目实测为 content-box）：
         * - .pt-gantt-view：width = rangeWidth（内容宽），自身 2px 边框 → 外宽 rangeWidth + 2
         * - .pt-gantt-export：width = rangeWidth + 2（正好等于 view 外宽，不留缝也不裁边）
         * - captureWidth = offsetWidth = (rangeWidth + 2) + 34 = rangeWidth + 36
         *   = 裁剪宽 + view 边框各一次 + 壳层 padding/border 各一次，左右对称
         */
        ganttView.style.width = `${Math.ceil(rangeWidth)}px`
        node.style.width = `${Math.ceil(rangeWidth + boxExtrasX(ganttView))}px`
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
      // 至少保证一个刻度列的宽度：宽度测量异常时也不至于导出成空白细条
      const minCaptureWidth = metrics ? Math.ceil(metrics.columnWidth) : 1
      const captureWidth = Math.min(Math.max(node.offsetWidth, minCaptureWidth), SAFE_SIDE)
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
      // cssText 已整体还原，但 pointer-events 可能不在快照里（本轮才加上去的），单独再兜一次
      if (ganttView) ganttView.style.pointerEvents = previousPointerEvents
      restoreSvgPaint?.()
      exportingRef.current = false
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
                /**
                 * 消掉 rc-picker 的开发期警告（它会把整个控件级 `disabled` 展开成
                 * `[true, true]` 后逐字段校验，见 rc-picker/es/PickerInput/RangePicker.js:546-559）：
                 * `disabled[i] && 该字段无值 && !allowEmpty[i]` → 报
                 * 「`disabled` should not set with empty `value`」。
                 *
                 * 本题里「无数据时必须禁用」和「禁用时 value 必然是 null」是一对无法拆开的约束，
                 * 所以只能显式声明两个字段可为空来满足它的校验前提：
                 * - 不用 `disabled={!exportRange}`：那样用户点「全部」清空区间后控件会变灰，
                 *   再也选不回来（行为变化）；
                 * - 不用「空值传 undefined」：rc-picker 的 isIndexEmpty 对 undefined 同样判空，警告照旧。
                 * 行为不变：onChange 已把「只选了一头」的区间归一成 null（= 导出全部）。
                 */
                allowEmpty={[true, true]}
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
