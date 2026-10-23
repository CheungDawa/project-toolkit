import Gantt from 'frappe-gantt'
import '../assets/frappe-gantt.css'
import '../assets/gantt-extra.css'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

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

/** 不带 id 的日期区间：以 taskId 为 key 的映射表里用它，避免同一条 id 存两遍 */
interface DateRange {
  start: string
  end: string
}

/**
 * 供父组件（GanttPage）在导出时读取甘特图自身的像素度量，
 * 以便把整条时间轴「平移 + 裁剪」到用户选定的日期区间。
 * frappe-gantt 1.2.2 的 start/end options 并不约束渲染窗口，
 * 因此区间导出只能靠读取渲染后的列宽与起始日期反算像素偏移。
 */
export interface GanttViewHandle {
  getMetrics: () => {
    /** 渲染窗口左边界（含 padding），已归一到当天 0 点 */
    ganttStart: Date
    /** 单个刻度列宽（px） */
    columnWidth: number
    /** 时间单位：day / week / month / year / hour */
    unit: string
    /** 每列跨越的单位数：Day=1、Week=7、Month=1 */
    step: number
  } | null
  /** 滚动视口到「今日」（smooth 默认为 true 平滑滚动） */
  scrollToToday: (smooth?: boolean) => void
  // 注：这里曾有一个 updateTasks(patches) 用于「点对点回滚」，已删除（无调用方）。
  // 原因见 syncTaskRecordDates 的注释：库内唯一的点对点接口 update_task() 用 task._index
  // 去索引 this.bars，而 setup_tasks() 会 filter 掉非法任务，下标一旦错位就会改到别的 bar 上。
  // 回滚统一走「服务端真值回到 props → 签名变化 → 重建实例」，横向滚动位置由
  // scrollLeftRef 在重建后还原，用户视觉上不会跳回最左侧。
}

/** 库内部的任务记录（只声明我们真正读写的字段） */
interface GanttTaskRecord {
  id: string
  start: string
  end: string
  progress: number
  custom_class?: string
  /** 库自己解析出来的起止时间：定位与宽度都以它为准 */
  _start?: Date
  _end?: Date
}

/** frappe-gantt 实例上我们实际用到的字段（库未导出类型，这里自声明） */
interface GanttInstance {
  gantt_start: Date
  config: { column_width: number; unit: string; step: number }
  tasks: GanttTaskRecord[]
}

/** 内容签名的输入：凡是会影响渲染结果的东西都必须出现在这里 */
interface SignatureInput {
  items: GanttItemInput[]
  viewMode: GanttViewMode
  language: string
  holidayKey: string
  weekendKey: string
}

/** 构造期捕获到的一条 document 级监听器记录 */
interface DocumentListenerRecord {
  type: string
  handler: EventListenerOrEventListenerObject
  options?: boolean | AddEventListenerOptions
}

/**
 * 在 `run()` 执行期间捕获挂到 document 上的事件监听器，返回清单供事后逐条移除。
 *
 * 为什么需要：frappe-gantt 1.2.2 的 `bind_bar_events()` 里有
 * `document.addEventListener("mouseup", () => { t = !1; s = !1; r = !1; ...visible 移除 })`
 * （dist:1567-1571），闭包持有整个实例，而全库没有任何 `removeEventListener` 与之配对。
 * 每 `new Gantt()` 一次就永久多一个监听器（并连带保住实例与整棵 SVG 不被回收），
 * 路由来回切换会线性累积 —— 这是真正的内存泄漏，只能由调用方替库清理。
 *
 * 泄漏点的确切位置：构造函数 `setup_wrapper → setup_options → setup_tasks →
 * change_view_mode() → bind_events()`，`bind_events()` = `bind_grid_click()` +
 * `bind_holiday_labels()` + `bind_bar_events()`，只有 `bind_bar_events()` 挂到 document。
 * 注意 `change_view_mode()`（dist:945）内部也会再调一次 `render()` + `bind_events()`，
 * 也就是说**用户每切换一次库自带的视图下拉，就再漏一个监听器**（且发生在这个捕获窗口之外）。
 * 这就是我们把 `view_mode_select` 设为 false 的原因：本页用自己的 antd `Segmented` 切视图，
 * 视图模式仍然受控（viewMode prop），库的那个下拉纯属多余且带泄漏。**不要改回 true。**
 *
 * 实现：构造前把 `document.addEventListener` 临时换成记录版，构造结束立刻换回原函数
 * （`try/finally` 保证构造函数抛异常时也一定恢复）。只记录 target === document 的；
 * 库挂在 svg / .gantt-container 上的监听器随容器 DOM 一起被 GC，无需处理。
 */
function captureDocumentListeners(run: () => void): DocumentListenerRecord[] {
  const captured: DocumentListenerRecord[] = []
  const originalAdd = document.addEventListener
  const originalRemove = document.removeEventListener

  const patchedAdd = function patchedAdd(
    this: Document,
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    captured.push({ type, handler, options })
    originalAdd.call(document, type, handler, options)
  } as typeof document.addEventListener

  const patchedRemove = function patchedRemove(
    this: Document,
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    // 构造期间自行注销掉的（当前版本没出现，保险起见）就不再进清理队列，避免重复移除
    const index = captured.findIndex(item => item.type === type && item.handler === handler)
    if (index >= 0) captured.splice(index, 1)
    originalRemove.call(document, type, handler, options)
  } as typeof document.removeEventListener

  document.addEventListener = patchedAdd
  document.removeEventListener = patchedRemove
  try {
    run()
  } finally {
    document.addEventListener = originalAdd
    document.removeEventListener = originalRemove
  }
  return captured
}

/** 周末底纹颜色（frappe-gantt 的 holidays option 以颜色为 key） */
const WEEKEND_FILL = '#f5f5f5'
/** 项目日历中法定节假日的底纹颜色 */
const HOLIDAY_FILL = '#fff1f0'
/** 默认周末定义：周日(0)、周六(6) */
const DEFAULT_WEEKEND_DAYS: number[] = [0, 6]

/**
 * 汇总条 / 里程碑的 id 前缀，必须与 GanttPage 里生成这些条目时用的前缀逐字一致。
 * 不从 GanttPage import（本组件被它 import，反向依赖会成环），因此在这里以常量镜像一份。
 * 用途见 on_date_change：这两类条目在库里不可拖动，一旦被登记进待提交表，
 * 本地乐观补丁会把 bar 留在错位处（父组件对这两个前缀直接 return，不保存也不重建）。
 */
const SUMMARY_ID_PREFIX = 'summary-'
const MILESTONE_ID_PREFIX = 'ms-'

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
export function resolveBarClass(
  item: GanttItemInput,
  today: string = toDateString(new Date()),
): string {
  if (item.custom_class) return item.custom_class
  const isDone = item.status === '已完成' || item.progress >= 100
  if (isDone) return 'pt-done'
  // 字符串比较等价于日期比较：plan_end 与 today 均为 YYYY-MM-DD
  if (item.end < today) return 'pt-overdue'
  if (item.status === '进行中' || item.progress > 0) return 'pt-doing'
  return 'pt-todo'
}

/**
 * 库内部的「结束日」口径：setup_tasks 对纯日期（时分秒全为 0）会 +24h，
 * 即 `_end` 指向**结束日的次日 0 点**。同步单条任务时必须复算成同一口径，
 * 否则条形宽度会少一天（见 frappe-gantt.es.js::setup_tasks 的 `d.add(e._end, 24, 'hour')`）。
 */
function endExclusiveDateString(end: string): string {
  const date = new Date(`${end}T00:00:00`)
  date.setDate(date.getDate() + 1)
  return toDateString(date)
}

/**
 * 单个任务条的内容签名：任一字段变化都会改变签名。
 * `barClass` 默认按当前 item 实时推导；显式传入时用传入值（见 buildItemsSignature 的
 * `classOverrides` —— flush 里要用「补丁前」的颜色参与签名，理由见那里的注释）。
 */
function itemSignature(item: GanttItemInput, barClass: string = resolveBarClass(item)): string {
  const dependencies = Array.isArray(item.dependencies) ? item.dependencies.join(',') : ''
  return [item.id, item.name, item.start, item.end, item.progress, dependencies, barClass].join('|')
}

/** 签名可选项：`classOverrides` 用指定颜色类参与签名（id → 类名），缺省则实时推导 */
interface SignatureOptions {
  classOverrides?: Map<string, string>
}

/**
 * 甘特图「内容签名」：把所有会影响渲染结果的因素拍平成一个字符串。
 * 之所以用字符串而不是比对数组引用：父组件每次渲染都会产出新的 items 数组，
 * 保存成功后引用变化但内容不变，按引用比对会让整个实例被销毁重建
 * （SVG 全量重绘 + 横向滚动位置抖动 + 泄漏 document 监听器）。
 */
function buildItemsSignature(input: SignatureInput, options?: SignatureOptions): string {
  const overrides = options?.classOverrides
  return [
    input.viewMode,
    input.language,
    input.holidayKey,
    input.weekendKey,
    input.items
      .map(item => itemSignature(item, overrides?.get(item.id) ?? resolveBarClass(item)))
      .join(';'),
  ].join('§')
}

/** 把本地乐观日期覆盖到 items 上（只用于算签名，不参与真实渲染） */
function applyLocalPatches(
  items: GanttItemInput[],
  patches: Map<string, DateRange>,
): GanttItemInput[] {
  if (patches.size === 0) return items
  return items.map(item => {
    const patch = patches.get(item.id)
    return patch ? { ...item, start: patch.start, end: patch.end } : item
  })
}

/**
 * 把单条任务的起止日期同步到库内部的 task 记录上（**不移动 DOM**）。
 *
 * 为什么只写字符串、不动 bar：
 * - 拖动过程中库自己已经把 bar 移到最终位置，并在 `date_changed()` 里写好了 `_start`/`_end`；
 *   这里只需把 `start`/`end` 字符串补齐，让点击弹窗里的日期文案同步更新。
 * - 如果位置与日期不一致（库内部异常、或外部直接改了数据），这里**不做**点对点纠正：
 *   唯一的纠正手段 `gantt.update_task()` 会用 `task._index` 去索引 `this.bars`
 *   （index.js::update_task），而 `setup_tasks()` 会 `filter` 掉非法任务，
 *   一旦被过滤过，下标就与 bars 错位、可能改到别的 bar 上。宁可等下一次重建带回真值。
 *
 * 返回 true 表示「画面位置与目标日期一致」。
 */
function syncTaskRecordDates(
  gantt: GanttInstance | null,
  id: string,
  start: string,
  end: string,
): boolean {
  if (!gantt) return false
  const task = gantt.tasks.find(item => item.id === id)
  if (!task) return false
  // 非法区间直接忽略：下一次重建会带回服务端真值
  if (end < start) return false
  const exclusiveEnd = endExclusiveDateString(end)

  const positionMatchesStart = task._start ? toDateString(task._start) === start : false
  const positionMatchesEnd = task._end ? toDateString(task._end) === exclusiveEnd : false
  task.start = start
  task.end = end
  return positionMatchesStart && positionMatchesEnd
}

const GanttView = forwardRef<GanttViewHandle, GanttViewProps>(
  (
    {
      items,
      language = 'zh',
      viewMode = 'Day',
      holidayDates = [],
      weekendDays = DEFAULT_WEEKEND_DAYS,
      onDateChange,
      onProgressChange,
      onTaskClick,
      onViewModeChange,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null)
    // 仅在首次挂载时自动滚动到「今日」；后续重建（切换视图/刷新数据）保留用户当前滚动位置，避免拖动后被拉回今日
    const didScrollRef = useRef(false)
    /** 重建前记录的横向滚动位置：保存后需要重建时用它还原，避免画面跳回最左侧 */
    const scrollLeftRef = useRef(0)
    /**
     * 拖动过程中的待提交变更（taskId → 新起止日期）。
     * frappe-gantt 的 bar.js::update_bar_position 每次 pointermove 都会调用 date_changed()，
     * 因此 date_change 事件在一次拖动里会连续触发几十次；这里只登记，等鼠标释放后一次性提交。
     */
    const pendingDatesRef = useRef(new Map<string, DateRange>())
    /**
     * 本轮拖动是否落在「汇总条 / 里程碑」上。
     * 这两类条目在库里其实是**可拖的**（1.2.2 的 readonly / readonly_dates 都是全局 option，
     * 不能按任务关掉），拖完库已经把 bar 画到了错位处，而父组件对这两个前缀直接 return
     * （不 PATCH、不重建）。所以只把它们挡在待提交表外面还不够，松手后必须主动重建一次把
     * 画面拉回 props 真值，否则条形会永远停在鼠标松开的位置。
     */
    const blockedDragRef = useRef(false)
    /** frappe-gantt 实例引用：用于向父组件暴露渲染后的像素度量，并在 flush 时写回 task 记录 */
    const ganttRef = useRef<GanttInstance | null>(null)
    /**
     * 每次构造实例时库「只 add 不 remove」地挂到 document 上的监听器清单。
     * 重建时先清空，cleanup 时逐条移除（见 captureDocumentListeners）。
     */
    const documentListenersRef = useRef<DocumentListenerRecord[]>([])
    /**
     * 已经乐观写到画面上的日期补丁（taskId → 最终起止日期）。
     * 保存成功后父组件会用服务端返回值刷新 items，签名比对时把这批补丁叠加回去，
     * 于是「本地值 == 服务端值」时签名不变 → 不重建；服务端纠正了日期时签名变化 → 重建。
     * 每次真正重建后清空（新画面完全等于 props）。
     */
    const localPatchesRef = useRef(new Map<string, DateRange>())
    /** 画面上「已生效」的内容签名；null 表示还没有建立过实例 */
    const appliedSignatureRef = useRef<string | null>(null)
    /**
     * 重建开关：effect 依赖它而不是直接依赖 items。
     * 原因：React 在依赖变化时会**先跑上一次 effect 的清理**（清空容器 DOM），
     * 所以「在 effect 内部用 ref 比对后 return」并不能阻止旧实例被销毁；
     * 去重必须发生在依赖这一层，否则保存成功后的引用变化照样会重建一次。
     */
    const [rebuildNonce, setRebuildNonce] = useState(0)

    /**
     * 回调放进 ref：甘特图实例只在必要依赖变化时重建，
     * 通过 ref 读取最新回调，避免闭包里持有旧的 props。
     */
    const handlersRef = useRef({ onDateChange, onProgressChange, onTaskClick, onViewModeChange })
    handlersRef.current = { onDateChange, onProgressChange, onTaskClick, onViewModeChange }

    const scrollToToday = useCallback((smooth = true) => {
      const container = containerRef.current
      if (!container) return
      const ganttContainer = container.querySelector<HTMLElement>('.gantt-container')
      if (!ganttContainer) return

      // ① 优先从 DOM 读取库生成的 .current-highlight 绝对位置
      const highlight = container.querySelector<HTMLElement>('.current-highlight')
      let todayX = highlight ? parseFloat(highlight.style.left) || highlight.offsetLeft : 0

      // ② 若 DOM 尚未完全布局，利用实例时间轴度量高精度反算
      if (!todayX && ganttRef.current) {
        const g = ganttRef.current
        const now = new Date()
        const start = g.gantt_start
        const diffMs = now.getTime() - start.getTime()
        const diffDays = diffMs / (1000 * 60 * 60 * 24)
        const unit = g.config.unit
        const step = g.config.step || 1
        const colW = g.config.column_width || 45
        if (unit === 'month') {
          const diffMonths =
            (now.getFullYear() - start.getFullYear()) * 12 +
            (now.getMonth() - start.getMonth()) +
            now.getDate() / 31
          todayX = (diffMonths / step) * colW
        } else {
          todayX = (diffDays / step) * colW
        }
      }

      if (todayX > 0) {
        // 定位在视口左起约 1/3 处：兼顾近期上下文与后续排期
        const target = Math.max(0, todayX - ganttContainer.clientWidth / 3)
        ganttContainer.scrollTo({
          left: target,
          behavior: smooth ? 'smooth' : 'auto',
        })
        scrollLeftRef.current = target
      }
    }, [])

    // 数组 props 每次渲染都是新引用，用字符串 key 参与依赖比较，避免无谓重建
    const holidayKey = holidayDates.join('|')
    const weekendKey = weekendDays.join('|')

    const signatureInput = useMemo<SignatureInput>(
      () => ({ items, viewMode, language, holidayKey, weekendKey }),
      [items, viewMode, language, holidayKey, weekendKey],
    )
    /**
     * 供鼠标释放回调使用的最新签名输入。
     * flush 里要「按当前 props + 刚产生的本地补丁」合成签名，不能读 effect 闭包里的旧 items。
     */
    const signatureInputRef = useRef<SignatureInput>(signatureInput)
    signatureInputRef.current = signatureInput

    // ① 判定是否需要重建：内容签名变了才真正重建（保存成功但内容不变时签名相同 → 不动画面）
    useEffect(() => {
      const nextSignature = buildItemsSignature(signatureInput)
      if (appliedSignatureRef.current === null) {
        // 首帧：实例由下面的重建 effect 负责创建，这里只登记基线，避免多建一次
        appliedSignatureRef.current = nextSignature
        return
      }
      if (nextSignature === appliedSignatureRef.current) return
      appliedSignatureRef.current = nextSignature
      setRebuildNonce(nonce => nonce + 1)
    }, [signatureInput])

    // ② 真正创建 / 重建实例
    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      // 待提交变更表：整个实例生命周期只有这一份，取到局部变量即可（避免在清理函数里读 ref.current）
      const pendingDates = pendingDatesRef.current
      // 新实例完全按 props 渲染，之前的乐观补丁与「被拦下的拖动」标记全部作废
      localPatchesRef.current.clear()
      blockedDragRef.current = false
      ganttRef.current = null

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

      const ganttItems = items.map(item => ({ ...item, custom_class: resolveBarClass(item) }))

      /**
       * 构造期捕获 document 级监听器（见 captureDocumentListeners 的说明）：
       * 库只 add 不 remove，这里替它记账，cleanup 时精确移除。
       * 先清空上一批，保证 StrictMode 双挂载 / 多次重建时两批互不干扰。
       */
      documentListenersRef.current = []
      let instance: GanttInstance | null = null
      const leakedDocumentListeners = captureDocumentListeners(() => {
        instance = new Gantt(container, ganttItems, {
          language,
          snap_at: '1d',
          view_mode: viewMode,
          // 关掉库自带的视图下拉：本页用 antd Segmented 受控切换（on_view_change → onViewModeChange），
          // 库的下拉每用一次就经 change_view_mode() → bind_events() 多漏一个 document mouseup
          // 监听器（详见 captureDocumentListeners 的注释），且它不受我们控制。
          view_mode_select: false,
          // 今日按钮：默认即 true（defaults.js:157），显式声明以免被上游配置覆盖
          today_button: true,
          // 渲染后滚动到今日（defaults.js:155），今日竖线由库自身绘制（index.js:696 highlight_current）
          // 仅首次挂载滚动到今日；后续重建（切换视图/刷新）保留当前位置，避免拖动后页面被拉回今日
          // 禁用 frappe-gantt 中文日期下计算出 NaN 的 scroll_to，由组件自身精准定位
          scroll_to: undefined,
          popup_on: 'click',
          move_dependencies: true,
          // 官方 option（defaults.js:161），默认周日/周六；这里允许按项目日历覆盖
          is_weekend: (d: Date) => weekendSet.has(d.getDay()),
          holidays: holidaysOption,
          on_date_change: (task: { id: string | number }, start: Date, end: Date) => {
            // 拖动过程中会被高频触发：先登记最新日期，mouseup 时再统一提交一次（见 flushPendingDates）
            const taskId = String(task.id)
            /**
             * 汇总条与里程碑不参与日期拖动（父组件对这两个前缀直接 return）。
             * 若把它们登记进待提交表，flush 会写入本地乐观补丁并推进 applied 签名，
             * 而父组件既不保存也不重建 → bar 永远停在鼠标松手的错位处。
             * 这里在入口就滤掉，只置一个标记；松手后由 flush 主动重建一次把画面拉回真值。
             */
            if (taskId.startsWith(SUMMARY_ID_PREFIX) || taskId.startsWith(MILESTONE_ID_PREFIX)) {
              blockedDragRef.current = true
              return
            }
            pendingDates.set(taskId, {
              start: toDateString(start),
              end: toDateString(end),
            })
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
        }) as unknown as GanttInstance
      })
      documentListenersRef.current = leakedDocumentListeners
      ganttRef.current = instance

      /**
       * M3 不变量：**`new Gantt(...)` 成功返回后，`appliedSignatureRef` 必然等于「当前 props 的签名」。**
       *
       * 新实例完全按 props 渲染（localPatchesRef 已在上面清空），所以这条不变量天然成立，
       * 这里只是把它显式钉下来。意义在于：applied 是「签名去重」的唯一判据，一旦它与画面
       * 真实渲染的内容错位，后续所有「同值 props」都会被判定为「无需重建」而静默错渲染。
       * 每次重建都重设一次，等于给这条错位提供唯一的、代价最小的自愈点。
       */
      appliedSignatureRef.current = buildItemsSignature(signatureInputRef.current)

      // 还原上次重建前的横向滚动位置（保存后重新渲染不要跳回最左侧）
      const created = container.querySelector<HTMLElement>('.gantt-container')
      if (!didScrollRef.current) {
        // 首帧就绪后立即平滑/准确定位到今日
        requestAnimationFrame(() => {
          scrollToToday(false)
        })
      } else if (created) {
        // 还原上次重建前的横向滚动位置（保存后重新渲染不要跳回最左侧）
        created.scrollLeft = scrollLeftRef.current
      }
      didScrollRef.current = true

      /**
       * 鼠标释放后统一提交拖动结果（一次拖动只提交一次）。
       * 注册在 document 冒泡阶段：frappe-gantt 自己的 mouseup 监听挂在 $svg 上，
       * 会先把最终位置写回 task 并触发 date_change，随后才轮到这里的 document 监听。
       */
      const flushPendingDates = () => {
        /**
         * 汇总条 / 里程碑被拖过：不提交、不写乐观补丁，直接重建一次让条形归位。
         * 放在 pending 判断之前，因为这种情况下待提交表本来就是空的。
         */
        if (blockedDragRef.current) {
          blockedDragRef.current = false
          setRebuildNonce(nonce => nonce + 1)
        }
        if (pendingDates.size === 0) return
        const entries = Array.from(pendingDates.entries())
        pendingDates.clear()

        // ① 本地乐观落位：拖动期间库已经移动过 bar，这里把库内 task 记录（含点击弹窗里的
        //    日期文案）对齐到松手位置。只写字符串、不调 update_task（原因见 syncTaskRecordDates）
        for (const [id, range] of entries) {
          syncTaskRecordDates(ganttRef.current, id, range.start, range.end)
          localPatchesRef.current.set(id, range)
        }

        /**
         * ② 把「画面上已生效的签名」推进到拖动后的内容。
         *
         * ★ 这里有一个刻意的不对称，**不是笔误**：
         *   - **日期用补丁后的值**：拖动已经把 bar 移到新位置，画面上确实是新日期；
         *   - **颜色类用补丁前（props 原值）的 item 计算**：frappe-gantt 只在 `Bar.refresh()`
         *     里写 `custom_class`（dist:311），我们已不再调用 `update_task`/`refresh`，
         *     所以 bar 上的 class 仍然是拖动前那一个。
         *
         * 若这里拿补丁后的日期去算 `resolveBarClass`，就会把一个**画面尚未渲染**的新颜色
         * 记成「已生效」；父组件保存成功回填同样的日期后签名相等 → 永不重建 → 条形颜色
         * 被永久锁死（审查发现的 B1：逾期任务拖到未来后一直是红的）。
         *
         * 反过来用旧颜色算，则当新日期真的跨越了颜色类别（逾期 ↔ 进行中）时，
         * applied 与 props 签名必然不等 → 下一帧自动重建一次 → 新实例按真值着色；
         * 未跨类别时两者相等 → 不重建（保住滚动位置，不重绘）。
         */
        const classOverrides = new Map<string, string>()
        for (const id of localPatchesRef.current.keys()) {
          const originalItem = signatureInputRef.current.items.find(item => item.id === id)
          if (originalItem) classOverrides.set(id, resolveBarClass(originalItem))
        }

        appliedSignatureRef.current = buildItemsSignature(
          {
            ...signatureInputRef.current,
            items: applyLocalPatches(signatureInputRef.current.items, localPatchesRef.current),
          },
          { classOverrides },
        )

        // ③ 一次性提交给父组件（PATCH）
        for (const [id, range] of entries) {
          handlersRef.current.onDateChange?.(id, range.start, range.end)
        }
      }
      document.addEventListener('mouseup', flushPendingDates)
      document.addEventListener('touchend', flushPendingDates)

      /**
       * 窗口失焦（Alt+Tab、点别的应用、切标签页）时浏览器不再派发 mouseup，
       * 待提交表里会残留「半截拖动」的结果，等下一次点击被 flush 默默提交掉。
       * 失焦时直接丢弃（**不提交、不落库**）：画面位置由下一次真实拖动或服务端重建纠正。
       */
      const discardPendingDates = () => {
        pendingDates.clear()
        // 被拖动的是汇总条/里程碑时同理：画面已被库改坏，重建一次拉回真值（不提交任何日期）
        if (blockedDragRef.current) {
          blockedDragRef.current = false
          setRebuildNonce(nonce => nonce + 1)
        }
      }
      window.addEventListener('blur', discardPendingDates)

      return () => {
        document.removeEventListener('mouseup', flushPendingDates)
        document.removeEventListener('touchend', flushPendingDates)
        window.removeEventListener('blur', discardPendingDates)
        // 精确摘掉构造期库漏在 document 上的监听器（库自己从不移除），否则每次重建都净增一个
        for (const record of documentListenersRef.current) {
          document.removeEventListener(record.type, record.handler, record.options)
        }
        documentListenersRef.current = []
        pendingDates.clear()
        const live = container.querySelector<HTMLElement>('.gantt-container')
        if (live) scrollLeftRef.current = live.scrollLeft
        ganttRef.current = null
        container.innerHTML = ''
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rebuildNonce])

    useImperativeHandle(
      ref,
      () => ({
        getMetrics: () => {
          const g = ganttRef.current
          if (!g) return null
          return {
            ganttStart: g.gantt_start,
            columnWidth: g.config.column_width,
            unit: g.config.unit,
            step: g.config.step,
          }
        },
        scrollToToday,
      }),
      [scrollToToday],
    )

    return <div ref={containerRef} className="pt-gantt-view" />
  },
)

export default GanttView
