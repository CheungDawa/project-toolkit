# 架构整改实施报告：统一入口、项目工作空间与模块上下文

日期：2026-10-12　状态：已完成，浏览器实测逐项验收通过

## 一、问题诊断（第一、二步结论）

**实测排查结论：不存在"两套应用"，之前看到旧版页面是浏览器缓存旧 bundle + 顶部缺乏项目归属信息造成的主观感受。**

证据：
1. `GET /`、`/dashboard`、`/projects/*` 全部由同一 nginx 返回同一 `index.html`（单 SPA）；`try_files → /index.html` 正确，SPA 刷新不 404
2. 旧版 `/` 是 `<Navigate to="/dashboard">` 重定向，逻辑终点就是新版——"旧版页面"只能来自浏览器缓存
3. 全部 13 个业务模块都经 `useParams` 取项目 ID，API 均按 `project_id` 在服务端过滤（tasks.py 已核验归属与父任务归属校验），无重复项目选择状态、无 ID 与数据错配

真实缺口（本次修复的）：
- 缺面包屑，项目内页面无归属感
- 进入项目默认页是"项目详情"纯表格（无概览数据）
- 项目 ID 无效时无统一错误态（仅弹 message 且可能跳走）
- index.html 无缓存控制（旧版残留根源）
- Header 项目名取自另一份列表数据（与页面数据源不统一）

## 二、修改文件清单

| 文件 | 变更 |
| --- | --- |
| `frontend/src/App.tsx` | `/` 直接渲染 DashboardPage（不再重定向）；`/projects/:id` → 新概览页；13 个模块经 `withProjectGuard` 包装；旧详情页保留在 `/projects/:id/detail`；404 → `/` |
| `frontend/src/pages/ProjectOverviewPage.tsx` | **新增**：项目概览（指标卡/近期里程碑/风险摘要/模块快捷入口/项目档案编辑归档删除） |
| `frontend/src/hooks/useProjectContext.ts` | **新增**：项目上下文唯一事实来源（URL ID → getProject，404→not_found） |
| `frontend/src/hooks/withProjectGuard.tsx` | **新增**：模块守卫 HOC（无效项目统一 404 态；项目切换 key 重挂载防串数据） |
| `frontend/src/components/ProjectGuard.tsx` | **新增**：加载/404/网络错误三态渲染组件 |
| `frontend/src/components/AppLayout.tsx` | 面包屑（项目列表/项目名/模块名，逐级可点）；项目上下文改用 useProjectContext；侧边栏加"项目概览"菜单项与当前项目常驻标识（紫色胶囊）；菜单高亮含 `/` 与概览 |
| `docker/frontend.nginx.conf` | `/assets/` 长缓存 immutable；`/index.html` no-cache（根治旧版缓存） |

## 三、路由变化

| 路由 | 之前 | 现在 |
| --- | --- | --- |
| `/` | 重定向 `/dashboard` | 直接渲染驾驶舱（同组件） |
| `/dashboard` | 驾驶舱 | 驾驶舱（兼容保留） |
| `/projects/:id` | 旧项目详情表格 | **项目概览**（工作空间默认页） |
| `/projects/:id/detail` | — | 旧详情内容（兼容保留） |
| 其余 13 个模块路由 | 不变 | 不变，仅包守卫 |

旧 URL 全部兼容，无书签失效。

## 四、项目上下文实现方式

1. **事实来源**：每个页面仍以 URL `:id`（稳定 UUID）为准；`useProjectContext` Hook 统一 getProject 校验（项目改名不影响关联）
2. **守卫**：`withProjectGuard` 在渲染模块前先校验项目存在——无效 ID 显示"项目不存在或已删除 + 返回项目列表"，不渲染任何旧项目数据
3. **防串数据**：守卫用 `key={projectId-pathname}` 强制子组件在项目/路由切换时重挂载，杜绝短暂显示上一项目数据
4. **服务端**：所有项目级 API 按路径 `project_id` 查询过滤（既有行为，未改），创建类接口归属校验保持
5. Header 切换器/面包屑/侧边栏标识共用同一 `useProjectContext` 数据，不再各自维护

## 五、验证记录（第六步，真实浏览器）

| 验收项 | 结果 |
| --- | --- |
| `/` 直接进入新版驾驶舱（URL 保持 `/`） | ✅ 预警面板/侧边栏/统计卡齐全 |
| `/dashboard` 与 `/` 同一套布局 | ✅ 同组件渲染 |
| 刷新业务页保持路由与上下文 | ✅ risks 页 reload 后面包屑完整 |
| 项目 A 的 WBS 显示项目名 | ✅ 面包屑「项目列表/ST5-DEMO 阶段5演示项目/WBS 任务」 |
| 项目 A WBS → 甘特图上下文保持 | ✅ 同项目切换无跳变 |
| 切到项目 B（GS-004）全模块加载 B 数据 | ✅ 干系人页显示 25 条 GS-004 数据，旧项目任务不再出现 |
| 直接输入项目 B 业务 URL 恢复上下文 | ✅ stakeholders URL 直达且数据正确 |
| 无效项目 ID | ✅ 显示"项目不存在或已删除"+ 返回按钮，无旧数据 |
| 侧边栏折叠/展开/高亮/面包屑 | ✅ 折叠 64px/展开 224px/选中项高亮/面包屑逐级可点（测试点回列表、点项目名回概览） |
| 概览页数据 | ✅ 全部来自真实 API（任务/里程碑/风险/交付物），无虚构 |
| 控制台 | ✅ 0 错误 0 警告 |
| pytest | ✅ **69 passed**（回归零破坏） |
| 缓存头 | ✅ index.html → `no-cache, no-store, must-revalidate`；assets → immutable |

## 六、遗留事项

1. 低视口（约 <790px）下侧边栏菜单较长时，项目标识贴近视口底部——空间竞争的正常表现，放大视口后完整可见；如需优化可做菜单横向双列或默认折叠项目模块子菜单（本次未做，避免过度改动）
2. WBS Studio 批次 A（节点类型模型）仍是既定下一步，本次整改未触碰任务书二范围
