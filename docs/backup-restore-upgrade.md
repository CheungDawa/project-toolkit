# Project Toolkit 备份、恢复与升级文档

> 版本：1.0（阶段 6 交付）

## 一、备份（建议每日，或重要操作前手动）

### 1. 手动备份

```bash
cd ~/project-toolkit
bash scripts/backup.sh
# 输出：data/backups/pt_YYYYmmdd_HHMMSS.dump（数据库，pg_dump -Fc 原生归档）
#       data/backups/attachments_YYYYmmdd_HHMMSS.tar.gz（附件，若非空）
```

> `-Fc` 本身就是压缩格式，**不要**再管道 gzip（会变成二次压缩，`pg_restore` 无法直接读取）。
> 脚本会先写 `.pt_*.dump.tmp`，校验大小 + `pg_restore -l` 能读出表数据后才原子改名为正式文件，
> 因此 `data/backups/` 里出现的 `pt_*.dump` 一定是可恢复的完整备份。

### 2. 每日自动备份（可选启用）

```bash
docker compose --profile backup up -d backup
# 容器内 scripts/backup-loop.sh 每日 pg_dump 一次，自动清理 14 天前的备份
```

**怎么确认"确实产出了备份"**（重要：容器 running 不等于备份成功）：

```bash
ls -la data/backups/                          # 应出现 pt_YYYYmmdd_HHMMSS.dump（-a 才能看到点开头的 .tmp）
docker compose logs backup | tail -20         # 应出现 "[backup] ... OK: /backups/pt_....dump (NNN bytes, M table data entries)"
ls data/backups/LAST_FAILURE.txt              # 不存在 = 最近一次备份成功
```

- 出现 `[backup] <时间> OK: /backups/pt_YYYYmmdd_HHMMSS.dump (NNN bytes, M table data entries)` 才算成功（附件归档成功时还会有 `OK: /backups/attachments_....tar.gz (NNN bytes, N entries)`）；
- 出现 `data/backups/LAST_FAILURE.txt`（内含失败时间与原因）= 最近一次备份失败，容器会在 1 小时后自动重试，请按文件里的 `reason` 排查（常见原因：db 未 healthy、`POSTGRES_PASSWORD` 与 `.env` 不符）；
- 只有 `.tmp` 而没有对应的 `pt_*.dump`，说明备份正在写入或校验未通过（超 2 天会被自动清理）。`.tmp` 是点开头的隐藏文件，用 `ls -la data/backups/` 才看得到。
- 手动脚本 `scripts/backup.sh` 与自动备份共用保留期：14 天前的 `pt_*.dump` / `attachments_*.tar.gz`、2 天前的残留 `.tmp` 会被自动清理（只在备份成功后执行，失败时旧备份原样保留）。

### 3. 备份走出 WSL（强烈建议）

WSL 虚拟磁盘损坏或发行版误删会连同卷数据一起丢失。定期把备份复制到 WSL 之外：

```bash
# 复制到 Windows D 盘（示例，路径按需修改）
mkdir -p /mnt/d/pt-backups
cp data/backups/pt_*.dump /mnt/d/pt-backups/
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

# 4. 恢复备份（-Fc 原生归档，直接重定向给 pg_restore，无需 zcat）
docker compose exec -T db pg_restore -U pt -d projecttoolkit --no-owner --role=pt < data/backups/<你的备份文件>.dump
#    若备份是历史格式 pt_*.dump.gz（旧版脚本产出，外层多套了一层 gzip），必须先解压再喂给 pg_restore：
#    zcat data/backups/<你的备份文件>.dump.gz | docker compose exec -T db pg_restore -U pt -d projecttoolkit --no-owner --role=pt
#    注意：历史 .dump.gz 不能用 `< file` 重定向，pg_restore 读不了 gzip 外壳。
#    （scripts/restore-check.sh 已自动识别两种格式，手工恢复时按文件后缀选对应写法）

# 5. 启动全部服务（backend 会自动跑迁移补版本）
docker compose up -d
curl http://localhost:8180/api/health
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
curl http://localhost:8180/api/health
```

回退方案：如升级失败，`git checkout <旧版本>` 后重复步骤 2；数据库迁移为前进式设计，不降级迁移，如需回退数据用第 2 节完整恢复流程恢复升级前备份。

## 四、关键约定（与实现一致，勿跳步）

1. 迁移只前进：`alembic` 链 `0001→0009`，backend 每次启动自动 `upgrade head`。
2. `.env` 不入库，升级后对比 `.env.example` 新增项。
3. 备份文件命名含时间戳；14 天前的备份自动清理（backup 服务与手动脚本共用命名约定）。
4. 附件随备份脚本一并归档（手动脚本与 backup 服务都会打 `attachments_*.tar.gz`，目录不存在时自动跳过）。