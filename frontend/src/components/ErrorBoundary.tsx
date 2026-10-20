import { Button, Result, Space, Typography } from 'antd'
import { Component, Fragment } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/**
 * 渲染期错误边界（P0 健壮性）。
 *
 * 为什么必须有：页面已改为 React.lazy 按需加载，发版后仍停留在页面上的用户切页时，
 * 旧 chunk hash 已在服务端 404 → 动态 import 的 promise reject → 渲染期抛出 →
 * 没有边界时 React 会卸载整棵树，用户看到整站白屏（连侧边栏一起没了，只能强刷）。
 * 有了边界，崩掉的只是被包裹的那一块子树，外层骨架（侧边栏/顶栏）继续可用。
 *
 * 放置约定（两层，各自独立实例，不是同一个实例包自己）：
 * 1. AppLayout：Content > ErrorBoundary > Suspense > Outlet —— 单页面崩溃只毁内容区；
 * 2. App：ErrorBoundary > BrowserRouter —— 兜住布局自身（侧边栏/顶栏）崩溃。
 */

/** 界面上展示错误信息的最大长度：长堆栈直接铺到 Result.subTitle 会撑爆版面 */
const MAX_ERROR_MESSAGE_LENGTH = 200

/**
 * chunk 加载失败的特征文案（Chrome / Firefox / Safari 各异，且历史版本措辞不同）。
 * 识别出来只用于调整按钮主次与附加提示，不改变兜底行为。
 */
const CHUNK_LOAD_ERROR_PATTERNS: readonly RegExp[] = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk \S+ failed/i,
  /unable to preload css/i,
]

/** 判断是否为（动态）模块资源加载失败，而不是页面自身的逻辑错误 */
export function isChunkLoadError(error: Error): boolean {
  const message = error.message || ''
  return CHUNK_LOAD_ERROR_PATTERNS.some(pattern => pattern.test(message))
}

/** 截断过长错误信息，保留可读前缀 */
function truncateMessage(message: string): string {
  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) return message
  return `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
}

export interface ErrorBoundaryProps {
  children?: ReactNode
  /**
   * 自定义兜底渲染。默认兜底见 renderDefaultFallback。
   * reset：清除边界错误态并让子树整体重新挂载（用于「重试」）。
   */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  /** 被捕获的错误；null 表示当前子树健康 */
  error: Error | null
  /** 「重试」计数：作为子树 key，重试时强制卸载旧实例重新挂载，脱离崩溃态 */
  attempt: number
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, attempt: 0 }

  /** 渲染期同步捕获：先让界面切到兜底视图，避免「什么也没渲染」的中间帧 */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  /**
   * 提交期上报：保留现场。
   * chunk 加载失败时这里打印的 error（含 404 的模块 URL）是排查的唯一线索，务必保留。
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 兜底日志就是本条链路的排查入口（console 不在 lint 规则内，直接输出）
    console.error('[ErrorBoundary] 页面渲染异常：', error, errorInfo.componentStack)
  }

  /** 重试：清错误态 + bump key，让子树以全新实例重新渲染（数据会重新拉取） */
  private handleRetry = (): void => {
    this.setState(prev => ({ error: null, attempt: prev.attempt + 1 }))
  }

  /** 重新加载：仅在用户主动点击时刷新，不做自动刷新（避免打断操作与刷新死循环） */
  private handleReload = (): void => {
    window.location.reload()
  }

  private renderDefaultFallback(error: Error): ReactNode {
    const chunkLoadFailed = isChunkLoadError(error)
    const message = truncateMessage(error.message || String(error))

    return (
      <div
        style={{
          minHeight: 240,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 8,
        }}
      >
        <Result
          status="error"
          title="页面加载失败"
          subTitle={
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
              <Typography.Text
                type="secondary"
                style={{ display: 'block', wordBreak: 'break-word', textAlign: 'left' }}
              >
                {message}
              </Typography.Text>
              {chunkLoadFailed ? (
                <Typography.Text
                  type="secondary"
                  style={{ display: 'block', marginTop: 8, fontSize: 12, textAlign: 'left' }}
                >
                  页面资源可能已在发版中更新，请点击「重新加载」获取最新版本；本页之外的其他页面仍可正常使用。
                </Typography.Text>
              ) : null}
            </div>
          }
          extra={
            <Space>
              <Button type={chunkLoadFailed ? 'primary' : 'default'} onClick={this.handleReload}>
                重新加载
              </Button>
              <Button type={chunkLoadFailed ? 'default' : 'primary'} onClick={this.handleRetry}>
                重试
              </Button>
            </Space>
          }
        />
      </div>
    )
  }

  render(): ReactNode {
    const { error, attempt } = this.state
    const { children, fallback } = this.props

    if (error) {
      return fallback ? fallback(error, this.handleRetry) : this.renderDefaultFallback(error)
    }

    // key 变化时整块子树重新挂载：重试能真正拿到新实例，而不是复用崩溃前的旧实例
    return <Fragment key={attempt}>{children}</Fragment>
  }
}
