#!/bin/bash
# 恢复演练（T1-11 / NFR-12 前置）：取最新备份恢复到临时库，校验项目数后删除临时库
# 用法：scripts/restore-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DUMP=$(ls -t data/backups/pt_*.dump.gz 2>/dev/null | head -1 || true)
if [ -z "${DUMP:-}" ]; then
  echo "[restore] 未找到备份文件（先执行 scripts/backup.sh）"
  exit 1
fi

DB="projecttoolkit_restore_test"
echo "[restore] 使用备份: $DUMP"
docker compose exec -T db dropdb -U pt --if-exists "$DB" >/dev/null 2>&1 || true
docker compose exec -T db createdb -U pt "$DB"
zcat "$DUMP" | docker compose exec -T db pg_restore -U pt -d "$DB" --no-owner --role=pt
COUNT=$(docker compose exec -T db psql -U pt -d "$DB" -tAc "SELECT count(*) FROM projects;")
echo "[restore] 恢复成功 → $DB，项目数=$COUNT"
docker compose exec -T db dropdb -U pt "$DB"
echo "[restore] 校验完成，临时库已清理"