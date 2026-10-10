FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Shanghai

# 非 root 运行（T6-01 加固）：uid/gid=1000 与常用 WSL 用户一致
RUN useradd --create-home --uid 1000 --user-group appuser

WORKDIR /srv

COPY backend/requirements.txt backend/requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-dev.txt

COPY backend/ ./
COPY docker/backend-entrypoint.sh ./entrypoint.sh

RUN chown -R appuser:appuser /srv

USER appuser

EXPOSE 8000

ENTRYPOINT ["sh", "entrypoint.sh"]
