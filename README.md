# Project Toolkit

个人项目经理的 AI 项目交付工作台（自托管 · Docker Compose · 中文 PC Web）。

> 状态：阶段 1 开发中（基础框架与项目管理）。规划、需求与验收标准见 [planning/](planning/README.md)。

## 目录结构

- `backend/` — FastAPI 后端（SQLAlchemy + Alembic + PostgreSQL）
- `frontend/` — 前端（阶段 1 骨架为 Nginx 静态占位页；T1-07 起为 React + Ant Design）
- `docker/` — 镜像构建文件与容器入口脚本
- `planning/` — 阶段 0 规划文档包（需求、架构、数据模型、任务拆解、验收标准、复盘记录）
- `data/` — 运行时持久化目录（attachments / exports / backups；内容不入库）

## 快速启动（WSL2 Ubuntu 26.04，Docker 已安装）

```bash
cp .env.example .env        # 并修改 POSTGRES_PASSWORD
docker compose up -d --build
```

- 前端：http://localhost:8080
- 健康检查：http://localhost:8080/api/health
- 数据库使用 Docker named volume `postgres-data`；附件与导出落 `./data`。

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
