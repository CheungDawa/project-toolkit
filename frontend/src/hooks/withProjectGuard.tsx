import { useLocation, useParams } from 'react-router-dom'

import { useProjectContext } from './useProjectContext'
import ProjectGuard from '../components/ProjectGuard'

/**
 * 项目模块守卫 HOC：为项目内业务模块统一提供项目无效态。
 *
 * 用法：export default withProjectGuard(MilestonesPage)
 * - 项目 ID 无效/已删除 → 统一 404 错误页（不渲染旧数据、不误弹业务错误）
 * - 渲染时保证 URL 项目已通过 GET /projects/:id 校验
 * 原模块无需感知项目存在（保持 useParams 习惯，逻辑零侵入）。
 */
export function withProjectGuard<P extends object>(PageComponent: React.ComponentType<P>) {
  return function GuardedProjectPage(props: P) {
    const { id } = useParams<{ id: string }>()
    const location = useLocation()
    const context = useProjectContext(id)

    // 项目切换时强制子组件重新挂载：杜绝短暂显示上一个项目的数据
    const reloadKey = `${id ?? 'none'}-${location.pathname}`

    // 预热：仅当项目有效时渲染子页（子页自身仍按 projectId 拉数据，服务端二次校验归属）
    return (
      <ProjectGuard context={context}>
        {() => <PageComponent key={reloadKey} {...props} />}
      </ProjectGuard>
    )
  }
}
