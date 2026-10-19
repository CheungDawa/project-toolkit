import { App, Button, Card, Checkbox, Segmented, Space, Tag, Typography } from 'antd'
import { toPng } from 'html-to-image'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import type { GanttItemInput, GanttViewMode } from '../components/GanttView'
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

  const exportRef = useRef<HTMLDivElement>(null)

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

  const handleDateChange = async (taskId: string, start: string, end: string) => {
    if (taskId.startsWith(SUMMARY_PREFIX) || taskId.startsWith(MILESTONE_PREFIX)) {
      message.info('汇总条与里程碑不支持拖动改期：请在 WBS 页维护子任务日期，或在里程碑页维护里程碑')
      return
    }
    setSaving(true)
    try {
      await updateTask(taskId, { plan_start: start, plan_end: end })
      message.success(`已更新日期 ${start} ~ ${end}（已保存，甘特图不再整体刷新，可连续拖动 2–3 天）`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '日期保存失败')
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
    const saved: { el: HTMLElement; cssText: string }[] = []
    const remember = (el: HTMLElement | null) => {
      if (el) saved.push({ el, cssText: el.style.cssText })
    }
    remember(node)
    remember(ganttView)
    remember(ganttContainer)

    try {
      const stamp = formatStamp(new Date())
      setGeneratedAt(stamp)
      // 让「生成时间」先落盘到 DOM 再截图（React 18 的批处理需要让出一次事件循环）
      await new Promise((resolve) => window.setTimeout(resolve, 60))

      const contentW = Math.max(
        node.scrollWidth,
        ganttView?.scrollWidth ?? 0,
        ganttContainer?.scrollWidth ?? 0,
        node.offsetWidth,
      )
      const contentH = node.scrollHeight
      /**
       * 把元素撑到「内容宽度 + 自身左右内边距/边框 + 少量余量」：
       * 项目全局若使用 box-sizing: border-box，只写内容宽度会让右侧被裁掉几十像素。
       */
      const expand = (el: HTMLElement | null, contentWidth: number) => {
        if (!el) return
        const cs = window.getComputedStyle(el)
        const extra =
          (parseFloat(cs.paddingLeft) || 0) +
          (parseFloat(cs.paddingRight) || 0) +
          (parseFloat(cs.borderLeftWidth) || 0) +
          (parseFloat(cs.borderRightWidth) || 0) +
          4
        el.style.width = `${Math.ceil(contentWidth + extra)}px`
        el.style.overflow = 'visible'
      }
      expand(node, contentW)
      expand(ganttView, contentW)
      expand(ganttContainer, contentW)

      // 浏览器 canvas 单边上限约 16384px，超出会导出全黑/失败。
      // 因此把截图尺寸限制到 SAFE_SIDE 内；超宽时间轴会截取左侧可见范围（标题区已写明完整计划区间）。
      const captureWidth = Math.min(contentW, SAFE_SIDE)
      const captureHeight = Math.min(contentH, SAFE_SIDE)
      const pixelRatio = Math.max(
        0.5,
        Math.floor((SAFE_SIDE / Math.max(contentW, contentH)) * 100) / 100,
      )
      if (contentW > SAFE_SIDE || contentH > SAFE_SIDE) {
        message.warning(
          `时间轴较宽（${Math.round(contentW)}×${Math.round(contentH)}），已自动缩小清晰度并截取可见范围以保证图片可用；如需完整导出请先切到「周/月」视图再导出`,
        )
      }

      const dataUrl = await toPng(node, {
        pixelRatio,
        backgroundColor: '#ffffff',
        width: captureWidth,
        height: captureHeight,
        filter: isExportableNode,
      })

      const link = document.createElement('a')
      link.download = `甘特图_${sanitizeFileName(projectName)}_${formatFileStamp(new Date())}.png`
      link.href = dataUrl
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      message.success('甘特图已导出 PNG')
    } catch (err) {
      message.error(`导出图片失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      for (const item of saved) item.el.style.cssText = item.cssText
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
          拖动任务条修改日期 / 拖动进度条改进度，变更将经后端校验并持久化；保存后甘特图不再整体刷新，可连续拖动 2–3 天。汇总条与里程碑仅供查看。
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
          视图说明：日=逐日刻度；周=按周标注（上排月份 / 下排每周起始日）；月=逐月。导出图片建议先切到「周 / 月」视图以缩小宽度、避免超宽全黑；进入 WBS 页会拉取最新数据。
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
              视图：{VIEW_MODE_LABEL[mode]}视图 ｜ 计划区间：{rangeText} ｜ 已排期任务 {leafCount} 项
              {showSummary ? '（含汇总条）' : ''} ｜ 生成时间：{generatedAt}
            </div>
          </div>

          <GanttView
            items={ganttItems}
            viewMode={mode}
            holidayDates={holidayDates}
            weekendDays={weekendDays}
            onDateChange={(taskId, start, end) => void handleDateChange(taskId, start, end)}
            onProgressChange={(taskId, progress) => void handleProgressChange(taskId, progress)}
            onTaskClick={handleTaskClick}
            onViewModeChange={setMode}
            readonly={saving}
          />

          <GanttLegend />
        </div>
      </Card>
    </div>
  )
}
