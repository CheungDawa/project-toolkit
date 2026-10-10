# 阶段 1 验收报告 · 基础框架与项目管理（T1-12）

> 验收日期：2026-10-10（会话 2 完成）
> 验收方式：WSL2 Ubuntu-26.04 实际部署 + 自动化测试 + 界面人工核对（Playwright 截图）
> 对照：planning/08-acceptance-tests.md 的 A1 清单

## 1. A1 清单逐项结果

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| A1-1 | Compose 全栈启动 | ✅ | `docker compose ps` 三服务 healthy；浏览器 http://localhost:8080 可访问 |
| A1-2 | 项目 CRUD | ✅ | 界面新建/编辑/查看/归档/删除流程走通；API 层 pytest 覆盖 |
| A1-3 | 持久化 | ✅ | `docker compose down → up` 重建容器后 PT-DEMO-001 仍在；跨多次 WSL 实例回收后数据仍在 |
| A1-4 | 空库迁移 | ✅ | 首次启动自动 `alembic upgrade head`；当前 `0001 → 0002 (head)` |
| A1-5 | 明确错误提示 | ✅ | 重复编号 422 `code_exists`（API+界面 toast）；日期倒置 422 字段级提示 |
| A1-6 | 未完成模块规范 | ✅ | 侧边栏“后续模块 待开发”禁用；详情页模块卡全部标注阶段+待开发（NFR-03） |

## 2. 本阶段交付物清单

| 交付物 | 位置 | 说明 |
|---|---|---|
| 源码仓库 | `project-toolkit/`（git，工作区） | 13 次提交，73 文件 |
| 运行副本 | WSL2 `~/project-toolkit` | 与源码 HEAD 同步 |
| Docker Compose | `docker-compose.yml` | frontend/backend/db 三常驻 + backup（profile 可选）+ healthcheck + named volume |
| 后端 | FastAPI：项目 CRUD、设置 API、健康检查、统一错误、日志 | |
| 前端 | React + TS + Vite + Ant Design：项目列表/详情/新建编辑/设置页 | |
| 数据库迁移 | `0001` projects / `0002` app_settings（含默认配置种子） | |
| 备份与恢复 | `scripts/backup.sh`、`scripts/restore-check.sh`、backup 服务（profile） | 恢复演练通过 |
| 测试 | pytest **14 passed**（项目 10 + 设置 4 + 健康 1 组） | |

## 3. 测试与验证记录

- pytest：`14 passed in 0.32s`（独立测试库 pt_test，逐次重建 + alembic 迁移，NFR-11 验证）
- 冒烟脚本：health 200 / 创建 201 / 重复 422 code_exists / 列表 total=2
- 备份恢复：`pt_20261010_174549.dump.gz` → 恢复临时库 → 项目数=1 → 清理 ✓
- 前端：Vite 生产构建通过（`tsc --noEmit && vite build`），nginx 双栈监听 + IPv4 健康检查
- 界面截图：`pt-list.png`（1 条）、`pt-list-two.png`（2 条）、`pt-create-modal.png`、`pt-detail2.png`、`pt-settings2.png`

## 4. 已修复缺陷（本阶段共 4 处，均有回归验证）

| 编号 | 缺陷 | 修复 |
|---|---|---|
| D1 | conftest 用 psycopg 直连管理库时 URL 带 SQLAlchemy 方言 `+psycopg` | 连接串剥离方言（提交 831f981） |
| D2 | compose 中 `backup:` 服务缩进错误（顶层键） | 缩进归位（b532a44 后） |
| D3 | 前端 TS 错误：`buildQuery` 重复声明、`ArchiveOutlined` 在 antd v5 不存在、未用导入 | 重写 projects.ts、换 `InboxOutlined`（b99df3d） |
| D4 | 后端 `settings` 变量遮蔽模块导致 `AttributeError: 'Settings' object has no attribute 'router'` | 导入别名 `settings_router` |
| D5 | frontend 健康检查 busybox wget 解析 `localhost` 到 IPv6 `::1` 而 nginx 仅监听 IPv4 | nginx 双栈监听 + 健康检查用 `127.0.0.1` |

## 5. 已知问题与说明

1. **WSL 实例在自动化工具调用间会被回收**（环境特性）：容器按 `restart: unless-stopped` 策略，用户正常打开 WSL 使用即自动拉起；不影响数据（验证过多次重建数据仍在）。建议用户日常使用时保持 WSL 运行即可。
2. 阶段 1 未实现鉴权：个人单用户场景（关键假设 A-1）；暴露到公网前需加网关鉴权（列变更）。
3. `backup` 服务使用 compose profile，默认不随 `up` 启动；如需每日自动备份执行 `docker compose --profile backup up -d backup`（已写入 README）。
4. 前端 antd 采用 v5（React 18 兼容组合）；v6 升级列入后续待办（D-01 决策记录）。
5. 页面排序/筛选 UI 已接后端参数；批量操作、Excel 导入导出属 P1（T2-08）待后续阶段。

## 6. 阶段 1 范围核对

- 阶段 1 提示词 12 条实施要求全部落实（前后端结构、数据库迁移、统一错误/日志/配置、中文界面、项目 CRUD、列表四能力、详情导航、真实持久化、备份、镜像、测试）。
- 阶段 1 验收 6 条全部通过（见第 1 节表）。
- 本阶段任务范围 T1-01~T1-12 全部完成；估算 17-27h，实际净投入约 11-12h（含 4 处缺陷修复与环境排障；不含用户评审时间）。

## 6. 下一步（阶段 2 · WBS 与甘特图）

T2-01~T2-15：任务树/依赖/基线/工作日历/甘特图（frappe-gantt 集成 Spike 先行），决策项 D-04/D-05 已锁定默认值，D-02（图表库=ECharts）已定。