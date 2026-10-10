#!/bin/sh
# backend 容器入口：等库 → 迁移 → 启动（03 文档：启动前自动 alembic upgrade head）
set -e

echo "[entrypoint] 等待数据库可用 ..."
python - <<'PY'
import os
import sys
import time

import psycopg

url = os.environ["DATABASE_URL"].replace("+psycopg", "")
last_error = None
for _ in range(60):
    try:
        psycopg.connect(url, connect_timeout=3).close()
        break
    except Exception as exc:  # noqa: BLE001
        last_error = exc
        time.sleep(1)
else:
    print(f"[entrypoint] 数据库连接失败: {last_error}", file=sys.stderr)
    sys.exit(1)
PY

echo "[entrypoint] 执行数据库迁移 ..."
alembic upgrade head

echo "[entrypoint] 启动 API 服务 ..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips="*"
