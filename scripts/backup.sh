#!/bin/bash
# Project Toolkit 数据库与文件备份（T1-11）
# 用法：scripts/backup.sh
#
# 与自动备份服务（scripts/backup-loop.sh）保持一致的产物约定：
#   data/backups/pt_YYYYmmdd_HHMMSS.dump          数据库（pg_dump -Fc 原生归档）
#   data/backups/attachments_YYYYmmdd_HHMMSS.tar.gz  附件（data/attachments 存在时）
# -Fc 已自带压缩，不要再管道 gzip：外层 gzip 会让 pg_restore 无法直接读取，
# 且恢复时多一步 zcat（历史 pt_*.dump.gz 仍可恢复，见 restore-check.sh）。
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p data/backups

TMP_DUMP="data/backups/.pt_${STAMP}.dump.tmp"
DB_DUMP="data/backups/pt_${STAMP}.dump"

# 保留期清理，与 scripts/backup-loop.sh 同口径。
# 只在备份成功发布之后调用：失败时保持旧备份原样，绝不能"旧的删了、新的没成"。
cleanup_old_backups() {
  find data/backups -type f -name 'pt_*.dump' -mtime +14 -delete 2>/dev/null || true
  find data/backups -type f -name 'pt_*.dump.gz' -mtime +14 -delete 2>/dev/null || true
  find data/backups -type f -name 'attachments_*.tar.gz' -mtime +14 -delete 2>/dev/null || true
  find data/backups -type f -name 'files_*.tar.gz' -mtime +14 -delete 2>/dev/null || true
  find data/backups -type f -name '*.tmp' -mtime +2 -delete 2>/dev/null || true
  find data/backups -type f -name '*.failed' -mtime +2 -delete 2>/dev/null || true
}

echo "[backup] 开始数据库备份 ..."
if ! docker compose exec -T db pg_dump -U pt -d projecttoolkit -Fc > "$TMP_DUMP"; then
  rm -f "$TMP_DUMP"
  echo "[backup] 失败：pg_dump 退出码非 0，请检查 db 服务与口令" >&2
  exit 1
fi

# ---- 产物校验：大小 ----
SIZE=$(wc -c < "$TMP_DUMP" | tr -d ' ')
if [ -z "$SIZE" ] || [ "$SIZE" -le 1024 ]; then
  rm -f "$TMP_DUMP"
  echo "[backup] 失败：导出文件过小（${SIZE:-0} 字节），请确认 db 服务健康且口令正确" >&2
  exit 1
fi

# ---- 产物校验：归档可读，且确实含表数据 ----
# pg_restore -l 不带文件名时从标准输入读取归档，因此可以把本地文件喂给容器内命令。
TABLE_COUNT=$(docker compose exec -T db pg_restore -l < "$TMP_DUMP" 2>/dev/null | grep -c 'TABLE DATA' || true)
if [ "${TABLE_COUNT:-0}" -lt 1 ]; then
  rm -f "$TMP_DUMP"
  echo "[backup] 失败：备份归档里没有表数据（pg_restore -l 无 TABLE DATA 条目）" >&2
  exit 1
fi

mv "$TMP_DUMP" "$DB_DUMP"
echo "[backup] 数据库备份完成: $DB_DUMP（${SIZE} 字节，${TABLE_COUNT} 个表数据段）"

# 备份已落地，现在才做保留期清理（失败路径在上面已经 exit 1，不会走到这里）
cleanup_old_backups

# ---- 附件归档（尽力而为，失败不影响已完成的数据库备份）----
VOLUMES=()
for d in attachments exports; do
  if [ -d "data/$d" ]; then
    VOLUMES+=("$d")
  fi
done

if [ ${#VOLUMES[@]} -eq 0 ]; then
  echo "[backup] data/attachments 与 data/exports 均不存在，跳过文件备份"
  exit 0
fi

TMP_FILES="data/backups/.attachments_${STAMP}.tar.gz.tmp"
FILES_BACKUP="data/backups/attachments_${STAMP}.tar.gz"

if tar -czf "$TMP_FILES" -C data "${VOLUMES[@]}" 2>/dev/null && tar -tzf "$TMP_FILES" >/dev/null 2>&1; then
  mv "$TMP_FILES" "$FILES_BACKUP"
  echo "[backup] 文件备份完成: $FILES_BACKUP"
else
  rm -f "$TMP_FILES"
  echo "[backup] 警告：附件归档失败（已跳过），数据库备份不受影响" >&2
fi

echo "[backup] 完成"
