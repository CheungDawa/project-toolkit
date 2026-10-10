# Project Toolkit 备份、恢复与升级文档

> 版本：1.0（阶段 6 交付）

## 一、备份（建议每日，或重要操作前手动）

### 1. 手动备份

```bash
cd ~/project-toolkit
bash scripts/backup.sh
# 输出：data/backups/pt_YYYYmmdd_HHMMSS.dump.gz（数据库）
#       data/backups/files_YYYYmmdd_HHMMSS.tar.gz（附件，若非空）
```

### 2. 每日自动备份（可选启用）

```bash
docker compose --profile backup up -d backup
# 每日执行 pg_dump 并保留最近 14 份
```

### 3. 备份走出 WSL（强烈建议）

WSL 虚拟磁盘损坏或发行版误删会连同卷数据一起丢失。定期把备份复制到 WSL 之外：

```bash
# 复制到 Windows D 盘（示例，路径按需修改）
mkdir -p /mnt/d/pt-backups
cp data/backups/pt_*.dump.gz /mnt/d/pt-backups/
# 或 rclone/scp 同步到远程服务器
```

## 二、恢复演练（约 3 分钟，可随时重复）

```bash
cd ~/project-toolkit
bash scripts/restore-check.sh
# 流程：取最新备份 → 恢复到临时库 projecttoolkit_restore_test → 校验项目数 → 清理临时库
```

> 注意：`restore-check.sh` 不会覆盖生产库；它验证的是备份文件可用性。

### 完整恢复（换新库/灾难恢复时使用）

```bash
cd ~/project-toolkit

# 1. 停止应用
docker compose down          # 保留数据卷

# 2. 删除旧数据卷（确认备份已存在！）
docker volume rm project-toolkit_postgres-data

# 3. 用空卷启动 db
docker compose up -d db
docker compose exec -T db psql -U pt -d postgres -c "ALTER USER pt PASSWORD '临时口令'"
#   （口令需与 .env 的 POSTGRES_PASSWORD 一致；若沿用原口令可跳过此步，因为
#    pg_restore 恢复的是业务库内容，实例口令由 POSTGRES_PASSWORD 初始化）
docker compose exec -T db createdb -U pt projecttoolkit

# 4. 恢复备份
zcat data/backups/<你的备份文件>.dump.gz | docker compose exec -T db pg_restore -U pt -d projecttoolkit --no-owner --role=pt

# 5. 启动全部服务（backend 会自动跑迁移补版本）
docker compose up -d
curl http://localhost:8080/api/health
```

## 三、升级流程（代码更新）

```bash
cd ~/project-toolkit

# 0. 升级前备份（铁律）
bash scripts/backup.sh

# 1. 拉取新代码
git pull <你的远程> main

# 2. 重新构建并启动（backend 入口自动执行 alembic upgrade head）
docker compose up -d --build

# 3. 验证
docker compose ps                       # healthy
docker compose exec backend alembic current   # 确认迁移版本前进了
curl http://localhost:8080/api/health
```

回退方案：如升级失败，`git checkout <旧版本>` 后重复步骤 2；数据库迁移为前进式设计，不降级迁移，如需回退数据用第 2 节完整恢复流程恢复升级前备份。

## 四、关键约定（与实现一致，勿跳步）

1. 迁移只前进：`alembic` 链 `0001→0008`，backend 每次启动自动 `upgrade head`。
2. `.env` 不入库，升级后对比 `.env.example` 新增项。
3. 备份文件命名含时间戳；14 份之外的自动清理（backup 服务）。
4. 附件随备份脚本一并归档；如启用每日自动备份，附件仅随手动脚本归档。