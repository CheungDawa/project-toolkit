import {
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
  /** 是否支持「分享导出 → PNG」（当前仅甘特图为 true） */
  supportsPng?: boolean
  /** 返回 PNG dataURL 的生成函数；supportsPng 为 true 时必须提供 */
  onExportPng?: () => Promise<string>
  /** 分享导出 → PDF 时打印的容器 id（默认 report-print-area） */
  printTargetId?: string
  /** 触发按钮文案（默认「导出」） */
  buttonText?: string
}

/** 数据导出格式 → 展示文案 */
const FORMAT_LABEL: Record<DataFormat, string> = {
  csv: 'CSV',
  xlsx: 'Excel',
  json: 'JSON',
}

/** 生成文件名时间戳：YYYYMMDD-HHmm */
function fileStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** 构造数据导出下载地址（与后端契约一致） */
function buildExportUrl(
  resource: ExportResource,
  projectId: string | undefined,
  format: DataFormat,
): string {
  const params = new URLSearchParams({ resource, format })
  if (projectId) params.set('project_id', projectId)
  return `/api/exports/data?${params.toString()}`
}

/**
 * 通用导出菜单：数据导出（CSV / Excel / JSON）+ 分享导出（PDF / PNG）。
 *
 * - 数据导出：调用统一后端接口 GET /api/exports/data（后端按 resource 返回带 Content-Disposition 的文件流）
 * - PDF：仅打印 printTargetId 容器（通过给 body 加 class 让 print.css 只显示该容器，打印后移除）；
 *        若页面不存在该容器，退回浏览器整页打印，避免空白页
 * - PNG：调用外部 onExportPng 生成 dataURL 后下载（当前仅甘特图使用）
 */
export default function ExportMenu({
  resource,
  projectId,
  supportsPng = false,
  onExportPng,
  printTargetId = 'report-print-area',
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

  /** 分享导出 → PDF：仅打印目标容器（不存在则整页打印） */
  const handlePrint = () => {
    const target = document.getElementById(printTargetId)
    if (!target) {
      window.print()
      return
    }
    // print.css 在 body.pt-printing 时隐藏除 [id$="-print-area"] 外的所有内容
    document.body.classList.add('pt-printing')
    const cleanup = () => {
      document.body.classList.remove('pt-printing')
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    window.print()
  }

  /** 分享导出 → PNG：外部生成 dataURL 后下载 */
  const handleExportPng = async () => {
    if (!onExportPng) return
    setPngExporting(true)
    try {
      const dataUrl = await onExportPng()
      downloadDataUrl(dataUrl, `导出图_${fileStamp()}.png`)
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
  const shareChildren: MenuProps['items'] = [
    { key: 'pdf', icon: <FilePdfOutlined />, label: 'PDF', onClick: handlePrint },
  ]
  if (supportsPng) {
    shareChildren.push({
      key: 'png',
      icon: <FileImageOutlined />,
      label: 'PNG',
      onClick: () => void handleExportPng(),
    })
  }
  items.push({ type: 'group', label: '分享导出', children: shareChildren })

  return (
    <Dropdown menu={{ items }} trigger={['click']}>
      <Button icon={<ExportOutlined />} loading={dataExporting || pngExporting}>
        {buttonText}
      </Button>
    </Dropdown>
  )
}
