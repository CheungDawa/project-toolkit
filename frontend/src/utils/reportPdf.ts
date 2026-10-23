import { toJpeg, toPng } from 'html-to-image'
import { downloadBlob, downloadDataUrl } from './download'
import { buildReportContent, REPORT_CSS, type ReportConfig } from './reportHtml'

/**
 * 组装标准 PDF 1.4 单页连续文档二进制流（嵌入 JPEG 图像，零外部重型依赖）。
 *
 * 采用 ISO 32000 标准中 /Filter /DCTDecode 机制：
 * 直接把 JPEG 二进制流作为 Image XObject 嵌入，利用 /MediaBox [0 0 ptW ptH]
 * 设定单张无缝长页，页面尺寸完全自适应内容高度，彻底解决物理分页导致的表格行截断问题。
 */
export function buildSinglePagePdfBinary(
  jpegBytes: Uint8Array,
  imgW: number,
  imgH: number,
  ptW: number,
  ptH: number,
): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = []

  function write(str: string) {
    chunks.push(enc.encode(str))
  }

  function startObj(num: number) {
    const total = chunks.reduce((acc, c) => acc + c.length, 0)
    offsets[num] = total
    write(`${num} 0 obj\n`)
  }

  // PDF 1.4 Header + binary marker
  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')

  // 1: Catalog
  startObj(1)
  write('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

  // 2: Pages
  startObj(2)
  write('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')

  // 3: Page (单页长页，无物理分页)
  startObj(3)
  write(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW.toFixed(2)} ${ptH.toFixed(2)}] /Resources << /XObject << /Img 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>\nendobj\n`,
  )

  // 4: Image XObject (直接复用 JPEG 字节流)
  startObj(4)
  const imgHead = `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  write(imgHead)
  chunks.push(jpegBytes)
  write('\nendstream\nendobj\n')

  // 5: Contents (将图像拉伸铺满整页点阵范围)
  startObj(5)
  const streamContent = `q ${ptW.toFixed(2)} 0 0 ${ptH.toFixed(2)} 0 0 cm /Img Do Q\n`
  const streamBytes = enc.encode(streamContent)
  write(`<< /Length ${streamBytes.length} >>\nstream\n`)
  chunks.push(streamBytes)
  write('endstream\nendobj\n')

  // xref 表
  const xrefOffset = chunks.reduce((acc, c) => acc + c.length, 0)
  write('xref\n0 6\n0000000000 65535 f \n')
  for (let i = 1; i <= 5; i++) {
    const offStr = String(offsets[i]).padStart(10, '0')
    write(`${offStr} 00000 n \n`)
  }
  write(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

  const totalLen = chunks.reduce((acc, c) => acc + c.length, 0)
  const res = new Uint8Array(totalLen)
  let cur = 0
  for (const c of chunks) {
    res.set(c, cur)
    cur += c.length
  }
  return res
}

/**
 * 将任意 dataURL（PNG 或 JPEG）转换为单页不分页连续 PDF 的 Blob。
 */
export async function dataUrlToSinglePagePdf(
  dataUrl: string,
  targetWidthPx?: number,
  targetHeightPx?: number,
): Promise<Blob> {
  let jpegDataUrl = dataUrl
  let widthPx = targetWidthPx ?? 0
  let heightPx = targetHeightPx ?? 0
  let naturalW = 0
  let naturalH = 0

  if (!dataUrl.startsWith('data:image/jpeg')) {
    // PNG 或其他格式通过 canvas 转码为高画质 JPEG
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    naturalW = img.naturalWidth
    naturalH = img.naturalHeight
    if (!widthPx) widthPx = naturalW / 2
    if (!heightPx) heightPx = naturalH / 2

    const canvas = document.createElement('canvas')
    canvas.width = naturalW
    canvas.height = naturalH
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, naturalW, naturalH)
      ctx.drawImage(img, 0, 0)
      jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95)
    }
  } else if (!widthPx || !heightPx) {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    naturalW = img.naturalWidth
    naturalH = img.naturalHeight
    widthPx = naturalW / 2
    heightPx = naturalH / 2
  }

  const base64 = jpegDataUrl.split(',')[1]
  const binary = atob(base64)
  const jpegBytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    jpegBytes[i] = binary.charCodeAt(i)
  }

  // 1 CSS px = 0.75 pt (72 pt / 96 px)
  const ptW = widthPx * 0.75
  const ptH = heightPx * 0.75
  const imgW = naturalW || Math.round(widthPx * 2)
  const imgH = naturalH || Math.round(heightPx * 2)

  const pdfBytes = buildSinglePagePdfBinary(jpegBytes, imgW, imgH, ptW, ptH)
  return new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' })
}

/**
 * 在离线 DOM 舞台中渲染 ReportConfig 并生成高清 PNG dataURL。
 */
export async function renderReportToPngDataUrl(cfg: ReportConfig): Promise<string> {
  const host = document.createElement('div')
  host.className = 'report-render-stage'
  host.style.cssText =
    'position:fixed;left:-99999px;top:0;width:1120px;background:#eef2f6;padding:24px;z-index:-9999;overflow:visible;'
  host.innerHTML = `<style>${REPORT_CSS}</style>${buildReportContent(cfg)}`
  document.body.appendChild(host)
  try {
    // 留出一帧等待字体与图表布局计算
    await new Promise(r => setTimeout(r, 80))
    return await toPng(host, {
      quality: 0.95,
      pixelRatio: 2,
      backgroundColor: '#eef2f6',
    })
  } finally {
    document.body.removeChild(host)
  }
}

/**
 * 在离线 DOM 舞台中渲染 ReportConfig 并生成单页连续 PDF Blob。
 */
export async function renderReportToPdfBlob(cfg: ReportConfig): Promise<Blob> {
  const host = document.createElement('div')
  host.className = 'report-render-stage'
  host.style.cssText =
    'position:fixed;left:-99999px;top:0;width:1120px;background:#eef2f6;padding:24px;z-index:-9999;overflow:visible;'
  host.innerHTML = `<style>${REPORT_CSS}</style>${buildReportContent(cfg)}`
  document.body.appendChild(host)
  try {
    await new Promise(r => setTimeout(r, 80))
    const widthPx = host.offsetWidth
    const heightPx = host.scrollHeight
    const jpegDataUrl = await toJpeg(host, {
      quality: 0.95,
      pixelRatio: 2,
      backgroundColor: '#eef2f6',
    })
    return await dataUrlToSinglePagePdf(jpegDataUrl, widthPx, heightPx)
  } finally {
    document.body.removeChild(host)
  }
}

/** 导出通用报告为单页不分页长 PDF 文件 */
export async function exportReportAsPdf(cfg: ReportConfig, filename: string): Promise<void> {
  const blob = await renderReportToPdfBlob(cfg)
  downloadBlob(blob, filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}

/** 导出通用报告为高清长图 PNG 文件 */
export async function exportReportAsImage(cfg: ReportConfig, filename: string): Promise<void> {
  const dataUrl = await renderReportToPngDataUrl(cfg)
  downloadDataUrl(dataUrl, filename.endsWith('.png') ? filename : `${filename}.png`)
}

/** 导出甘特图（传入 PNG dataURL）为单页连续 PDF 文件 */
export async function exportGanttAsPdf(pngDataUrl: string, filename: string): Promise<void> {
  const blob = await dataUrlToSinglePagePdf(pngDataUrl)
  downloadBlob(blob, filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}
