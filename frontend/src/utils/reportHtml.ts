/**
 * 自包含 HTML 报告引擎（分享导出专用）。
 *
 * 设计目标（对齐用户既有「干系人管理工具」的导出报告范式）：
 * - 生成一份**独立、自包含**的 HTML 文档（内联样式，无外部依赖），只含该模块相关数据，
 *   不含应用导航/筛选/按钮/分页等「不需要展示」的内容；
 * - 视觉语言与干系人工具一致：渐变头 + KPI 卡 + 矩阵 + 分组表 + 图例；
 * - 打印友好：@media print 下白底、表格不断行、可干净 Ctrl+P 存 PDF；
 * - 单文件，方便传阅：可下载 .html，或新窗口打开后一键打印为 PDF。
 *
 * 与「数据导出」（CSV/Excel/JSON）分工：数据导出面向再加工，本引擎面向「给人看」。
 */

/** HTML 转义映射 */
const escapeMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** HTML 转义（用于所有纯文本单元格/标签，防注入与破坏结构） */
export function escapeHtml(v: unknown): string {
  return String(v == null ? '' : v).replace(/[&<>"']/g, m => escapeMap[m])
}

/** KPI 卡片色调 */
export type KpiTone = 'default' | 'p0' | 'p1' | 'p2' | 'overdue' | 'warn' | 'primary'
export interface ReportKpi {
  label: string
  value: string | number
  sub?: string
  tone?: KpiTone
}

/** 单元格值：字符串/数字自动转义；{ html } 原样注入（调用方自行保证安全） */
export type CellValue = string | number | null | undefined | { html: string }

export interface ReportColumn {
  key: string
  header: string
  align?: 'left' | 'center'
  width?: number
}

export interface ReportTableSection {
  kind: 'table'
  title?: string
  columns: ReportColumn[]
  rows: Record<string, CellValue>[]
  emptyText?: string
  /** 分组行：在该 key 的行之前插入一行分组标题（colspan 整行） */
  groupBy?: string
  groupLabel?: (value: string) => string
}

export interface MatrixChip {
  name: string
  priority?: string
}
export interface MatrixQuadrant {
  title: string
  desc?: string
  chips: MatrixChip[]
  tone: 'hi-hi' | 'hi-lo' | 'lo-hi' | 'lo-lo'
}
export interface ReportMatrixSection {
  kind: 'matrix'
  title?: string
  hint?: string
  quadrants: MatrixQuadrant[]
  legend?: string
}

export interface ReportHtmlSection {
  kind: 'html'
  title?: string
  html: string
}

export type ReportSection = ReportTableSection | ReportMatrixSection | ReportHtmlSection

export interface ReportConfig {
  title: string
  subtitle?: string
  /** 元信息行：项目 · 周期 · 生成日期 等 */
  meta?: string
  kpi?: ReportKpi[]
  sections: ReportSection[]
  /** 全文尾部图例/说明（HTML） */
  legend?: string
  footerNote?: string
}

const PRIO_COLOR: Record<string, string> = { P0: '#c0392b', P1: '#e8a33d', P2: '#1e8449' }

/** KPI 数值着色 */
function kpiColor(tone: KpiTone | undefined): string {
  switch (tone) {
    case 'p0':
    case 'overdue':
      return '#c0392b'
    case 'p1':
    case 'warn':
      return '#e8a33d'
    case 'p2':
      return '#1e8449'
    case 'primary':
      return '#1a5e8a'
    default:
      return '#1c2b36'
  }
}

function cellHtml(v: CellValue): string {
  if (v == null || v === '') return '<span class="muted">—</span>'
  if (typeof v === 'object' && 'html' in v) return v.html
  return escapeHtml(v)
}

function kpiCards(kpi: ReportKpi[]): string {
  return `<div class="dash">${kpi
    .map(
      k => `<div class="card ${k.tone && k.tone !== 'default' ? k.tone : ''}">
      <div class="k">${escapeHtml(k.label)}</div>
      <div class="v" style="color:${kpiColor(k.tone)}">${escapeHtml(k.value)}</div>
      ${k.sub ? `<div class="sub">${escapeHtml(k.sub)}</div>` : ''}
    </div>`,
    )
    .join('')}</div>`
}

function tableSection(sec: ReportTableSection): string {
  const head = sec.columns
    .map(
      c =>
        `<th class="${c.align === 'left' ? 'l' : ''}"${c.width ? ` style="min-width:${c.width}px"` : ''}>${escapeHtml(c.header)}</th>`,
    )
    .join('')
  let body = ''
  if (!sec.rows.length) {
    body = `<tr><td colspan="${sec.columns.length}" class="muted empty-cell">${escapeHtml(sec.emptyText || '暂无数据')}</td></tr>`
  } else {
    let lastGroup: string | null = null
    for (const row of sec.rows) {
      if (sec.groupBy) {
        const g = String((row as Record<string, CellValue>)[sec.groupBy] ?? '')
        if (g !== lastGroup) {
          lastGroup = g
          const label = sec.groupLabel ? escapeHtml(sec.groupLabel(g)) : escapeHtml(g)
          body += `<tr class="group-row"><td colspan="${sec.columns.length}">${label}</td></tr>`
        }
      }
      const tds = sec.columns
        .map(c => `<td class="${c.align === 'left' ? 'l' : ''}">${cellHtml(row[c.key])}</td>`)
        .join('')
      body += `<tr>${tds}</tr>`
    }
  }
  return `<div class="section">
    ${sec.title ? `<h3>${escapeHtml(sec.title)}</h3>` : ''}
    <div class="tbl-wrap"><table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </div>`
}

function chip(c: MatrixChip): string {
  const bg = (c.priority && PRIO_COLOR[c.priority]) || '#6b7c8c'
  return `<span class="mini" style="background:${bg}">${escapeHtml(c.name)}</span>`
}

function matrixSection(sec: ReportMatrixSection): string {
  const quads = sec.quadrants
    .map(
      q => `<div class="quad q-${q.tone}">
      <h4>${escapeHtml(q.title)}</h4>
      ${q.desc ? `<div class="desc">${escapeHtml(q.desc)}</div>` : ''}
      <div>${q.chips.map(chip).join('') || '<span class="muted">—</span>'}</div>
    </div>`,
    )
    .join('')
  return `<div class="section">
    ${sec.title ? `<h3>${escapeHtml(sec.title)}</h3>` : ''}
    ${sec.hint ? `<div class="hint">${escapeHtml(sec.hint)}</div>` : ''}
    <div class="matrix">${quads}</div>
    ${sec.legend ? `<div class="legend">${sec.legend}</div>` : ''}
  </div>`
}

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif;background:#eef2f6;color:#1c2b36;font-size:14px;padding:20px}
.report{max-width:1200px;margin:0 auto}
.rpt-header{background:linear-gradient(135deg,#123c7a,#1a5e9e);color:#fff;border-radius:12px;padding:22px 26px;margin-bottom:16px}
.rpt-header h1{font-size:23px;font-weight:700}
.rpt-header .sub{font-size:13px;opacity:.9;margin-top:6px}
.rpt-header .meta{font-size:12px;opacity:.72;margin-top:5px}
.dash{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px}
.dash .card{background:#fff;border:1px solid #d9e2ea;border-radius:10px;padding:12px 16px}
.dash .k{font-size:12px;color:#6b7c8c}.dash .v{font-size:22px;font-weight:700;margin-top:2px}
.dash .sub{font-size:11px;color:#6b7c8c;margin-top:2px}
.section{background:#fff;border:1px solid #d9e2ea;border-radius:10px;padding:16px 18px;margin-bottom:16px}
.section h3{font-size:15px;color:#123c58;margin-bottom:10px}
.section .hint{font-size:12px;color:#6b7c8c;margin-bottom:10px}
.tbl-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:760px}
thead th{background:#eef3f8;color:#123c58;font-size:12px;font-weight:700;padding:8px 8px;text-align:center;border-bottom:2px solid #d9e2ea;white-space:nowrap}
thead th.l{text-align:left}
tbody td{padding:7px 8px;border-bottom:1px solid #edf1f5;vertical-align:top;font-size:12.5px}
tbody td.l{text-align:left}
tbody td.c{text-align:center}
.group-row td{background:#f0f5fa;font-weight:700;color:#123c58;font-size:13px}
.muted{color:#6b7c8c}
.empty-cell{text-align:center;padding:16px}
.row-name{font-weight:600;white-space:nowrap}
.priority{display:inline-block;padding:2px 9px;border-radius:12px;font-size:11px;font-weight:700;color:#fff}
.priority.P0{background:#c0392b}.priority.P1{background:#e8a33d}.priority.P2{background:#1e8449}
.att{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:4px;font-size:11px;font-weight:700;color:#fff}
.att.C{background:#1a5e8a}.att.D{background:#e8a33d}
.att.empty{background:#fff;border:1px dashed #c3cfda;color:#c3cfda}
.score{display:inline-block;min-width:24px;padding:1px 6px;border-radius:6px;text-align:center;font-size:12px;font-weight:700;background:#eef1f4;color:#6b7c8c}
.score.hi{background:#fdeceb;color:#c0392b}
.matrix{display:grid;grid-template-columns:1fr 1fr;gap:10px;min-height:160px}
.quad{border-radius:8px;padding:12px;min-height:80px}
.quad h4{font-size:13px;margin-bottom:4px}.quad .desc{font-size:11px;opacity:.85;margin-bottom:8px}
.q-hi-hi{background:#fdeceb;border:1px solid #f0c4bf}
.q-hi-lo{background:#fdf3e3;border:1px solid #ead9b0}
.q-lo-hi{background:#e8f3e8;border:1px solid #bcd8bc}
.q-lo-lo{background:#eef1f4;border:1px solid #d6dde4}
.mini{display:inline-flex;align-items:center;justify-content:center;min-width:32px;height:30px;padding:0 7px;border-radius:6px;font-size:11px;font-weight:700;color:#fff;margin:3px;white-space:nowrap}
.legend{font-size:12px;color:#6b7c8c;line-height:1.9;margin-top:10px}
.legend b{color:#1c2b36}
.rpt-foot{text-align:center;color:#6b7c8c;font-size:12px;padding:14px 0}
@media print{
  body{padding:0;background:#fff}
  .report{max-width:none}
  .rpt-header,.section,.dash .card,.quad{break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  thead th{position:static}
  tr{break-inside:avoid}
}
`

/** 组装完整自包含 HTML 文档 */
export function buildReportHtml(cfg: ReportConfig): string {
  const kpi = cfg.kpi && cfg.kpi.length ? kpiCards(cfg.kpi) : ''
  const sections = cfg.sections
    .map(s =>
      s.kind === 'table'
        ? tableSection(s)
        : s.kind === 'matrix'
          ? matrixSection(s)
          : `<div class="section">${s.title ? `<h3>${escapeHtml(s.title)}</h3>` : ''}${s.html}</div>`,
    )
    .join('')
  const legend = cfg.legend
    ? `<div class="section"><div class="legend">${cfg.legend}</div></div>`
    : ''
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(cfg.title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="report">
  <div class="rpt-header">
    <h1>${escapeHtml(cfg.title)}</h1>
    ${cfg.subtitle ? `<div class="sub">${escapeHtml(cfg.subtitle)}</div>` : ''}
    ${cfg.meta ? `<div class="meta">${escapeHtml(cfg.meta)}</div>` : ''}
  </div>
  ${kpi}
  ${sections}
  ${legend}
  <div class="rpt-foot">${escapeHtml(cfg.footerNote || '本报告由 Project Toolkit 自动生成')}</div>
</div>
</body>
</html>`
}

/** 下载 .html 文件（Blob） */
export function downloadHtmlReport(filename: string, html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.html') ? filename : `${filename}.html`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * 在新窗口打开干净报告；print=true 时加载后自动触发打印（= 只打印这份干净文档，不含应用外壳）。
 * 弹窗被拦截时退化为下载 .html。
 */
export function openHtmlReport(html: string, opts: { print?: boolean } = {}): void {
  const w = window.open('', '_blank')
  if (!w) {
    downloadHtmlReport('报告', html)
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
  if (opts.print) {
    let done = false
    const doPrint = () => {
      if (done) return
      done = true
      try {
        w.focus()
        w.print()
      } catch {
        /* 某些环境禁止跨窗口打印，用户可在新窗口手动 Ctrl+P */
      }
    }
    w.onload = doPrint
    setTimeout(doPrint, 600)
  }
}
