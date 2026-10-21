/**
 * 各模块「分享导出」报告构建器：把页面数据映射为 reportHtml 的 ReportConfig。
 * 与「数据导出」（CSV/Excel/JSON）分工：这里面向「给人看/传阅」的干净 HTML 报告。
 */
import type { TaskItem } from '../api/stage2'
import type { StakeholderItem } from '../api/stage3'
import {
  escapeHtml,
  type CellValue,
  type ReportColumn,
  type ReportConfig,
  type ReportKpi,
} from './reportHtml'

/* ============================ 干系人 ============================ */

const ATT_KEYS = ['unknown', 'resist', 'neutral', 'support', 'lead'] as const
const ATT_NAMES: Record<string, string> = {
  unknown: '不知晓',
  resist: '抵制',
  neutral: '中立',
  support: '支持',
  lead: '领导',
}
const HIGH = 4

/** 解析 participation 字符串（"支持（当前）；领导（期望）"）→ { key: 'C' | 'D' } */
function parseParticipation(text: string | null): Record<string, string> {
  const result: Record<string, string> = {}
  if (!text) return result
  for (const line of text.split(/[;；]/)) {
    const m = line.match(/^(.+?)（(当前|期望)）$/)
    if (m) {
      const key = ATT_KEYS.find(k => ATT_NAMES[k] === m[1].trim())
      if (key) result[key] = m[2] === '当前' ? 'C' : 'D'
    }
  }
  return result
}

/** 干系人管理报告（移植自用户既有 HTML 工具的导出报告范式） */
export function buildStakeholderReport(projectName: string, rows: StakeholderItem[]): ReportConfig {
  const p0 = rows.filter(r => r.priority === 'P0').length
  const p1 = rows.filter(r => r.priority === 'P1').length
  const p2 = rows.filter(r => r.priority === 'P2').length
  const hi = rows.filter(r => r.influence >= HIGH).length
  const resistUnknown = rows.filter(r => {
    const p = parseParticipation(r.participation)
    return p.resist || p.unknown
  }).length

  type Quad = 'hi-hi' | 'hi-lo' | 'lo-hi' | 'lo-lo'
  const quad: Record<Quad, StakeholderItem[]> = {
    'hi-hi': [],
    'hi-lo': [],
    'lo-hi': [],
    'lo-lo': [],
  }
  for (const r of rows) {
    if (r.influence >= HIGH && r.interest >= HIGH) quad['hi-hi'].push(r)
    else if (r.influence >= HIGH) quad['hi-lo'].push(r)
    else if (r.interest >= HIGH) quad['lo-hi'].push(r)
    else quad['lo-lo'].push(r)
  }
  const chips = (arr: StakeholderItem[]) =>
    arr.map(r => ({ name: r.name, priority: r.priority || undefined }))

  const sorted = [...rows].sort(
    (a, b) =>
      (a.org || '').localeCompare(b.org || '', 'zh') ||
      (a.sub_pos || '').localeCompare(b.sub_pos || '', 'zh') ||
      (a.name || '').localeCompare(b.name || '', 'zh'),
  )
  const orgCount: Record<string, number> = {}
  for (const r of rows) {
    const o = r.org || '未分类'
    orgCount[o] = (orgCount[o] || 0) + 1
  }

  const contactHtml = (r: StakeholderItem): CellValue => {
    const parts: string[] = []
    if (r.contact_phone) parts.push(`☎ ${escapeHtml(r.contact_phone)}`)
    if (r.contact_wechat) parts.push(`微 ${escapeHtml(r.contact_wechat)}`)
    if (r.contact_email) parts.push(`@ ${escapeHtml(r.contact_email)}`)
    return parts.length ? { html: parts.join('<br>') } : '—'
  }

  const columns: ReportColumn[] = [
    { key: 'name', header: '干系人', align: 'left', width: 150 },
    { key: 'contact', header: '联系方式', align: 'left', width: 150 },
    ...ATT_KEYS.map(k => ({ key: k, header: ATT_NAMES[k], align: 'center' as const, width: 52 })),
    { key: 'priority', header: '优先级', align: 'center', width: 70 },
    { key: 'demands', header: '需求 / 核心诉求', align: 'left', width: 220 },
    { key: 'comm', header: '沟通计划', align: 'left', width: 110 },
  ]

  const tableRows: Record<string, CellValue>[] = sorted.map(r => {
    const p = parseParticipation(r.participation)
    const row: Record<string, CellValue> = {
      org: r.org || '未分类',
      name: {
        html: `<span class="row-name">${escapeHtml(r.name)}</span>${
          r.role ? `<div class="muted" style="font-size:11px">${escapeHtml(r.role)}</div>` : ''
        }`,
      },
      contact: contactHtml(r),
      priority: r.priority
        ? { html: `<span class="priority ${r.priority}">${escapeHtml(r.priority)}</span>` }
        : '—',
      demands: {
        html: `${escapeHtml(r.demands || '') || '<span class="muted">—</span>'}${
          r.strategy
            ? `<div class="muted" style="font-size:11px">📝 ${escapeHtml(r.strategy)}</div>`
            : ''
        }`,
      },
      comm: r.comm_frequency || '—',
    }
    for (const k of ATT_KEYS) {
      const mark = p[k]
      row[k] = {
        html: mark
          ? `<span class="att ${mark}">${mark}</span>`
          : '<span class="att empty">·</span>',
      }
    }
    return row
  })

  return {
    title: `${projectName} · 干系人管理报告`,
    subtitle: '影响力 × 关注度矩阵 · 参与程度（C 当前 / D 期望）· 优先级 · 沟通计划',
    meta: `共 ${rows.length} 位干系人 · 生成日期 ${new Date().toISOString().slice(0, 10)}`,
    kpi: [
      { label: '干系人总数', value: rows.length },
      { label: 'P0 重点管理', value: p0, tone: 'p0', sub: '高影响 × 高关注' },
      { label: 'P1 重点关注', value: p1, tone: 'p1' },
      { label: 'P2 一般跟进', value: p2, tone: 'p2' },
      { label: `高影响力(≥${HIGH})`, value: hi, tone: 'primary' },
      { label: '抵制 / 不知晓', value: resistUnknown, tone: 'warn', sub: '需重点关注' },
    ],
    sections: [
      {
        kind: 'matrix',
        title: '干系人影响力 × 关注度矩阵',
        hint: `影响力 / 关注度 1-5 分，≥${HIGH} 视为高；色块颜色即优先级（红=P0 / 黄=P1 / 绿=P2）`,
        quadrants: [
          {
            tone: 'hi-hi',
            title: '影响高 × 关注高',
            desc: '重点管理：保持紧密沟通',
            chips: chips(quad['hi-hi']),
          },
          {
            tone: 'hi-lo',
            title: '影响高 × 关注低',
            desc: '令其满意：主动沟通防患未然',
            chips: chips(quad['hi-lo']),
          },
          {
            tone: 'lo-hi',
            title: '影响低 × 关注高',
            desc: '随时告知：保持知情',
            chips: chips(quad['lo-hi']),
          },
          {
            tone: 'lo-lo',
            title: '影响低 × 关注低',
            desc: '监督即可：定期关注',
            chips: chips(quad['lo-lo']),
          },
        ],
        legend:
          '管理策略：<b>右上</b> 重点管理，保持紧密沟通；<b>左上</b> 令其满意，防患未然；<b>右下</b> 随时告知，保持知情；<b>左下</b> 监督即可。',
      },
      {
        kind: 'table',
        title: '干系人明细（按单位分组）',
        columns,
        rows: tableRows,
        groupBy: 'org',
        groupLabel: o => `${o}（${orgCount[o] || 0} 人）`,
        emptyText: '暂无干系人记录',
      },
    ],
    legend:
      '<b>参与程度</b>：C=当前，D=期望；不知晓 → 抵制 → 中立 → 支持 → 领导（参与度递增）。<br><b>优先级</b>：P0=重点管理 · P1=重点关注 · P2=一般跟进。<br><b>沟通计划</b>：A=日报 · B=周报 · E=月度远程会议 · F=线下会议。',
  }
}

/* ============================ 周期报告（日/周/月） ============================ */

export interface ReportTask {
  id: string
  name: string
  owner: string | null
  status: string | null
  progress: number
  plan_start: string | null
  plan_end: string | null
  wbs_code?: string
}
export interface ReportMilestone {
  id: string
  name: string
  plan_date: string | null
  actual_date: string | null
  status: string | null
}
export interface ReportRisk {
  id: string
  name: string
  level: string | null
  owner: string | null
  status: string
}
export interface ReportIssue {
  id: string
  name: string
  severity: string | null
  owner: string | null
  status: string
}
export interface ReportDeliverable {
  id: string
  name: string
  owner: string | null
  submit_status: string
  review_status: string
}
export interface ReportTodoItem {
  id: string
  name: string
  date: string | null
}
export interface PeriodicKpi {
  total: number
  done: number
  doing: number
  overdue: number
  progress_pct: number
  risk_open: number
  high_risk: number
  issue_open: number
}
export interface PeriodicReportInput {
  project_id?: string
  period_type: 'daily' | 'weekly' | 'monthly'
  start: string
  end: string
  generated_at?: string
  text?: string
  tasks: ReportTask[]
  milestones: ReportMilestone[]
  open_risks: ReportRisk[]
  open_issues: ReportIssue[]
  deliverables: ReportDeliverable[]
  overview_todos: {
    milestones: ReportTodoItem[]
    tasks: ReportTodoItem[]
    deliverables: ReportTodoItem[]
  }
  kpi: PeriodicKpi
}

const PERIOD_LABEL: Record<string, string> = { daily: '日报', weekly: '周报', monthly: '月报' }
const range = (s: string | null, e: string | null) => `${s || '—'} ~ ${e || '—'}`

/** 日报 / 周报 / 月报结构化报告 */
export function buildPeriodicReport(projectName: string, r: PeriodicReportInput): ReportConfig {
  const kpi: ReportKpi[] = [
    { label: '任务总数', value: r.kpi.total },
    { label: '已完成', value: r.kpi.done, tone: 'p2' },
    { label: '进行中', value: r.kpi.doing, tone: 'primary' },
    { label: '逾期', value: r.kpi.overdue, tone: 'overdue' },
    { label: '整体进度', value: `${r.kpi.progress_pct}%`, tone: 'primary' },
    { label: '开放风险', value: r.kpi.risk_open, tone: 'warn' },
    { label: '高风险', value: r.kpi.high_risk, tone: 'p0' },
    { label: '未关闭问题', value: r.kpi.issue_open, tone: 'warn' },
  ]

  const sections: ReportConfig['sections'] = []
  if (r.text && r.text.trim()) {
    sections.push({
      kind: 'html',
      title: '本期摘要',
      html: `<div style="font-size:13px;line-height:1.9;white-space:pre-wrap">${escapeHtml(r.text)}</div>`,
    })
  }
  sections.push({
    kind: 'table',
    title: '一、任务明细',
    emptyText: '本周期无任务',
    columns: [
      { key: 'wbs', header: 'WBS', align: 'left', width: 90 },
      { key: 'name', header: '任务', align: 'left' },
      { key: 'status', header: '状态', align: 'center', width: 80 },
      { key: 'owner', header: '负责人', align: 'center', width: 90 },
      { key: 'range', header: '计划起止', align: 'center', width: 170 },
      { key: 'progress', header: '进度', align: 'center', width: 70 },
    ],
    rows: r.tasks.map(t => ({
      wbs: t.wbs_code || '—',
      name: t.name,
      status: t.status || '—',
      owner: t.owner || '—',
      range: range(t.plan_start, t.plan_end),
      progress: `${Math.round((t.progress || 0) * 10) / 10}%`,
    })),
  })
  sections.push({
    kind: 'table',
    title: '二、里程碑',
    emptyText: '本周期无里程碑',
    columns: [
      { key: 'name', header: '里程碑', align: 'left' },
      { key: 'plan', header: '计划日期', align: 'center', width: 120 },
      { key: 'actual', header: '实际日期', align: 'center', width: 120 },
      { key: 'status', header: '状态', align: 'center', width: 90 },
    ],
    rows: r.milestones.map(m => ({
      name: m.name,
      plan: m.plan_date || '—',
      actual: m.actual_date || '—',
      status: m.status || '—',
    })),
  })
  sections.push({
    kind: 'table',
    title: '三、未关闭风险',
    emptyText: '无未关闭风险',
    columns: [
      { key: 'name', header: '风险', align: 'left' },
      { key: 'level', header: '等级', align: 'center', width: 80 },
      { key: 'owner', header: '负责人', align: 'center', width: 100 },
      { key: 'status', header: '状态', align: 'center', width: 90 },
    ],
    rows: r.open_risks.map(x => ({
      name: x.name,
      level: x.level || '—',
      owner: x.owner || '—',
      status: x.status || '—',
    })),
  })
  sections.push({
    kind: 'table',
    title: '四、未关闭问题',
    emptyText: '无未关闭问题',
    columns: [
      { key: 'name', header: '问题', align: 'left' },
      { key: 'sev', header: '严重度', align: 'center', width: 90 },
      { key: 'owner', header: '负责人', align: 'center', width: 100 },
      { key: 'status', header: '状态', align: 'center', width: 90 },
    ],
    rows: r.open_issues.map(x => ({
      name: x.name,
      sev: x.severity || '—',
      owner: x.owner || '—',
      status: x.status || '—',
    })),
  })
  sections.push({
    kind: 'table',
    title: '五、交付物',
    emptyText: '本周期无交付物',
    columns: [
      { key: 'name', header: '交付物', align: 'left' },
      { key: 'owner', header: '负责人', align: 'center', width: 100 },
      { key: 'submit', header: '提交状态', align: 'center', width: 110 },
      { key: 'review', header: '审核状态', align: 'center', width: 110 },
    ],
    rows: r.deliverables.map(d => ({
      name: d.name,
      owner: d.owner || '—',
      submit: d.submit_status,
      review: d.review_status,
    })),
  })

  const todoRows: Record<string, CellValue>[] = []
  const push = (label: string, arr: ReportTodoItem[]) =>
    arr.forEach(t => todoRows.push({ cat: label, name: t.name, date: t.date || '—' }))
  push('到期里程碑', r.overview_todos.milestones)
  push('逾期任务', r.overview_todos.tasks)
  push('待审核交付物', r.overview_todos.deliverables)
  sections.push({
    kind: 'table',
    title: '六、待办区（跨项目）',
    emptyText: '暂无待办',
    columns: [
      { key: 'cat', header: '类别', align: 'center', width: 140 },
      { key: 'name', header: '事项', align: 'left' },
      { key: 'date', header: '日期', align: 'center', width: 120 },
    ],
    rows: todoRows,
  })

  return {
    title: `${projectName} · ${PERIOD_LABEL[r.period_type] || '项目报告'}`,
    subtitle: '统一进度口径 · KPI 与台账同源',
    meta: `周期 ${r.start} ~ ${r.end}${
      r.generated_at ? ` · 生成于 ${r.generated_at.replace('T', ' ').slice(0, 16)}` : ''
    }`,
    kpi,
    sections,
    legend:
      '口径说明：任务 / 里程碑 / 交付物按本周期过滤；未关闭风险 / 问题为全量未关闭项；待办区为跨项目聚合；KPI 来自统一进度口径。',
  }
}

/* ============================ 列表页通用表 ============================ */

/** 由显式列 + 行数据生成单表报告 */
export function tableReport(opts: {
  title: string
  subtitle?: string
  meta?: string
  columns: ReportColumn[]
  rows: Record<string, CellValue>[]
  kpi?: ReportKpi[]
  emptyText?: string
}): ReportConfig {
  return {
    title: opts.title,
    subtitle: opts.subtitle,
    meta: opts.meta ?? `生成日期 ${new Date().toISOString().slice(0, 10)}`,
    kpi: opts.kpi,
    sections: [
      { kind: 'table', columns: opts.columns, rows: opts.rows, emptyText: opts.emptyText },
    ],
  }
}

/**
 * 由 antd 列定义 + 原始数据行生成单表报告。
 *
 * 入参刻意放宽为 readonly unknown[]：页面可直接把 ColumnsType<T> 与 T[] 传进来，
 * 内部只挑选「dataIndex 为字符串」的列（天然忽略操作列 / 纯 render 计算列），
 * 其余单元格统一按 字符串/数字/null 呈现，避免把 ReactNode 带进报告。
 */
export function antdTableReport(opts: {
  title: string
  meta?: string
  columns?: readonly unknown[]
  rows?: readonly unknown[]
  emptyText?: string
}): ReportConfig {
  const cols: ReportColumn[] = []
  for (const c of opts.columns ?? []) {
    if (!c || typeof c !== 'object') continue
    const col = c as { title?: unknown; dataIndex?: unknown }
    if (typeof col.dataIndex !== 'string' || !col.dataIndex) continue
    cols.push({
      key: col.dataIndex,
      header: typeof col.title === 'string' ? col.title : col.dataIndex,
      align: 'left',
    })
  }
  const rows: Record<string, CellValue>[] = (opts.rows ?? []).map(r => {
    const rec = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    const row: Record<string, CellValue> = {}
    for (const c of cols) {
      const v = rec[c.key]
      row[c.key] = v == null ? null : typeof v === 'string' || typeof v === 'number' ? v : String(v)
    }
    return row
  })
  return tableReport({
    title: opts.title,
    meta: opts.meta,
    columns: cols,
    rows,
    emptyText: opts.emptyText,
  })
}

/* ============================ 驾驶舱总览（跨项目） ============================ */

/** 驾驶舱总览报告：KPI + 项目进度一览 + 管理预警 */
export function buildOverviewReport(data: {
  totals: {
    projects: number
    tasks: number
    tasks_done: number
    tasks_doing: number
    risks_open: number
    high_risks: number
    issues_open: number
  }
  projects: {
    id: string
    code: string
    name: string
    status: string | null
    plan_start: string | null
    plan_end: string | null
    task_total: number
    task_done: number
    progress: number
    risk_open: number
    issue_open: number
    high_risk: number
    overdue_tasks: number
    overdue_milestones: number
  }[]
  alerts: {
    severity: string
    project_label: string
    title: string
    detail: string
    days: number
  }[]
}): ReportConfig {
  const t = data.totals
  const progressPct = t.tasks ? Math.round((t.tasks_done / t.tasks) * 100) : 0
  return {
    title: '项目群驾驶舱 · 总览报告',
    subtitle: '跨项目 KPI · 项目进度一览 · 管理预警',
    meta: `共 ${t.projects} 个项目 · 生成日期 ${new Date().toISOString().slice(0, 10)}`,
    kpi: [
      { label: '项目总数', value: t.projects },
      {
        label: '任务总数',
        value: t.tasks,
        sub: `已完成 ${t.tasks_done} · 进行中 ${t.tasks_doing}`,
      },
      { label: '整体进度', value: `${progressPct}%`, tone: 'primary' },
      { label: '开放风险', value: t.risks_open, tone: 'warn', sub: `高风险 ${t.high_risks} 项` },
      { label: '未关闭问题', value: t.issues_open, tone: t.issues_open > 0 ? 'warn' : 'default' },
    ],
    sections: [
      {
        kind: 'table',
        title: '一、项目进度一览',
        emptyText: '暂无项目',
        columns: [
          { key: 'name', header: '项目', align: 'left' },
          { key: 'status', header: '状态', align: 'center', width: 90 },
          { key: 'progress', header: '整体进度', align: 'center', width: 100 },
          { key: 'tasks', header: '任务完成', align: 'center', width: 110 },
          { key: 'flags', header: '异常', align: 'left', width: 220 },
          { key: 'risk', header: '开放风险', align: 'center', width: 100 },
          { key: 'issue', header: '未关闭问题', align: 'center', width: 110 },
          { key: 'range', header: '计划起止', align: 'center', width: 180 },
        ],
        rows: data.projects.map(p => {
          const flags: string[] = []
          if (p.overdue_tasks > 0) flags.push(`任务逾期 ${p.overdue_tasks}`)
          if (p.overdue_milestones > 0) flags.push(`里程碑逾期 ${p.overdue_milestones}`)
          if (p.high_risk > 0) flags.push(`高风险 ${p.high_risk}`)
          return {
            name: {
              html: `<span class="row-name">${escapeHtml(p.name)}</span><div class="muted" style="font-size:11px">${escapeHtml(p.code)}</div>`,
            },
            status: p.status ?? '—',
            progress: `${Math.round(p.progress)}%`,
            tasks: `${p.task_done} / ${p.task_total}`,
            flags: flags.length
              ? { html: flags.map(escapeHtml).join(' · ') }
              : { html: '<span style="color:#1e8449">✓ 正常</span>' },
            risk: p.risk_open,
            issue: p.issue_open,
            range: range(p.plan_start, p.plan_end),
          }
        }),
      },
      {
        kind: 'table',
        title: '二、管理预警',
        emptyText: '暂无预警',
        columns: [
          { key: 'level', header: '级别', align: 'center', width: 90 },
          { key: 'project', header: '项目', align: 'center', width: 140 },
          { key: 'title', header: '事项', align: 'left' },
          { key: 'days', header: '逾期/临近天数', align: 'center', width: 130 },
          { key: 'detail', header: '说明', align: 'left', width: 220 },
        ],
        rows: data.alerts.map(a => ({
          level:
            a.severity === 'danger'
              ? { html: '<span class="priority P0">紧急</span>' }
              : { html: '<span class="priority P1">提醒</span>' },
          project: a.project_label,
          title: a.title,
          days: a.days,
          detail: a.detail,
        })),
      },
    ],
    legend:
      '口径说明：KPI 与「项目进度一览」来自统一进度口径；异常 = 逾期任务 / 逾期里程碑 / 高风险；预警按紧急度排序。',
  }
}

/* ============================ 甘特图排期 ============================ */

/** 甘特图排期报告：把时间轴数据落成可传阅的排期表（与 PNG 导出互补：PNG 看图，HTML 看数） */
export function buildScheduleReport(projectName: string, tasks: TaskItem[]): ReportConfig {
  const scheduled = tasks.filter(t => t.plan_start && t.plan_end)
  const dates = scheduled.flatMap(t => [t.plan_start as string, t.plan_end as string]).sort()
  const avgProgress = tasks.length
    ? Math.round(
        (tasks.reduce((s, t) => s + (t.effective_progress ?? t.progress ?? 0), 0) / tasks.length) *
          10,
      ) / 10
    : 0
  const sorted = [...tasks].sort(
    (a, b) =>
      (a.wbs_code || '').localeCompare(b.wbs_code || '', 'zh') ||
      (a.name || '').localeCompare(b.name || '', 'zh'),
  )
  return {
    title: `${projectName} · 任务排期表`,
    subtitle: '甘特图数据视图 · 仅含已排期与未排期任务清单',
    meta: `共 ${tasks.length} 个任务（已排期 ${scheduled.length}） · 时间范围 ${
      dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : '—'
    } · 生成日期 ${new Date().toISOString().slice(0, 10)}`,
    kpi: [
      { label: '任务总数', value: tasks.length },
      { label: '已排期', value: scheduled.length, tone: 'primary' },
      {
        label: '未排期',
        value: tasks.length - scheduled.length,
        tone: tasks.length - scheduled.length > 0 ? 'warn' : 'default',
      },
      { label: '平均进度', value: `${avgProgress}%`, tone: 'primary' },
    ],
    sections: [
      {
        kind: 'table',
        title: '任务排期明细',
        emptyText: '暂无任务',
        columns: [
          { key: 'wbs', header: 'WBS', align: 'left', width: 90 },
          { key: 'name', header: '任务名称', align: 'left' },
          { key: 'status', header: '状态', align: 'center', width: 80 },
          { key: 'owner', header: '负责人', align: 'center', width: 90 },
          { key: 'range', header: '计划起止', align: 'center', width: 180 },
          { key: 'duration', header: '工期(天)', align: 'center', width: 80 },
          { key: 'work', header: '工时', align: 'center', width: 70 },
          { key: 'progress', header: '进度', align: 'center', width: 70 },
        ],
        rows: sorted.map(t => ({
          wbs: t.wbs_code || '—',
          name: t.name,
          status: t.status,
          owner: t.owner ?? '—',
          range:
            t.plan_start && t.plan_end
              ? `${t.plan_start} ~ ${t.plan_end}`
              : { html: '<span class="muted">未排期</span>' },
          duration: t.duration_days ?? '—',
          work: t.work_hours ?? '—',
          progress: `${Math.round((t.effective_progress ?? t.progress ?? 0) * 10) / 10}%`,
        })),
      },
    ],
    legend:
      '口径说明：进度取任务有效进度（父任务按子任务汇总）；「未排期」表示尚未设置计划起止，不会出现在甘特图时间轴上。',
  }
}
