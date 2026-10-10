export class ApiError extends Error {
  status: number
  code: string
  fields?: Record<string, string[]>

  constructor(status: number, code: string, message: string, fields?: Record<string, string[]>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!resp.ok) {
    let code = 'http_error'
    let message = `请求失败（${resp.status}）`
    let fields: Record<string, string[]> | undefined
    try {
      const payload = await resp.json()
      if (payload?.error) {
        code = payload.error.code ?? code
        message = payload.error.message ?? message
        fields = payload.error.fields
      }
    } catch {
      // 非 JSON 错误体，保留默认文案
    }
    throw new ApiError(resp.status, code, message, fields)
  }
  if (resp.status === 204) {
    return undefined as T
  }
  return (await resp.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: (path: string) => request<void>('DELETE', path),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
}