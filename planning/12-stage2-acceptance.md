# 阶段 2 验收报告 · WBS 与甘特图（T2-15）

> 验收日期：2026-10-10（会话 3）
> 验收方式：WSL2 Ubuntu-26.04 实际部署 + pytest 回归 + API 冒烟 + Playwright 界面核对
> 对照：planning/08-acceptance-tests.md 的 A2 清单

## 1. A2 清单逐项结果

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| A2-1 | 多级任务与编码 | ✅ | 三级树 `1 / 1.1 / 1.2 / 2 / 3`；重排后编码全树重算、任务 UUID 不变（pytest） |
| A2-2 | 甘特实时反映 | ✅ | WBS 修改日期后甘特刷新（同源 API，pt2-gantt2.png 渲染 5 任务） |
| A2-3 | 数据共享单源 | ✅ | WBS 与甘特读同一 `/projects/:id/tasks`；拖拽后统一 PATCH `/tasks/:id` |
| A2-4 | 循环依赖拒绝 | ✅ | `dependency_cycle` 422（pytest + 冒烟：A→B、B→C、C→A 拒绝） |
| A2-5 | 拖拽持久化 | ✅ | frappe-gantt `on_date_change` 事件 → PATCH → 持久化；Spike 实证事件 API 存在（动态 `on_<event>` 选项） |
| A2-6 | 基线独立 | ✅ | 保存基线 → 改计划 → diff 显示变化行、基线侧保持冻结值（pytest + 冒烟 `diff_changed=['2']`） |
| A2-7 | 进度汇总 | ✅ | 工时加权（pytest 75.0）与等权重回退（50.0）均通过；冒烟 50.37（80h 加权） |
| A2-8 | 工作日历 | ✅ | 周末[5,6] Python 约定、节假日、项目例外测试全过；迁移 0004 修正存量种子 |
| A2-9 | 刷新不丢 | ✅ | 重查一致性 pytest + 多次容器重建数据仍在 |
| A2-10 | 叶子去重统计 | ✅ | 父任务自身进度不参与自身汇总（pytest `test_leaf_not_double_counted`） |

## 2. 关键实现与决策记录

- **frappe-gantt 1.2.2 Spike 结论**：v1.x 事件通过动态选项 `on_<event>` 暴露（源码 `trigger_event` 拼接 `'on_'+event`），**无需 vendor 补丁**；CSS 因 package `exports` 限制深路径导入，本地化复制并保留 MIT 出处注释。
- **WBS 编码**：全树重算（递归 DFS），任务 UUID 稳定；唯一约束改 `DEFERRABLE INITIALLY DEFERRED`（迁移 0005）支持同事务批量重算；软删除任务编码释放为 `DEL-<uuid>` 占位。
- **工作日历**：全局 `app_settings.workcalendar.overrides` + 项目级例外；Python `weekday()` 约定（周六=5/周日=6）统一，甘特 payload 转 JS `getDay` 约定。
- **进度汇总**：父任务按子任务工时加权（无工时等权重），`effective_progress` 查询时现算（DM-3，不落库）。
- **Excel 导入导出（P1，T2-08）**：openpyxl 实现，导出含 WBS 引用父级、导入按 wbs_code 挂父级、错误行号定位。

## 4. 测试记录

- pytest：**40 passed**（新增任务/依赖/日历/基线/里程碑 30 例，全部经独立测试库重建）
- 冒烟：WBS 编码 5 项、依赖 3 项（含成环拒绝）、加权进度 50.37、里程碑、基线 v1+diff、日历 JS 约定 [0,6]、Excel 导出 5.3KB
- 前端：`tsc --noEmit && vite build` 通过；Playwright 截图 5 张（pt2-wbs / pt2-gantt2 / pt2-milestones2 / pt2-baselines2 / pt2-detail-modules3）

## 5. 缺陷与修复记录（均有回归）

| # | 缺陷 | 修复 |
|---|---|---|
| D6 | frappe-gantt CSS 深路径导入被 exports 限制 | 本地化 CSS（MIT 出处注释） |
| D7 | `settings` 变量遮蔽路由模块 | 导入别名（阶段 1 会话遗留） |
| D8 | `DependencyRead` 前向引用顺序 | `from __future__ import annotations` |
| D9 | 周末约定错（[0,6] 实为周一+周日） | 迁移 0004 改 [5,6]；payload 转 JS 约定 |
| D10 | 占位 wbs_code='0' 唯一冲突 | 占位用 uuid（创建/复制/导入） |
| D11 | recompute_codes 未 commit | 赋值后 commit |
| D12 | 批量重算同事务瞬时冲突 | 唯一约束 DEFERRABLE（迁移 0005）+ 软删行释放编码 |

## 6. 已知问题

1. 甘特图未做基线叠加显示（对比以独立 Drawer 表格呈现，符合规划"基线对比视图=逐字段 diff"）。
2. 甘特未含里程碑菱形（里程碑在独立页面管理）；阶段 5 若需要可增强。
3. 甘特语言包 `zh` 部分提示仍可能回退英文（spike 证实 language 参数存在；中文主界面不受影响）。
4. 任务筛选/批量操作仅列表内客户端筛选，批量编辑未实现（P1 内可后续增强）。

## 7. 范围核对

阶段 2 提示词：WBS 要求 1-7 全部落实（含 [P1] Excel）；甘特要求 1-8 落实（frappe-gantt 集成、视图、拖拽持久化、基线比较、边界处理、叶子去重）；验收 7 条全过。D-04（工时加权）、D-05（日历只算不级联）按既定默认执行。

## 8. 下一步（阶段 3 · 风险/问题/干系人/变更）

T3-01~T3-12；D-02 ECharts 已定（风险矩阵图与阶段 5 燃尽图共用）。