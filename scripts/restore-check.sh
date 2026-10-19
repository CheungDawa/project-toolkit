#!/bin/bash
# 恢复演练（T1-11 / NFR-12 前置）：取最新备份恢复到临时库，校验项目数后删除临时库
# 用法：scripts/restore-check.sh
#
# 兼容两种备份格式：
#   pt_YYYYmmdd_HHMMSS.dump     新版（pg_dump -Fc 原生归档，直接喂给 pg_restore）
#   pt_YYYYmmdd_HHMMSS.dump.gz  历史版本（-Fc 外层又 gzip 了一次，需先 zcat）
set -euo pipefail
cd "$(dirname "$0")/.."

# 两种 glob 合并后按修改时间取最新（缺失的 glob 由 2>/dev/null 吞掉报错）
DUMP=$(ls -t data/backups/pt_*.dump data/backups/pt_*.dump.gz 2>/dev/null | head -1 || true)
if [ -z "${DUMP:-}" ]; then
  echo "[restore] 未找到备份文件（先执行 scripts/backup.sh 或启用 backup 服务）"
  exit 1
fi

DB="projecttoolkit_restore_test"
echo "[restore] 使用备份: $DUMP"
docker compose exec -T db dropdb -U pt --if-exists "$DB" >/dev/null 2>&1 || true
docker compose exec -T db createdb -U pt "$DB"

case "$DUMP" in
  *.dump.gz)
    # 历史格式：外层是 gzip，先解压再交给 pg_restore
    zcat "$DUMP" | docker compose exec -T db pg_restore -U pt -d "$DB" --no-owner --role=pt
    ;;
  *)
    # 新格式：-Fc 已是 pg_restore 可直接读取的归档，不经 zcat，直接重定向到标准输入
    docker compose exec -T db pg_restore -U pt -d "$DB" --no-owner --role=pt < "$DUMP"
    ;;
esac

COUNT=$(docker compose exec -T db psql -U pt -d "$DB" -tAc "SELECT count(*) FROM projects;")
# 归一化：psql 可能带空白/换行，非数字一律按 0 处理，避免 set -e 下 "integer expression expected" 走到奇怪分支
COUNT=$(printf '%s' "$COUNT" | tr -d '[:space:]')
case "$COUNT" in
  ''|*[!0-9]*) COUNT=0 ;;
esac

# 恢复演练的全部意义在于"备份真的能恢复出数据"：0 行 = 空库，必须判失败，
# 否则一份空/损坏的备份也会打印「恢复成功」并 exit 0，演练就白做了。
if [ "$COUNT" -lt 1 ]; then
  echo "[restore] 失败：恢复后 projects 表为 0 行，备份可能为空或损坏" >&2
  echo "[restore] 临时库 $DB 已保留便于排查，处理后可删除：docker compose exec -T db dropdb -U pt $DB" >&2
  exit 1
fi

echo "[restore] 恢复成功 → $DB，项目数=$COUNT"
docker compose exec -T db dropdb -U pt "$DB"
echo "[restore] 校验完成，临时库已清理"
