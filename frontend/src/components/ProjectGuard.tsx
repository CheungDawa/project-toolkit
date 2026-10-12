import { Button, Card, Result, Skeleton } from 'antd'
import { useNavigate } from 'react-router-dom'

import type { ProjectContextState } from '../hooks/useProjectContext'

/**
 * 项目上下文守卫：项目内模块统一的项目无效态。
 *
 * - loading → Skeleton
 * - 项目不存在/已删除 → 错误页 + 返回项目列表入口（不渲染任何旧数据）
 * - 网络错误 → 错误页 + 重试
 * - 正常 → 渲染子内容（children 以 project 注入）
 */
export default function ProjectGuard({
  context,
  children,
}: {
  context: ProjectContextState
  children: (project: NonNullable<ProjectContextState['project']>) => React.ReactNode
}) {
  const navigate = useNavigate()

  if (context.loading) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    )
  }

  if (context.error === 'not_found') {
    return (
      <Card>
        <Result
          status="404"
          title="项目不存在或已删除"
          subTitle="当前页面依赖的项目无法访问，可能已被删除或链接中的项目 ID 不正确。"
          extra={
            <Button type="primary" onClick={() => navigate('/projects')}>
              返回项目列表
            </Button>
          }
        />
      </Card>
    )
  }

  if (context.error === 'network' || !context.project) {
    return (
      <Card>
        <Result
          status="warning"
          title="项目信息加载失败"
          subTitle="请检查网络或后端服务状态后重试。"
          extra={
            <Button type="primary" onClick={context.reload}>
              重试
            </Button>
          }
        />
      </Card>
    )
  }

  return <>{children(context.project)}</>
}
