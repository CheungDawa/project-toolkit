"""进度快照与燃尽数据 API（T5-01/T5-02；BR-03）。"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.project import Project
from app.models.stage5 import ProgressSnapshot
from app.services import snapshot as snapshot_service

router = APIRouter(prefix="/api", tags=["progress"])


class SnapshotRead(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    scope: str
    snapshot_date: date
    total_tasks: int
    completed_tasks: int
    remaining_tasks: int
    total_hours: float
    remaining_hours: float
    captured_at: object


class CaptureRequest(BaseModel):
    date: date | None = None  # 补录历史（≤ 今天）


@router.post("/projects/{project_id}/snapshots", status_code=201)
def capture_snapshot(project_id: UUID, payload: CaptureRequest | None = None, db: Session = Depends(get_db)) -> dict:
    target = payload.date if payload and payload.date else None
    if target and target > date.today():
        from app.core.errors import AppError
        raise AppError(422, "future_date", "不能补录未来日期")
    snap = snapshot_service.capture_snapshot(db, project_id, target)
    db.commit()
    return _snapshot_dict(snap)


@router.get("/projects/{project_id}/snapshots")
def list_snapshots(project_id: UUID, db: Session = Depends(get_db)) -> list[dict]:
    snaps = snapshot_service.list_snapshots(db, project_id)
    return [_snapshot_dict(s) for s in snaps]


@router.get("/projects/{project_id}/burndown")
def burndown(project_id: UUID, days: int = Query(default=90, ge=1, le=365), db: Session = Depends(get_db)) -> dict:
    """燃尽数据：仅真实快照；理想线从首个快照到计划结束日（无计划日期则到最近快照日）。"""
    snaps = snapshot_service.list_snapshots(db, project_id)
    recent = [s for s in snaps if s.snapshot_date >= (date.today() - timedelta(days=days))]
    if not recent:
        return {"snapshots": [], "ideal": []}

    project = db.scalar(select(Project).where(Project.id == project_id))
    target_date = project.plan_end if project and project.plan_end else recent[-1].snapshot_date
    first = recent[0]

    points = [
        {
            "date": s.snapshot_date.isoformat(),
            "total_tasks": s.total_tasks,
            "remaining_tasks": s.remaining_tasks,
            "completed_tasks": s.completed_tasks,
            "total_hours": float(s.total_hours),
            "remaining_hours": float(s.remaining_hours),
        }
        for s in recent
    ]

    ideal: list[dict] = []
    if target_days := max((target_date - first.snapshot_date).days, 1):
        for offset in range(0, target_days + 1):
            day = first.snapshot_date + timedelta(days=offset)
            if day > date.today():
                break
            ratio = offset / target_days
            ideal.append({
                "date": day.isoformat(),
                "remaining_tasks": round(first.remaining_tasks * (1 - ratio), 1),
                "remaining_hours": round(float(first.remaining_hours) * (1 - ratio), 1),
            })

    return {"snapshots": points, "ideal": ideal, "target_date": target_date.isoformat()}


def _snapshot_dict(s: ProgressSnapshot) -> dict:
    return {
        "id": str(s.id),
        "scope": s.scope,
        "snapshot_date": s.snapshot_date.isoformat(),
        "total_tasks": s.total_tasks,
        "completed_tasks": s.completed_tasks,
        "remaining_tasks": s.remaining_tasks,
        "total_hours": float(s.total_hours),
        "remaining_hours": float(s.remaining_hours),
        "captured_at": s.captured_at.isoformat(),
    }