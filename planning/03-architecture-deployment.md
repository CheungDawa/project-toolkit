# 03 · 技术架构与部署方案

> 交付物对应：阶段 0 要求的「3. 推荐技术架构及替代方案」「7. Docker 部署架构」
> 依据：方案·二「推荐技术架构」；用户确认的部署环境（本地 Windows · WSL2 Ubuntu 26.04 · x86_64 · Docker Compose）。

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│  浏览器（PC · 中文界面）                                       │
│  React + TypeScript + Vite SPA                                │
│  项目工作台 | WBS | 甘特图 | 风险台账 | 问题台账 | AI 工作台        │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP/JSON（同源，Nginx 反代 /api）
┌──────────────────────────▼──────────────────────────────────┐
│  frontend 容器（Nginx）                                        │
│  静态资源 + SPA 路由回退 + /api → backend 反向代理              │
└──────────────────────────┬──────────────────────────────────┘
┌──────────────────────────▼──────────────────────────────────┐
│  backend 容器（FastAPI · Python）                              │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────────────┐  │
│  │ API 层    │ │ 业务服务  │ │ AI 编排层   │ │ 文档生成层      │  │
│  │ 路由/校验  │ │ 计划/进度 │ │ 适配器+校验  │ │ openpyxl/docx │  │
│  │ Pydantic  │ │ 风险/问题 │ │ /暂存/确认  │ │ 模板+字段映射   │  │
│  └──────────┘ └──────────┘ └───────────┘ └───────────────┘  │
│  SQLAlchemy（ORM）+ Alembic（迁移） + 活动日志（审计）           │
└──────┬────────────────────────────────┬─────────────────────┘
       │                                │
┌──────▼──────────┐          ┌──────────▼─────────────────────┐
│  db 容器         │          │  AI 模型服务（外部，OpenAI 兼容）   │
│  PostgreSQL      │          │  供应商/地址/模型/密钥/超时全可配置   │
│  （Docker Volume）│          │  密钥仅存服务端（app_settings）     │
└─────────────────┘          └────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  持久化目录（宿主机 bind mount）: ./data                        │
│  ./data/attachments  ./data/exports  ./data/backups          │
└─────────────────────────────────────────────────────────────┘
可选服务：backup 容器（定时 pg_dump + 附件归档，方案·二）
```

**架构原则**（方案·二原文）："第一版采用前后端分离、模块化单体架构。不要急着拆微服务：个人使用场景下，维护成本比架构的复杂程度更值得优先考虑。"

## 2. 技术选型与替代方案

| 层级 | 推荐（=方案原文） | 核心理由 | 被否/待定的替代方案 |
|---|---|---|---|
| 前端 | React + TypeScript + Vite | 组件生态成熟，适合 Agent 开发（方案·二） | — |
| UI 库 | **Ant Design（建议，待 D-01）** | 表格/表单/弹窗/树形组件开箱即用，与本项目"后台管理"形态完全匹配；实测 npm 6.6.5（2026-09 发布）支持 React 18+；中文文档质量高 | shadcn/ui：设计更现代、可定制性强，但表格树形等复杂组件需自行拼装（TanStack Table + 自实现），在 WBS 多级树表格、大数据量表单场景起步成本更高；且引入 Tailwind 技术栈（本项目无其它定制视觉诉求） |
| 甘特图 | **frappe-gantt 1.2.2 + 自研 React 薄封装** | MIT；实测持续维护；视图/拖拽/节假日/只读配置完备（见 02 文档 1.3） | dhtmlxGantt（GPL/商业双许可，社区版 GPL 会传染，排除）；gantt-task-library（MIT React 原生，但社区规模与活跃度弱于 frappe-gantt，作为封装失败时的备选，不预先承诺） |
| 普通图表 | **ECharts（建议，待 D-02）** | 实测持续维护（6.1.0 / 2026-05）；中文显示与文档完善；燃尽图所需折线/对比/tooltip 交互充分 | Frappe Charts（方案候选之一，但 npm 停更近 5 年，实测证据见 02 文档 1.2；若用户坚持，以 1.6.2 冻结版本使用，接受不再更新的风险） |
| 后端 | Python FastAPI + Pydantic | 方便处理 AI、Excel、Word 文档（方案·二）；自动 OpenAPI 文档便于前后端协作 | Django/Flask：Django 过重（无需 admin/模板体系）；Flask 需自行拼装校验与文档生态 |
| ORM/迁移 | SQLAlchemy + Alembic | 数据访问与版本化迁移（方案·二）；满足"迁移能从空库执行"验收 | — |
| 数据库 | PostgreSQL（固定大版本标签） | 任务关联、历史快照、事务（方案·二）；`ltree`/`materialized path` 等方案支持任务树 | SQLite（单文件免容器，但方案已定 PostgreSQL，且快照与分析类查询受益于 PG 优化器，不替换） |
| AI 接入 | 服务端模型适配器（OpenAI 兼容协议） | 降低单一供应商依赖；保留本地模型接入能力（方案·一/二） | 直连某家 SDK：违反"可配置"要求，排除 |
| 文档处理 | openpyxl、python-docx | Excel 导入导出、Word 模板生成（方案·二） | — |
| 部署 | Docker Compose | 一套配置启动和升级服务（方案·二） | Kubernetes：方案明确排除 |

**选型理由说明（方案·阶段0提示词要求"不要机械照搬"）**：以上选型全部源自方案原文，本次规划的实际工作是**核验其前提**：① frappe 的两个库经实测确认了维护状态差异（甘特可用、图表需换备选）；② UI 二选一被细化为带依据的建议；③ 其余选型（FastAPI/PG/Compose）与单用户自托管场景匹配，无修订必要。

## 3. 后端分层设计

```
backend/
├── app/
│   ├── api/            # 路由层：按资源分文件（projects.py, tasks.py, ...）
│   │   └── deps.py     # 依赖注入：db session、分页、当前时间等
│   ├── schemas/        # Pydantic 请求/响应模型（与 ORM 分离）
│   ├── models/         # SQLAlchemy ORM（04 文档 19 张表）
│   ├── services/       # 业务服务层：wbs_code.py, gantt_validate.py,
│   │                   #   progress.py, risk_score.py, snapshot.py,
│   │                   #   ai/（provider.py 编排器 + validators.py）
│   │                   #   export/（excel.py, word.py）
│   ├── core/           # config.py（环境变量）、logging.py、errors.py（统一异常）
│   └── main.py
├── alembic/            # 迁移版本链
└── tests/              # pytest：单元 + API 集成（测试库自动建/清）
```

关键分层约束：
- API 层不含业务逻辑；业务规则（BR-01~05）全部落在 services 层并有对应单元测试。
- AI 编排层只产出**待确认建议**（写 `ai_action_proposals`），任何写入业务表的动作走统一的确认端点（BR-05，见 06 文档）。
- `activity_logs` 由 services 层统一记录关键操作（阶段 3 通用要求："关键操作写入审计记录"）。

## 4. Docker 部署架构（WSL2 Ubuntu 26.04 适配）

### 4.1 服务编排（方案·二四服务）

| 服务 | 镜像策略 | 说明 |
|---|---|---|
| `frontend` | 多阶段构建：`node:<固定版本>` 构建 → `nginx:<固定版本>` 运行 | 托管 SPA 静态资源；`/api` 反代 `backend`；gzip |
| `backend` | 多阶段构建：`python:<固定版本>-slim` | 非 root 用户运行；healthcheck（`/api/health`）；启动前自动 `alembic upgrade head` |
| `db` | `postgres:<固定大版本>` | 密码经 `.env`；数据存 named volume |
| `backup`（可选） | `postgres:<同版本>` 或轻量调度镜像 | 定时 `pg_dump` + 附件目录 tar 至 `./data/backups`；保留 N 份 |

版本固定策略（方案·二："镜像应固定合理的版本标签，不要长期依赖 `latest`"）：基础镜像锁定到具体版本标签（实施时在 `docker-compose.yml` 与 `.env.example` 中固化并登记）；依赖升级单独走升级流程（备份→改标签→迁移→验证）。

### 4.2 持久化设计（NFR-07）

```
./data                     # 宿主机 bind mount（位于 WSL2 文件系统内）
├── attachments/           # attachments 表引用的物理文件（deliverables 等模块上传）
├── exports/               # Excel/Word 导出产物
└── backups/               # pg_dump + 附件归档输出
postgres-data              # Docker named volume（数据库）
```

### 4.3 WSL2 环境专项说明

| 事项 | 设计 |
|---|---|
| 架构兼容 | x86_64：方案中"若部署 ARM64 VPS 须验证架构兼容"的前提不再适用；仍保留版本固定与多阶段构建规范 |
| Docker 运行方式 | WSL2 内安装 Docker Engine（Ubuntu 26.04 支持 systemd）；与 Docker Desktop 二选一，部署文档两种方式都写明差异（镜像存储位置、资源占用、`localhost` 转发），由用户按现状选择，不阻塞开发 |
| 文件性能 | `./data` 与代码均置于 WSL 文件系统（ext4），不跨 `/mnt/c` 挂载数据目录（9P 协议 IO 性能差且锁行为不同） |
| Windows 访问 | WSL2 默认 localhost 转发，浏览器直接访问 `http://localhost:<port>`；无需公网暴露（如未来远程访问，方案·阶段6条9 要求的 HTTPS/反代/访问控制另行立项，本期含文档说明但不含实施） |
| 备份走出 WSL | backup 任务支持把备份副本同步到 Windows 侧目录（`/mnt/d/...`）或远程对象存储；备份有效性以"在干净环境恢复成功"为验收（NFR-12） |
| 时区 | 容器统一 `TZ=Asia/Shanghai`；数据库时间戳存 UTC、前端本地化展示（时区边界处理见任务 T2-14） |

### 4.4 安全基线（方案·阶段 6 + NFR-05/08）

- 密钥与密码只进 `.env`（git 忽略）或运行时环境变量；`.env.example` 提供占位符。
- AI 密钥仅存服务端 `app_settings`（加密或受控访问），API 响应永不回显完整密钥。
- 后端容器以非 root 运行；Compose 网络隔离：仅 `frontend` 暴露端口，`db` 不映射宿主机端口。
- 生产构建不含开发依赖与热更新服务器（NFR-09）。

## 5. 前端架构

```
frontend/
├── src/
│   ├── api/            # 类型化的 API 客户端（按资源拆分）
│   ├── pages/          # 页面（05 文档页面清单）
│   ├── components/     # 通用组件：DataTable、StatusTag、DateRangeForm...
│   ├── gantt/          # frappe-gantt 自研封装：GanttView.tsx + useGantt.ts
│   ├── charts/         # 图表封装（ECharts/Frappe Charts，按 D-02 结果）
│   ├── stores/         # 组件状态（服务端状态优先走数据请求，不做浏览器代替存储 NFR-02）
│   └── router/         # 路由与布局
└── vite.config.ts      # 构建代理 /api → backend
```

前端测试策略：组件级用 Vitest + Testing Library 覆盖关键交互（表单校验、确认流）；构建验证（`tsc` + `vite build`）纳入每阶段验收；E2E 抽样见 08 文档。

## 6. 关键架构决策记录（ADR 摘要）

| ADR | 决策 | 依据 | 状态 |
|---|---|---|---|
| ADR-1 | 模块化单体，不拆微服务 | 方案·二原文；单用户自托管下维护成本优先 | 已确认（规格） |
| ADR-2 | 甘特集成 = frappe-gantt + 自研 React 封装 | 实测 react-frappe-gantt 停更；MIT 允许自研封装（02 文档） | 建议待确认（实施细节，归开发决定，T2-09 Spike 先行验证） |
| ADR-3 | 图表库倾向 ECharts | frappe-charts npm 停更 5 年（实测）；方案验证标准之"维护状态" | 待用户确认（D-02） |
| ADR-4 | 数据库不引入 Redis/MQ/向量库/K8s | 方案·二原文明确排除 | 已确认（规格） |
| ADR-5 | AI 与业务表之间以"建议暂存表"隔离 | 方案·四业务规则5；BR-05 | 已确认（规格），设计见 06 |
