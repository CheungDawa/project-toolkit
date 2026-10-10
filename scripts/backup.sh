#!/bin/bash
# Project Toolkit 数据库与文件备份（T1-11）
# 用法：scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p data/backups

FILE="data/backups/pt_${STAMP}.dump.gz"
echo "[backup] 开始数据库备份 ..."
docker compose exec -T db pg_dump -U pt -d projecttoolkit -Fc | gzip > "$FILE"
echo "[backup] 数据库备份完成: $FILE ($(du -h "$FILE" | cut -f1))"

FILES_BACKUP="data/backups/files_${STAMP}.tar.gz"
if tar -czf "$FILES_BACKUP" -C data attachments exports 2>/dev/null; then
  echo "[backup] 文件备份完成: $FILES_BACKUP"
else
  rm -f "$FILES_BACKUP"
  echo "[backup] 附件/导出目录为空，跳过文件备份"
fi
echo "[backup] 完成"