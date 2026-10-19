# Project Toolkit

个人项目经理的 AI 项目交付工作台（自托管 · Docker Compose · 中文 PC Web）。

> 状态：v1.0 已交付（阶段 1-6 全部完成，P0+P1 功能闭环）。规划与验收记录见 [planning/](planning/README.md) 与 [docs/final-acceptance.md](docs/final-acceptance.md)。
>
> **⚠️ 安全警示：本系统无任何用户鉴权（按个人本机使用设计）。Web 端口只绑定 `127.0.0.1`，仅本机可访问；切勿将 8180 暴露到局域网或公网。如需远程访问，请使用 SSH 隧道（见部署文档第六节）。**

## 功能模块

- **项目列表**：创建/搜索/筛选/归档/软删除（审计留痕）
- **WBS 任务分解**：多级树 + 编码自动重算 + 依赖与循环校验 + 工时加权进度汇总 + 工作日历工期 + Excel 导入导出
- **甘特图**：日/周/月三视图，拖拽改期与改进度（经后端校验持久化），与 WBS 同源双向同步
- **看板**：任务按状态分列，拖拽流转、筛选与任务详情面板
- **里程碑**：计划/实际日期与状态跟踪
- **计划基线**：快照保存、与当前计划逐任务对比（基线不受后续修改影响）
- **风险**：概率×影响自动评分定级（阈值可配）、矩阵热力图、评估历史、风险转问题/任务
- **问题**：关闭必填解决结果、"仅逾期"筛选；与风险/任务关联可追溯
- **变更**：原因/范围/工期影响与审批状态流转
- **干系人**：影响力/关注度登记 + 沟通历史记录
- **交付资料**：模板实例化、台账、附件上传（≤50MB）、Excel 导入导出、AI 缺失检查（需配置模型）
- **燃尽图**：基于真实历史快照（任务数/剩余工时双口径 + 理想线），支持手动补录
- **报告中心**：周报 Word / 收尾报告 Word（由库内真实数据生成）
- **审计日志**：全量关键操作留痕，按操作/对象类型筛选
- **AI 工作台**（需自行配置 OpenAI 兼容模型服务）：WBS 初稿、工期/依赖检查、风险建议、周报初稿、项目问答；AI 产物一律进"建议中心"经用户确认后才落库

## 目录结构

- `backend/` — FastAPI 后端（SQLAlchemy + Alembic + PostgreSQL，迁移链 0001~0009）
- `frontend/` — React + Ant Design + ECharts 前端（`eslint` / `prettier` / `typecheck` 已配齐）
- `docker/` — 镜像构建文件（backend 以非 root 运行；db 端口不映射宿主机）
- `docs/` — 部署、用户手册、备份恢复升级、验收报告、许可证清单
- `planning/` — 阶段 0 规划文档包
- `data/` — 运行时持久化目录（attachments / exports / backups；内容不入库）
- `scripts/` — 备份、恢复演练、冒烟脚本

## 快速启动（WSL2 Ubuntu + Docker Compose）

```bash
cp .env.example .env        # 并修改 POSTGRES_PASSWORD
docker compose up -d --build
```

- 访问地址（本机）：**http://localhost:8180**（端口可在 `.env` 的 `PT_HTTP_PORT` 修改，仅绑定 127.0.0.1）
- 健康检查：http://localhost:8180/api/health（期望 `{"status":"ok","db":"ok"}`）
- 数据库使用 Docker named volume `postgres-data`；附件与导出落 `./data`
- 详细安装步骤见 [docs/deployment.md](docs/deployment.md)

## 备份与恢复

```bash
bash scripts/backup.sh                                   # 手动备份 → data/backups/pt_*.dump
docker compose --profile backup up -d backup             # 或启用每日自动备份
bash scripts/restore-check.sh                            # 恢复演练（恢复到临时库校验，不覆盖生产库）
```

完整流程（含跨机恢复与升级）见 [docs/backup-restore-upgrade.md](docs/backup-restore-upgrade.md)。

## 运行测试（后端 pytest，独立测试库 pt_test）

```bash
docker compose exec -T \
  -e DATABASE_URL=postgresql+psycopg://pt:<口令>@db:5432/pt_test \
  backend pytest
```

## 冒烟脚本（创建演示项目并验证基础 API）

```bash
docker compose exec -T backend python scripts/smoke.py           # 创建 + 查询
docker compose exec -T backend python scripts/smoke.py --status # 仅查询
```
