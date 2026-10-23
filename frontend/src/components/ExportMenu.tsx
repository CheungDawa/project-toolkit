import {
  DownloadOutlined,
  ExportOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  PrinterOutlined,
} from '@ant-design/icons'
import { App, Button, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { useState } from 'react'

import { downloadDataUrl, downloadUrl } from '../utils/download'
import {
  buildReportHtml,
  downloadHtmlReport,
  openHtmlReport,
  type ReportConfig,
} from '../utils/reportHtml'
import { exportGanttAsPdf, exportReportAsImage, exportReportAsPdf } from '../utils/reportPdf'

/** 数据导出支持的资源类型（与后端 GET /api/exports/data?resource= 对齐） */
export type ExportResource =
  'tasks' | 'deliverables' | 'risks' | 'issues' | 'milestones' | 'retrospectives' | 'overview'

/** 数据导出文件格式 */
type DataFormat = 'csv' | 'xlsx' | 'json'

export interface ExportMenuProps {
  /** 数据导出资源标识；省略则「数据导出」分组隐藏 */
  resource?: ExportResource
  /** 项目维度资源需要传项目 id；overview（跨项目）不传 */
  projectId?: string
  /** 分享导出：生成干净自包含 HTML 报告（PDF 打印 / 下载 HTML），只含本模块相关数据 */
  shareReport?: () => ReportConfig
  /** 是否支持「分享导出 → PNG」（如甘特图原生画布截图） */
  supportsPng?: boolean
  /** 返回 PNG dataURL 的生成函数；supportsPng 为 true 时必须提供 */
  onExportPng?: () => Promise<string>
  /** 触发按钮文案（默认「导出」） */
  buttonText?: string
}

/** 数据导出格式 → 展示文案 */
const FORMAT_LABEL: Record<DataFormat, string> = {
  csv: 'CSV',
  xlsx: 'Excel',
  json: 'JSON',
}

/** 生成数据导出下载地址（与后端契约一致） */
function buildExportUrl(
  resource: ExportResource,
  projectId: string | undefined,
  format: DataFormat,
): string {
  const params = new URLSearchParams({ resource, format })
  if (projectId) params.set('project_id', projectId)
  return `/api/exports/data?${params.toString()}`
}

/** 文件名净化：去掉不适合做文件名的字符 */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || '报告'
}

/**
 * 通用导出菜单：
 * - 数据导出（CSV / Excel / JSON）：走统一后端接口 GET /api/exports/data，面向再加工；
 * - 分享导出（面向直接传阅与查看）：
 *   · 📄 单页 PDF（不分页长页）：直接生成并下载无分页截断的长页 PDF；
 *   · 🖼️ 高清长图（PNG）：直接下载 2x retina 清晰长图，方便贴入微信/邮件；
 *   · 🖨️ 分页 PDF（新窗口打印）：干净文档新窗口调起打印，适合 A4 纸质；
 *   · 🌐 HTML 报告：下载单文件 .html，双击即可离线查看。
 */
export default function ExportMenu({
  resource,
  projectId,
  shareReport,
  supportsPng = false,
  onExportPng,
  buttonText = '导出',
}: ExportMenuProps) {
  const { message } = App.useApp()
  const [dataExporting, setDataExporting] = useState(false)
  const [shareExporting, setShareExporting] = useState(false)

  /** 数据导出：拉取文件流并触发下载 */
  const handleDataExport = async (format: DataFormat) => {
    if (!resource) return
    setDataExporting(true)
    try {
      await downloadUrl(buildExportUrl(resource, projectId, format), {
        fallbackName: `${resource}-${format}`,
      })
      message.success(`已导出 ${FORMAT_LABEL[format]}`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setDataExporting(false)
    }
  }

  /** 分享导出 → 单页 PDF（直接下载 · 不分页长页） */
  const handleDirectSinglePagePdf = async () => {
    setShareExporting(true)
    message.loading({ content: '正在生成单页 PDF…', key: 'share-export', duration: 0 })
    try {
      if (supportsPng && onExportPng) {
        // 甘特图长页 PDF
        const dataUrl = await onExportPng()
        await exportGanttAsPdf(dataUrl, `甘特图_${Date.now()}.pdf`)
      } else if (shareReport) {
        // 通用业务报告长页 PDF
        const cfg = shareReport()
        await exportReportAsPdf(cfg, safeName(cfg.title) + '.pdf')
      }
      message.success({ content: '单页 PDF 已下载', key: 'share-export' })
    } catch (err) {
      message.error({
        content: err instanceof Error ? err.message : '生成单页 PDF 失败',
        key: 'share-export',
      })
    } finally {
      setShareExporting(false)
    }
  }

  /** 分享导出 → 高清长图 PNG（直接下载图片） */
  const handleDirectImage = async () => {
    setShareExporting(true)
    message.loading({ content: '正在生成高清长图…', key: 'share-export', duration: 0 })
    try {
      if (supportsPng && onExportPng) {
        const dataUrl = await onExportPng()
        downloadDataUrl(dataUrl, `甘特图_${Date.now()}.png`)
      } else if (shareReport) {
        const cfg = shareReport()
        await exportReportAsImage(cfg, safeName(cfg.title) + '.png')
      }
      message.success({ content: '高清长图已下载', key: 'share-export' })
    } catch (err) {
      message.error({
        content: err instanceof Error ? err.message : '导出图片失败',
        key: 'share-export',
      })
    } finally {
      setShareExporting(false)
    }
  }

  /** 分享导出 → 分页 PDF：干净报告新窗口打印（适合 A4 打印） */
  const handlePrintPdf = () => {
    if (!shareReport) return
    try {
      const html = buildReportHtml(shareReport())
      openHtmlReport(html, { print: true })
    } catch (err) {
      message.error(err instanceof Error ? err.message : '打开打印窗口失败')
    }
  }

  /** 分享导出 → 下载单文件 HTML 报告 */
  const handleShareHtml = () => {
    if (!shareReport) return
    try {
      const cfg = shareReport()
      downloadHtmlReport(safeName(cfg.title), buildReportHtml(cfg))
      message.success('已下载 HTML 报告，可双击打开或传阅')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '生成报告失败')
    }
  }

  const items: MenuProps['items'] = []
  if (resource) {
    items.push({
      type: 'group',
      label: '数据导出',
      children: (['csv', 'xlsx', 'json'] as const).map(format => ({
        key: `data-${format}`,
        icon: format === 'xlsx' ? <FileExcelOutlined /> : <FileTextOutlined />,
        label: FORMAT_LABEL[format],
        onClick: () => void handleDataExport(format),
      })),
    })
  }

  const shareChildren: MenuProps['items'] = []
  if (shareReport || (supportsPng && onExportPng)) {
    shareChildren.push({
      key: 'pdf-direct',
      icon: <FilePdfOutlined style={{ color: '#ff4d4f' }} />,
      label: '单页 PDF（直接下载 · 不分页）',
      onClick: () => void handleDirectSinglePagePdf(),
    })
    shareChildren.push({
      key: 'png-direct',
      icon: <FileImageOutlined style={{ color: '#1677ff' }} />,
      label: '高清长图（PNG · 方便传阅）',
      onClick: () => void handleDirectImage(),
    })
  }
  if (shareReport) {
    shareChildren.push({
      key: 'pdf-print',
      icon: <PrinterOutlined />,
      label: '分页 PDF（新窗口打印 · 适合 A4 纸）',
      onClick: handlePrintPdf,
    })
    shareChildren.push({
      key: 'html',
      icon: <DownloadOutlined />,
      label: 'HTML 报告（离线单文件）',
      onClick: handleShareHtml,
    })
  }

  if (shareChildren.length) {
    items.push({ type: 'group', label: '分享导出', children: shareChildren })
  }

  if (!items.length) return null

  return (
    <Dropdown menu={{ items }} trigger={['click']}>
      <Button icon={<ExportOutlined />} loading={dataExporting || shareExporting}>
        {buttonText}
      </Button>
    </Dropdown>
  )
}
