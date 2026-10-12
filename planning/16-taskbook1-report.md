# 任务书一实施报告：驾驶舱与看板专业化重构

日期：2026-10-12　状态：已完成并通过浏览器实测验收

## 一、范围与来源

任务书一（驾驶舱与看板重构）要求：
- 驾驶舱服务管理决策：异常项目 / 逾期里程碑 / 高优风险 / 待验收交付物 / 需协调事项，按紧急度排序
- 看板服务执行协作：拖拽改状态真实持久化 / 失败回滚 / 筛选搜索 / 任务详情面板
- 视觉克制企业级：红=异常 / 黄=预警 / 绿=正常，禁大面积渐变
- 指标口径真实可查，数据不足如实标注

## 二、后端改动（`backend/app/api/overview.py`）

`GET /api/overview` 在原 totals + projects 基础上新增：

| 字段 | 内容 |
| --- | --- |
| `alerts[]` | 五类预警统一结构：kind / severity(danger·warning) / days(逾期天数) / project_id / project_label / title / detail + 关联 id |
| `alert_summary` | `{danger, warning}` 计数 |
| projects 行新增 `overdue_tasks` `overdue_milestones` | 项目级异常标记 |

**口径（全部真实数据计算，面板底部公示）：**
1. 异常项目：plan_end < 今天且状态≠已完成 的任务，按项目聚合一条，取最迟任务的天数
2. 逾期里程碑：plan_date < 今天且 actual_date 为空；≥7 天=红，<7 天=黄
3. 高优风险：开放风险（未决/已发生）中 level=高（评分矩阵 >9）
4. 待验收交付物：已提交待审核（黄）/ 逾期未提交（红）
5. 需协调事项：开放问题中 严重度高 / 已逾期 / 责任人缺失（常规开放问题不进驾驶舱避免噪音）

排序：danger > warning，同级按逾期天数降序。

## 三、前端改动

### DashboardPage
- 保留既有暗色统计卡（用户已验收样式）
- 新增「需要关注」面板：白底克制风 + 红黄左边条 + 类型标签 + 逾期天数徽标，整行点击直达对应模块（milestones/risks/deliverables/issues/项目详情）；空态如实提示暂无事项
- 项目表新增「异常」列（任务逾期 N / 里程碑逾期 N / 高风险 N / ✓ 正常），支持按异常、进度排序；进度条改纯色（去渐变）

### KanbanPage
- 新增筛选栏：关键词（名称/WBS 编码/负责人）+ 负责人下拉（真实数据提取）+ 优先级筛选；列头显示 筛选数/总数，空列显示「无匹配任务」
- 新增任务详情抽屉：状态下拉 + 进度滑块/数字输入 + 只读字段（优先级/负责人/协作人/计划与实际周期/工时/验收标准/交付物）；保存即 PATCH 持久化，失败回滚；「去 WBS 编辑」直达
- 拖拽逻辑保留：乐观更新 + 失败回滚 + 完成态自动 100%；拖拽后 250ms 内抑制 click 误开抽屉

## 四、浏览器实测发现的缺陷与修复

### 缺陷：侧边栏把主内容推出视口（既有 bug，v1.1 起存在）
- 现象：看板页（项目模块菜单展开）整个主内容区在视口 y≈807 之外不可见；驾驶舱页（无展开菜单）内容下移 247px 侥幸可见
- 根因：外层 `<Layout>` 未声明 `hasSider`，antd 按默认纵向 flex 渲染，自定义 `<aside>` 的 `flex:'0 0 224px'` 在纵向被解释为高度，菜单展开时把内层 Layout 推到下方
- 修复：`<Layout hasSider …>`（提交 `fix(layout): add hasSider…`）
- 复验：flexDirection=row、aside 224px 左侧、main y=72 视口内

### 验证记录
- 筛选「编码」→ 1/5（筛选中），其余列「无匹配任务」✓
- 抽屉改进度 40→60 保存 → API 回读 `编码开发 | 进行中 | 60.0` ✓
- 拖拽「上线部署」未开始→进行中 → API 回读 `上线部署 | 进行中 | 0.0` ✓
- 驾驶舱预警面板：8 条（5 红 3 黄）按紧急度排序渲染 ✓，视觉模型核验无缺陷 ✓

## 五、测试基线

pytest **69 passed**（原 61 + 新增 `test_overview.py` 8 例：空库 / 逾期任务对照 / 里程碑分级 / 高风险过滤 / 交付物双口径 / 协调事项噪音控制 / 紧急度排序 / 项目隔离）

## 六、涉及文件与提交

- `backend/app/api/overview.py`（重写）
- `backend/tests/test_overview.py`（新增 8 例）
- `frontend/src/pages/DashboardPage.tsx`（预警面板 + 异常列）
- `frontend/src/pages/KanbanPage.tsx`（筛选 + 抽屉）
- `frontend/src/components/AppLayout.tsx`（hasSider 修复）
- 提交：`taskbook-1: dashboard management alerts…` / `fix(kanban): drop unused Tag import…` / `fix(layout): add hasSider…`
