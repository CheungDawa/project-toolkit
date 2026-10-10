"""计划基线 API（BR-02：保存后当前计划修改不影响基线快照）。"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.models.task import BaselineTaskSnapshot, ScheduleBaseline, Task
from app.schemas.task import BaselineCreate, BaselineDiffRow, BaselineRead
from app.services import progress as progress_service
from app.services import wbs as wbs_service
from app.services import audit as audit_service

router = APIRouter(prefix="/api", tags=["baselines"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@router.get("/projects/{project_id}/baselines", response_model=list[BaselineRead])
def list_baselines(project_id: UUID, db: Session = Depends(get_db)) -> list:
    return list(
        db.scalars(
            select(ScheduleBaseline)
            .where(ScheduleBaseline.project_id == project_id)
            .order_by(ScheduleBaseline.created_at)
        ).all()
    )


@router.post("/projects/{project_id}/baselines", status_code=201, response_model=BaselineRead)
def create_baseline(project_id: UUID, payload: BaselineCreate, db: Session = Depends(get_db)) -> ScheduleBaseline:
    tasks = wbs_service.list_tasks_ordered(db, project_id)
    if not tasks:
        raise AppError(422, "empty_plan", "项目尚无任务，无法保存基线")

    existing = list(
        db.scalars(
            select(ScheduleBaseline).where(ScheduleBaseline.project_id == project_id)
        ).all()
    )
    version = (max((b.version for b in existing), default=0) or 0) + 1
    frozen_at = _utcnow()

    baseline = ScheduleBaseline(
        project_id=project_id,
        name=payload.name,
        version=version,
        frozen_at=frozen_at,
        note=payload.note,
    )
    db.add(baseline)
    db.flush()

    # 记录层级：从任务树计算 level
    by_parent: dict[UUID | None, list[Task]] = {}
    for task in tasks:
        by_parent.setdefault(task.parent_id, []).append(task)

    def walk(parent_id: UUID | None, level: int) -> None:
        for task in by_parent.get(parent_id, []):
            db.add(
                BaselineTaskSnapshot(
                    baseline_id=baseline.id,
                    task_id=task.id,
                    level=level,
                    wbs_code=task.wbs_code,
                    name=task.name,
                    sort_order=task.sort_order,
                    plan_start=task.plan_start,
                    plan_end=task.plan_end,
                    duration_days=task.duration_days,
                    work_hours=task.work_hours,
                    progress=task.progress or 0,
                    captured_at=frozen_at,
                )
            )
            walk(task.id, level + 1)

    walk(None, 1)
    audit_service.record(db, project_id, "baseline", baseline.id, "create", f"保存计划基线：{payload.name}（v{version}）")
    db.commit()
    db.refresh(baseline)
    return baseline


@router.get("/projects/{project_id}/baselines/{baseline_id}/diff", response_model=list[BaselineDiffRow])
def compare_baseline(
    project_id: UUID, baseline_id: UUID, db: Session = Depends(get_db)
) -> list[BaselineDiffRow]:
    baseline = db.scalar(
        select(ScheduleBaseline).where(
            ScheduleBaseline.id == baseline_id,
            ScheduleBaseline.project_id == project_id,
        )
    )
    if baseline is None:
        raise AppError(404, "not_found", "基线不存在")

    snapshots = list(
        db.scalars(
            select(BaselineTaskSnapshot)
            .where(BaselineTaskSnapshot.baseline_id == baseline_id)
            .order_by(BaselineTaskSnapshot.wbs_code)
        ).all()
    )
    tasks_by_id = {
        task.id: task for task in wbs_service.list_tasks_ordered(db, project_id)
    }

    rows: list[BaselineDiffRow] = []
    for snap in snapshots:
        task = tasks_by_id.get(snap.task_id)
        current = {
            "plan_start": task.plan_start.isoformat() if task and task.plan_start else None,
            "plan_end": task.plan_end.isoformat() if task and task.plan_end else None,
            "duration_days": task.duration_days if task else None,
            "work_hours": float(task.work_hours) if task and task.work_hours is not None else None,
            "progress": float(task.progress) if task else None,
            "status": task.status if task else None,
        } if task else {"deleted": True}
        baseline_side = {
            "plan_start": snap.plan_start.isoformat() if snap.plan_start else None,
            "plan_end": snap.plan_end.isoformat() if snap.plan_end else None,
            "duration_days": snap.duration_days,
            "work_hours": float(snap.work_hours) if snap.work_hours is not None else None,
            "progress": float(snap.progress),
        }
        changed = bool(task) and (
            current["plan_start"] != baseline_side["plan_start"]
            or current["plan_end"] != baseline_side["plan_end"]
            or current["duration_days"] != baseline_side["duration_days"]
            or current["work_hours"] != baseline_side["work_hours"]
            or current["progress"] != baseline_side["progress"]
        )
        rows.append(
            BaselineDiffRow(
                task_id=snap.task_id,
                wbs_code=snap.wbs_code,
                level=snap.level,
                name=snap.name,
                current=current,
                baseline=baseline_side,
                changed=changed,
            )
        )
    return rows