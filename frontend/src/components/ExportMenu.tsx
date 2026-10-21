import {
  DownloadOutlined,
  ExportOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileTextOutlined,
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

/** 数据导出支持的资源类型（与后端 GET /api/exports/data?resource= 对齐） */
export type ExportResource =
  'tasks' | 'deliverables' | 'risks' | 'issues' | 'milestones' | 'overview'

/** 数据导出文件格式 */
type DataFormat = 'csv' | 'xlsx' | 'json'

export interface ExportMenuProps {
  /** 数据导出资源标识；省略则「数据导出」分组隐藏 */
  resource?: ExportResource
  /** 项目维度资源需要传项目 id；overview（跨项目）不传 */
  projectId?: string
  /** 分享导出：生成干净自包含 HTML 报告（PDF 打印 / 下载 HTML），只含本模块相关数据 */
  shareReport?: () => ReportConfig
  /** 是否支持「分享导出 → PNG」（当前仅甘特图为 true） */
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
 * - 分享导出：
 *   · PDF —— 生成干净自包含 HTML 报告并在新窗口打印（只打印报告本身，不含应用外壳）；
 *   · HTML 报告 —— 下载单文件 .html，双击即可查看 / 传阅；
 *   · PNG —— 调用外部 onExportPng 生成 dataURL 后下载（当前仅甘特图使用）。
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
  const [pngExporting, setPngExporting] = useState(false)

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

  /** 分享导出 → PDF：干净报告新窗口打印（弹窗被拦截则退化为下载 HTML） */
  const handleSharePdf = () => {
    if (!shareReport) return
    try {
      const html = buildReportHtml(shareReport())
      openHtmlReport(html, { print: true })
    } catch (err) {
      message.error(err instanceof Error ? err.message : '生成 PDF 失败')
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

  /** 分享导出 → PNG：外部生成 dataURL 后下载 */
  const handleExportPng = async () => {
    if (!onExportPng) return
    setPngExporting(true)
    try {
      const dataUrl = await onExportPng()
      downloadDataUrl(dataUrl, `导出图_${Date.now()}.png`)
      message.success('已导出 PNG')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导出图片失败')
    } finally {
      setPngExporting(false)
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
  if (shareReport) {
    shareChildren.push({
      key: 'pdf',
      icon: <FilePdfOutlined />,
      label: 'PDF（打印）',
      onClick: handleSharePdf,
    })
    shareChildren.push({
      key: 'html',
      icon: <DownloadOutlined />,
      label: 'HTML 报告',
      onClick: handleShareHtml,
    })
  }
  if (supportsPng && onExportPng) {
    shareChildren.push({
      key: 'png',
      icon: <FileImageOutlined />,
      label: 'PNG',
      onClick: () => void handleExportPng(),
    })
  }
  if (shareChildren.length) {
    items.push({ type: 'group', label: '分享导出', children: shareChildren })
  }

  if (!items.length) return null

  return (
    <Dropdown menu={{ items }} trigger={['click']}>
      <Button icon={<ExportOutlined />} loading={dataExporting || pngExporting}>
        {buttonText}
      </Button>
    </Dropdown>
  )
}
