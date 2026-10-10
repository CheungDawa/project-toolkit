"""进度快照服务（T5-01；BR-03：只从真实记录生成燃尽数据，不编造过去）。"""
from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.stage5 import ProgressSnapshot
from app.models.task import Task
from app.services import wbs as wbs_service

SNAPSHOT_KEY = "snapshot.policy"
DEFAULT_POLICY = {"mode": "daily_first_write"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def compute_project_state(db: Session, project_id: UUID) -> dict:
    tasks = wbs_service.list_tasks_ordered(db, project_id)
    total = len(tasks)
    completed = sum(1 for t in tasks if t.status == "已完成")
    total_hours = sum(float(t.work_hours or 0) for t in tasks)
    remaining_hours = sum(float(t.work_hours or 0) for t in tasks if t.status != "已完成")
    return {
        "total_tasks": total,
        "completed_tasks": completed,
        "remaining_tasks": total - completed,
        "total_hours": round(total_hours, 2),
        "remaining_hours": round(remaining_hours, 2),
    }


def capture_snapshot(db: Session, project_id: UUID, snapshot_date: date | None = None) -> ProgressSnapshot:
    """记录当日项目级快照（同一天更新为最新状态，历史日期不变）。"""
    snapshot_date = snapshot_date or _utcnow().date()
    state = compute_project_state(db, project_id)

    existing = db.scalar(
        select(ProgressSnapshot).where(
            ProgressSnapshot.project_id == project_id,
            ProgressSnapshot.scope == "project",
            ProgressSnapshot.snapshot_date == snapshot_date,
        )
    )
    if existing is not None:
        existing.total_tasks = state["total_tasks"]
        existing.completed_tasks = state["completed_tasks"]
        existing.remaining_tasks = state["remaining_tasks"]
        existing.total_hours = state["total_hours"]
        existing.remaining_hours = state["remaining_hours"]
        existing.captured_at = _utcnow()
        return existing

    snapshot = ProgressSnapshot(
        project_id=project_id,
        scope="project",
        snapshot_date=snapshot_date,
        total_tasks=state["total_tasks"],
        completed_tasks=state["completed_tasks"],
        remaining_tasks=state["remaining_tasks"],
        total_hours=state["total_hours"],
        remaining_hours=state["remaining_hours"],
        captured_at=_utcnow(),
    )
    db.add(snapshot)
    return snapshot


def maybe_capture_daily(db: Session, project_id: UUID) -> None:
    """按 snapshot.policy.mode=daily_first_write：当天首次写操作后采集。"""
    from app.models.setting import Setting
    setting = db.scalar(select(Setting).where(Setting.key == SNAPSHOT_KEY))
    policy = setting.value if setting and isinstance(setting.value, dict) else {}
    mode = policy.get("mode", DEFAULT_POLICY["mode"])
    if mode == "off":
        return
    today = _utcnow().date()
    exists = db.scalar(
        select(ProgressSnapshot.id).where(
            ProgressSnapshot.project_id == project_id,
            ProgressSnapshot.scope == "project",
            ProgressSnapshot.snapshot_date == today,
        )
    )
    if exists is None:
        db.add(capture_snapshot(db, project_id, today))
        db.commit()


def list_snapshots(db: Session, project_id: UUID, limit: int = 500) -> list[ProgressSnapshot]:
    return list(
        db.scalars(
            select(ProgressSnapshot)
            .where(ProgressSnapshot.project_id == project_id, ProgressSnapshot.scope == "project")
            .order_by(ProgressSnapshot.snapshot_date)
            .limit(limit)
        ).all()
    )