# 02 · 开源复用调研报告

> 交付物对应：支撑阶段 0 的架构与选型决策（方案·三「开源复用方案」+ 阶段 0 提示词调研要求）
> **调研方式**：GitHub API（`api.github.com/repos/...`）与 npm registry（`registry.npmjs.org/...`）实调，全部数据为 **2026-10-10 实测**，未虚构任何调研结果。每项数据给出可复核的来源。

---

## 1. 核验结果总表

### 1.1 GitHub 仓库（实测日期 2026-10-10）

| 仓库 | 许可证（API 实测） | Stars | 最近推送 | 主语言 | 维护状态 | 复用分类 |
|---|---|---|---|---|---|---|
| [frappe/gantt](https://github.com/frappe/gantt) | **MIT** | 6,141 | 2026-06-18 | JavaScript | 维护中（中低频更新，77 个 open issues） | **直接复用**（npm 依赖） |
| [frappe/charts](https://github.com/frappe/charts) | **MIT** | 15,085 | 2026-10-09（仓库有零星活动） | JavaScript | 仓库活跃但 **npm 发布停更**（见 1.3） | 候选直接复用（版本冻结风险） |
| [opf/openproject](https://github.com/opf/openproject) | **GPL-3.0** | 16,369 | 2026-10-10（当天有推送） | Ruby（Rails + Angular） | 活跃维护 | **仅借鉴设计** |
| [makeplane/plane](https://github.com/makeplane/plane) | **AGPL-3.0** | 60,622 | 2026-10-09 | TypeScript（React 前端 + Django 后端） | 活跃维护 | **仅借鉴设计** |
| [taigaio/taiga](https://github.com/taigaio/taiga) | MPL-2.0* | 573 | **2023-12-13** | Python | **该仓库停更近 3 年** | 仅借鉴设计（价值有限，见 2.4） |

\* `taigaio/taiga` 经 API 解析实际重定向至 `kaleidos-ventures/taiga`（MPL-2.0，创建于 2022-12，更接近说明性/聚合仓库）。Taiga 的真实代码库分列两仓，实测状态：

| 仓库 | 许可证 | Stars | 最近推送 | 说明 |
|---|---|---|---|---|
| taigaio/taiga-back | **MPL-2.0** | 858 | 2026-09-28 | Django 后端，仍活跃 |
| taigaio/taiga-front | **AGPL-3.0** | 382 | 2026-10-07 | 前端为 CoffeeScript/AngularJS，活跃但技术栈老旧 |

**方案中"Plane Community Edition 使用 AGPL-3.0；OpenProject 使用 GPL-3.0；Frappe Gantt/Charts 标注 MIT"的陈述与本次实测一致**；方案未标注 Taiga 许可证，实测为 MPL-2.0（后端）+ AGPL-3.0（前端）的混合结构。

### 1.2 npm 包（实测日期 2026-10-10）

| 包名 | 最新版 | 发布时间（registry 时间戳推算） | 关键事实 | 对本项目的影响 |
|---|---|---|---|---|
| `frappe-gantt` | 1.2.2 | 2026-02（可信发布者 GitHub Actions，ESM/UMD/CSS 三导出，Vite 构建） | 本体持续发布 | **可用**；React 封装需自研 |
| `react-frappe-gantt` | 0.2.3 | **2021-02，停更近 5 年** | 锁定 `frappe-gantt@0.5.0`、`react@^16`、`moment` | **不可用**（与 React 18+/frappe-gantt 1.2.2 不兼容） |
| `frappe-charts` | 1.6.2 | **2021-06，停更近 5 年** | 构建链陈旧（devDeps 含 node-sass 等） | 可用但版本冻结；见风险 R-01 |
| `antd` | 6.6.5 | 2026-09 | MIT；peerDeps `react >= 18` | UI 库决策 D-01 的候选 A |
| `echarts` | 6.1.0 | 2026-05 | Apache-2.0；持续维护 | 图表库决策 D-02 的候选 B |

### 1.3 Frappe Gantt 功能核验（README 实读）

以下能力直接来自 `frappe/gantt` master 分支 README（2026-10-10 抓取），覆盖规格对甘特图的要求：

| 规格要求（阶段 2 提示词） | frappe-gantt 实测支持 | 证据 |
|---|---|---|
| 日、周、月视图 | `view_mode`: Day / Week / Month / **Year**，且支持自定义 `view_modes` | README 配置表 |
| 任务、工期、进度、依赖连线 | 任务对象含 start/end/progress，依赖箭头可配置（`arrow_curve`） | README 用法示例与配置表 |
| 拖拽调整日期 | 支持（`snap_at` 拖拽/缩放捕捉间隔、`readonly_dates` 可禁用） | README 配置表 |
| 只读降级 | `readonly` / `readonly_dates` / `readonly_progress` 三档 | README 配置表 |
| 周末/节假日处理 | `holidays`（高亮）、`ignore`（从进度计算中忽略）、`is_weekend`（自定义函数）| README 配置表——与 TD-01 工作日历要求直接呼应 |
| 依赖联动 | `move_dependencies`：移动任务自动移动其依赖任务 | README 配置表 |
| 多语言 | `language` 选项（ISO 639-1）；**zh 语言包的完整性需在 T2-09 Spike 中实测** | README（标注实测项） |
| 回到今天 | `today_button`、`scroll_to` | README 配置表 |
| 局部更新 | API：`update_task` / `change_view_mode` / `update_options` / `scroll_current` | README API 表 |

**注意**：README 未完整列举事件回调 API（如日期变更回调），拖拽持久化所需的事件接口在 T2-09 Spike 任务中实测确认（见 07 文档），不在规划期臆断。

## 2. 复用策略（三分类，方案·三要求）

### 2.1 直接复用（以依赖方式嵌入，业务数据仍存自有后端）

| 组件 | 用途 | 方式 | 理由 |
|---|---|---|---|
| frappe-gantt 1.2.2 | 甘特图渲染 | npm 依赖 + **自研 React 薄封装**（`useGantt` hook：挂载、卸载、数据同步、事件桥接） | MIT 允许任意集成；社区 react-frappe-gantt 已停更（实测 1.2/1.3 节），自研封装约 1-1.5h，可控性更高 |
| echarts 6.1.0（**待 D-02 确认**） | 燃尽图、进度趋势、任务状态统计 | npm 依赖（按需引入模块减小体积） | Apache-2.0；持续维护；中文文档完善；交互与数据缩放能力覆盖燃尽图需求 |
| antd / shadcn/ui（**待 D-01 确认**） | 后台 UI 组件 | npm 依赖 / 组件复制 | 见 03 文档对比分析 |

**直接复用的共同义务**：保留版权与许可证声明（MIT/Apache-2.0 要求随分发保留）；npm 依赖方式本身不触发开源本项目代码的义务。**不把图表组件当业务层**（方案·三原文："业务数据仍然保存在自己的后端，不能把图表组件当成业务层"）。

### 2.2 借鉴设计（只学交互与业务模型，不引入任何代码）

| 项目 | 借鉴什么 | 明确不做什么 |
|---|---|---|
| OpenProject（GPL-3.0） | 工作包（Work Package）模型、类型/状态/优先级体系、甘特与 WBS 的关系设计、基线与版本快照概念、项目生命周期与风险跟踪的字段设计 | 不复制其任何 Ruby/Angular 代码、样式与文案；不嵌入其界面截图作为素材 |
| Plane（AGPL-3.0） | 现代工作台的信息架构（左侧导航-项目-视图切换）、任务列表与筛选/分组交互、快捷操作 | 同上，不复制代码；AGPL 场景下即使修改其代码自托管也要开源，本项目不触碰其代码即可完全规避 |
| Taiga（MPL-2.0 后端 / AGPL-3.0 前端） | Epic-Story-Task 层级思想、看板视图交互 | 参考价值评估：其前端 CoffeeScript/AngularJS 老栈对本项目（React+TS）几乎无直接参考意义；后端 Django 亦与本项目 FastAPI 栈不同。**建议将其在借鉴清单中降为最低优先级**，仅当需要敏捷看板功能（P2）时再回头看 |

> 设计借鉴的版权边界：交互流程与业务概念（如"概率×影响=风险等级"）不受版权保护；受保护的是具体代码、文案、美术资源。本项目借鉴前者、零复制后者，GPL/AGPL 的传染性义务因此不触发。此边界判断在阶段 6 的许可证清单任务（T6-06）中复核。

### 2.3 自行开发（规格要求的差异化能力，开源界无直接可复用件）

- 统一业务数据层（19 张表的最小实现，见 04 文档）——OpenProject/Plane 的数据模型因许可证和技术栈不能搬，只有结构思想可参考。
- AI 编排层：项目上下文组装 → 数据最小化 → 结构化解析 → 业务校验 → 待确认建议 → 人工确认写入（见 06 文档）。
- 计划基线/进度快照体系（BR-02/BR-03 的强一致性要求）。
- 文档生成（openpyxl / python-docx 模板与字段映射）。
- WBS 编码生成与重算、循环依赖校验、工作日历工期计算。

## 3. 许可证义务清单（随 T6-06 任务固化为正式文档）

| 许可证 | 组件 | 义务 | 本项目的落实方式 |
|---|---|---|---|
| MIT | frappe-gantt、antd | 保留版权与许可声明 | npm 依赖 + 在 `NOTICE` / 许可证清单中登记组件、版本、许可证 |
| Apache-2.0 | echarts | 保留 NOTICE；标注修改（如有） | 同上；不做源码修改 |
| GPL-3.0 | OpenProject | 衍生作品须 GPL 并开源 | **不引入代码** → 无衍生关系 → 无义务 |
| AGPL-3.0 | Plane、taiga-front | 网络服务也触发开源义务 | **不引入代码** → 无义务 |
| MPL-2.0 | taiga-back、kaleidos-ventures/taiga | 以源文件为单位的弱传染 | **不引入代码** → 无义务 |

**行动项（源自方案·三："许可证核验必须纳入开发任务"）**：T6-06 任务将生成「直接依赖、间接依赖、版本、许可证、修改情况」的完整清单，并纳入最终交付；开发过程中新增任何第三方依赖时，在 07 文档的任务执行记录中同步登记。

## 4. 对规格原文的两处修正建议（评审时确认）

1. **方案·二技术选型表中 "甘特图 Frappe Gantt（轻量、可集成、MIT 许可证）" 成立**，但集成方式需明确为"frappe-gantt + 自研 React 封装"，因为官方无 React 版、社区封装停更（实测证据见 1.2/1.3 节）。此为开发实施细节，不改变规格的选型结论。
2. **方案·二 "Frappe Charts 或 ECharts 二选一" 的前提已变**：Frappe Charts npm 包停更近 5 年（1.6.2，2021-06），且其构建链依赖陈旧。方案自己设定的验证标准（"React 兼容性、维护状态、中文显示和交互能力"）在"维护状态"一项上 ECharts 明显占优。**建议选 ECharts**，但按规则此为待确认项（D-02），未确认为承诺范围。
