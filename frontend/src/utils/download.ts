/**
 * 统一浏览器下载工具：替代散落在各页面的 window.open / 手工拼 <a> 等实现。
 *
 * - downloadUrl: 通过 fetch 拉取文件流再以 blob 触发下载（自动带上同源 cookie，适配需登录的接口）
 * - downloadBlob: 直接下载已存在的 Blob（如后端已返回二进制）
 * - downloadDataUrl: 下载 dataURL（甘特图 PNG 等前端生成的图片）
 *
 * 所有下载都走「创建临时 object URL → 触发 <a download> 点击 → 清理」的标准流程，
 * 便于统一处理文件名解析与错误。
 */

/** 文件名解析不到时的回退值 */
const DEFAULT_FALLBACK_NAME = 'download'

/** 从响应头 Content-Disposition 解析文件名（兼容 filename* 与 filename 两种写法） */
function parseFilename(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) return fallback
  // filename*=UTF-8''xxx 优先（RFC 5987，支持中文）
  const star = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (star) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      // 解码失败，继续尝试普通 filename
    }
  }
  const plain = contentDisposition.match(/filename="?([^";]+)"?/i)
  if (plain) return plain[1]
  return fallback
}

/** 触发一次浏览器下载（blob → 临时 URL → 点击 <a> → 释放 URL） */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // 延迟释放对象 URL，确保下载已触发（部分浏览器需留一帧）
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export interface DownloadOptions {
  /** 显式指定文件名，优先级最高 */
  filename?: string
  /** 解析不到文件名时的回退名 */
  fallbackName?: string
}

/**
 * 通过 fetch 拉取文件流并下载。
 *
 * @returns 最终使用的文件名（解析自 Content-Disposition 或回退值）
 * @throws 网络/HTTP 错误时抛出 Error（message 优先取后端错误体）
 */
export async function downloadUrl(url: string, options?: DownloadOptions): Promise<string> {
  const { filename, fallbackName = DEFAULT_FALLBACK_NAME } = options ?? {}
  const resp = await fetch(url)
  if (!resp.ok) {
    let text = `下载失败（${resp.status}）`
    try {
      const payload = (await resp.json()) as { error?: { message?: string } }
      if (payload?.error?.message) text = payload.error.message
    } catch {
      // 非 JSON 错误体（如 502 的 HTML），保留默认文案
    }
    throw new Error(text)
  }
  const blob = await resp.blob()
  const resolved = filename ?? parseFilename(resp.headers.get('Content-Disposition'), fallbackName)
  triggerDownload(blob, resolved)
  return resolved
}

/** 直接下载已存在的 Blob */
export function downloadBlob(blob: Blob, filename: string): void {
  triggerDownload(blob, filename)
}

/** 下载 dataURL（甘特图 PNG 等由前端生成的图片） */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
