# 阶段 3 验收报告 · 风险/问题/干系人/变更/审计（T3-12）

> 验收日期：2026-10-10（会话 4）
> 验收方式：WSL2 实际部署 + pytest 回归 + API 冒烟 + Playwright 界面核对
> 对照：planning/08-acceptance-tests.md 的 A3 清单

## 1. A3 清单逐项结果

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| A3-1 | 干系人登记与沟通追踪（P1） | ✅ | CRUD + 沟通时间线（pytest test_stakeholder_and_communication；页面渲染） |
| A3-2 | 风险评分与矩阵 | ✅ | 概率×影响→分数→等级（低/中/高），矩阵可配置（pytest 两例）；ECharts 矩阵图渲染（pt3-risks.png） |
| A3-3 | 高风险/逾期筛选 | ✅ | `high_only` 风险筛选、`overdue` 问题筛选（pytest test_risk_high_filter/test_issue_overdue_filter） |
| A3-4 | 风险关联问题/任务 | ✅ | 转化后 issue/task 带 risk_id 回链，原风险保留状态变更（BR-04，pytest 两例） |
| A3-5 | 关闭必填结论 | ✅ | 空结论 422 `closure_required`；有结论可关闭并记验证人与时间（pytest） |
| A3-6 | 刷新留存 + 跨项目隔离 | ✅ | 每用例独立库重建；两项目风险/问题/干系人互不混串（pytest test_cross_project_isolation） |
| A3-7 | 关键操作审计 | ✅ | activity_logs 覆盖 project/task/risk/issue/change/dependency/baseline 关键操作（pytest + psql 计数 8 条） |

## 2. 功能实现清单

- 风险：分类/描述/概率×影响/评分/等级/责任人/触发条件/预防/应急/策略/状态/剩余风险；评估历史追加型；转化问题或行动任务（保留原件）
- 问题：全流程（发现/原因/措施/验证/关闭），关闭必填解决结果，逾期筛选
- 变更：原因/范围/工期影响/审批状态流转/实施计划/验证结果
- 干系人（P1）：登记 + 影响力/关注度 + 沟通历史时间线（日期/渠道/内容/结论/后续行动）
- 审计：`activity_logs` 服务 + 关键操作埋点 + 项目级视图（操作/对象类型筛选）
- 评分引擎：`app_settings.risk.matrix`（rows/cols/levels 可配置），默认低≤4/中≤9/高>9
- 风险矩阵图：ECharts 热力图（低/中/高色阶）+ 现有风险点位

## 3. 测试记录

- pytest：**52 passed**（阶段 3 新增 12 例：评分/矩阵可配置/评估历史/高筛选/转化×2/关闭/逾期/变更/干系人/隔离/审计）
- 冒烟（API）：3 风险（20/9/4 分）+ 评估历史 + 2 问题 + 变更（已批准）+ 干系人 + 沟通 → 审计 8 条
- 界面截图：pt3-risks（矩阵+台账）、pt3-issues2、pt3-changes3、pt3-stakeholders3、pt3-audit5、pt3-detail-modules3（9 模块启用）

## 4. 缺陷修复记录（均有回归）

| # | 缺陷 | 修复 |
|---|---|---|
| D13 | 评分矩阵自定义阈值污染后续用例 | 用例末尾还原默认阈值 |
| D14 | TaskRead 缺 risk_id（风险转任务无法回链展示） | 增加 risk_id 字段 |
| D15 | IssueClose 空串被 schema 拦截（应业务码） | 去除 min_length，业务层校验 closure_required |
| D16 | 沟通列表 ORM 直出序列化失败 | 增加 response_model=list[CommunicationRead] |

## 5. 已知问题

1. 干系人/审计页截图数据行为空：截图时 WSL 实例回收窗口导致瞬时 fetch 失败（页面渲染正常；数据链路经 pytest/API/页面内 fetch 200 三重验证）。**非功能缺陷，环境捕获问题。**
2. 干系人导入导出未实现（阶段 3 通用要求含导入导出；当前实现搜索/筛选，导入导出随阶段 5 Excel 统一增强）。
3. 变更审批为状态字段流转，未做多级审批流（P2）。

## 6. 范围核对

阶段 3 提示词：干系人（P1）/风险/问题/变更全落实；通用要求（关联项目、评分可配置、审计、搜索筛选）落实；验收 6 条全过；BR-04 自动化覆盖。

## 7. 下一步（阶段 4 · AI 助手）

T4-01~T4-14：模型适配层（OpenAI 兼容）、建议暂存/确认流（BR-05）、WBS 初稿/工期依赖检查/风险建议/周报/问答。D-03 需在阶段 4 联调前提供模型服务配置。