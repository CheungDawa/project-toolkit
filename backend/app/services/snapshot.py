"""进度快照服务（T5-01；BR-03：只从真实记录生成燃尽数据，不编造过去）。"""
from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import today_local
from app.models.stage5 import ProgressSnapshot
from app.models.task import Task
from app.services import progress as progress_service
from app.services import wbs as wbs_service

SNAPSHOT_KEY = "snapshot.policy"
DEFAULT_POLICY = {"mode": "daily_first_write"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def compute_project_state(db: Session, project_id: UUID) -> dict:
    """项目级状态：统一走 project_metrics，父子工时不重复计入。

    旧实现把父任务与子任务的 work_hours 直接求和，总量虚高近一倍，
    燃尽图起点因此是错的；现按叶子任务汇总，语义与 ProgressSnapshot 落库字段一致。
    """
    tasks = wbs_service.list_tasks_ordered(db, project_id)
    metrics = progress_service.project_metrics(tasks)
    return {
        "total_tasks": metrics["total_tasks"],
        "completed_tasks": metrics["completed_tasks"],
        "remaining_tasks": metrics["remaining_tasks"],
        "total_hours": metrics["total_hours"],
        "remaining_hours": metrics["remaining_hours"],
    }


def capture_snapshot(db: Session, project_id: UUID, snapshot_date: date | None = None) -> ProgressSnapshot:
    """记录当日项目级快照（同一天更新为最新状态，历史日期不变）。"""
    # 「今天」统一取北京时间，避免 UTC 与本地日期差一天
    snapshot_date = snapshot_date or today_local()
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
    """按 snapshot.policy：开启时在写操作后采集/更新当日快照（当日保持最新状态）。"""
    from app.models.setting import Setting
    setting = db.scalar(select(Setting).where(Setting.key == SNAPSHOT_KEY))
    policy = setting.value if setting and isinstance(setting.value, dict) else {}
    mode = policy.get("mode", DEFAULT_POLICY["mode"])
    if mode == "off":
        return
    db.add(capture_snapshot(db, project_id))
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