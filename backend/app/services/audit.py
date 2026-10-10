"""审计日志服务（T3-10：关键操作写入 activity_logs）。"""
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.stage3 import ActivityLog


def record(
    db: Session,
    project_id: UUID | None,
    object_type: str,
    object_id: UUID | None,
    action: str,
    summary: str,
    payload_diff: dict | None = None,
    operator: str = "owner",
) -> ActivityLog:
    log = ActivityLog(
        project_id=project_id,
        object_type=object_type,
        object_id=object_id,
        action=action,
        summary=summary,
        payload_diff=payload_diff,
        operator=operator,
        occurred_at=datetime.now(timezone.utc),
    )
    db.add(log)
    return log