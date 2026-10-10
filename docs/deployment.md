# Project Toolkit 安装部署文档

> 版本：1.0（阶段 6 交付） ｜ 环境：Windows 11 + WSL2 Ubuntu 26.04（x86_64）+ Docker Compose
> 源码仓库根目录：`project-toolkit/`（git 管理，含全部代码与迁移）

## 一、环境要求

| 组件 | 要求 | 验证命令 |
|---|---|---|
| WSL2 Ubuntu | 26.04（x86_64） | `wsl -l -v` |
| Docker Engine | ≥ 24（含 compose v2 插件） | `docker compose version` |
| Git | ≥ 2.40（WSL 内） | `git --version` |
| 磁盘 | ≥ 3 GB（镜像 + 数据卷） | `df -h ~/` |
| 端口 | 宿主机 8080 可用（可在 .env 改 `PT_HTTP_PORT`） | `ss -tlnp | grep 8080` |

## 二、首次安装（约 5-10 分钟）

```bash
# 1. 获取源码（任选其一）
git clone <你的仓库地址> ~/project-toolkit
# 或在 WSL 内：git clone /mnt/c/.../TeleAgent的工作空间/project-toolkit ~/project-toolkit

cd ~/project-toolkit

# 2. 配置环境变量
cp .env.example .env
nano .env
#   必改：POSTGRES_PASSWORD=<随机强口令>
#   可选：PT_HTTP_PORT=8080

# 3. 启动（首次会拉取镜像并构建，约 3-8 分钟）
docker compose up -d --build

# 4. 等待健康检查全绿
docker compose ps        # 三服务 STATUS 应均为 (healthy)

# 5. 验证
curl http://localhost:8080/api/health   # 期望 {"status":"ok","db":"ok"}
```

浏览器访问 **http://localhost:8080** 即可使用。首次启动时数据库迁移（`alembic upgrade head`）自动执行，无需手工操作。

## 三、目录与权限

| 路径 | 说明 |
|---|---|
| `~/project-toolkit/.env` | 环境变量（**不入库**，含数据库口令与可选 AI 密钥） |
| `~/project-toolkit/data/attachments/` | 交付资料附件（bind mount） |
| `~/project-toolkit/data/exports/` | 导出产物 |
| `~/project-toolkit/data/backups/` | 数据库备份输出 |
| Docker named volume `project-toolkit_postgres-data` | PostgreSQL 数据 |

权限要点：容器内后端以非 root 用户（uid 1000）运行；`./data` 目录由部署用户（uid 1000）所有，与容器用户一致，附件可正常写入。数据库端口**不映射**到宿主机，仅经 compose 内网访问（`db:5432`），唯一的对外端口是前端 `${PT_HTTP_PORT}`。

## 四、启动 / 停止 / 重启

```bash
docker compose ps                     # 查看状态
docker compose up -d                  # 启动（服务未变更时直接拉起）
docker compose up -d --build          # 启动并重新构建（代码更新后使用）
docker compose restart backend        # 重启单个服务
docker compose down                   # 停止（数据卷保留）
```

## 五、日志与异常排查

```bash
docker compose logs -f backend        # 跟踪后端日志
docker compose logs --tail 100 db     # 数据库日志
docker compose exec backend alembic current   # 查看迁移版本
```

常见问题：

| 症状 | 排查 |
|---|---|
| `localhost:8080` 打不开 | `docker compose ps` 是否 healthy；端口冲突改 `PT_HTTP_PORT` 后 `up -d` |
| backend 反复重启 | `docker compose logs backend`；常见为 `.env` 缺 `POSTGRES_PASSWORD` |
| 附件上传 403/无法写 | `ls -ld data/attachments`（应为 uid 1000 可写） |

## 六、公网/远程访问（可选，默认不开启）

本工具按"个人本机使用"设计（方案关键假设 A-1：无鉴权）。如需远程访问，必须自行加一层带鉴权的反向代理（如 Nginx BasicAuth/Caddy）与 HTTPS 证书，**不要直接把 8080 暴露到公网**。远程备份建议同步到 WSL 之外的 Windows 目录或远程主机（见备份文档）。