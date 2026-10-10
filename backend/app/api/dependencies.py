"""任务依赖 API（阶段 2 WBS条5：循环依赖校验）。"""
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.models.task import Task, TaskDependency
from app.schemas.task import DependencyCreate, DependencyRead
from app.services import cycle as cycle_service
from app.services import wbs as wbs_service
from app.services import audit as audit_service

router = APIRouter(prefix="/api", tags=["dependencies"])


@router.get("/projects/{project_id}/dependencies", response_model=list[DependencyRead])
def list_dependencies(project_id: UUID, db: Session = Depends(get_db)) -> list:
    return list(
        db.scalars(select(TaskDependency).where(TaskDependency.project_id == project_id)).all()
    )


@router.post("/projects/{project_id}/dependencies", status_code=201, response_model=DependencyRead)
def create_dependency(
    project_id: UUID, payload: DependencyCreate, db: Session = Depends(get_db)
) -> TaskDependency:
    pred = _require_live_task(db, payload.predecessor_id, project_id)
    succ = _require_live_task(db, payload.successor_id, project_id)
    if pred.id == succ.id:
        raise AppError(422, "self_dependency", "任务不能依赖自身", fields={"successor_id": ["任务不能依赖自身"]})

    existing = list(
        db.scalars(select(TaskDependency).where(TaskDependency.project_id == project_id)).all()
    )
    if cycle_service.would_create_cycle(existing, pred.id, succ.id):
        raise AppError(422, "dependency_cycle", "依赖关系将形成循环，已拒绝", fields={"successor_id": ["依赖关系将形成循环，已拒绝"]})

    dup = db.scalar(
        select(TaskDependency).where(
            TaskDependency.project_id == project_id,
            TaskDependency.predecessor_id == pred.id,
            TaskDependency.successor_id == succ.id,
            TaskDependency.dep_type == payload.dep_type,
        )
    )
    if dup is not None:
        raise AppError(422, "dependency_exists", "相同依赖已存在", fields={"dep_type": ["相同依赖已存在"]})

    dep = TaskDependency(
        project_id=project_id,
        predecessor_id=pred.id,
        successor_id=succ.id,
        dep_type=payload.dep_type,
        lag_days=payload.lag_days,
    )
    db.add(dep)
    audit_service.record(db, project_id, "dependency", dep.id, "create", f"新增依赖：{pred.wbs_code} → {succ.wbs_code}")
    db.commit()
    db.refresh(dep)
    return dep


@router.delete("/dependencies/{dependency_id}", status_code=204)
def delete_dependency(dependency_id: UUID, db: Session = Depends(get_db)) -> None:
    dep = db.scalar(select(TaskDependency).where(TaskDependency.id == dependency_id))
    if dep is None:
        raise AppError(404, "not_found", "依赖关系不存在")
    db.delete(dep)
    db.commit()


def _require_live_task(db: Session, task_id: UUID, project_id: UUID) -> Task:
    task = db.scalar(
        select(Task).where(
            Task.id == task_id,
            Task.project_id == project_id,
            Task.deleted_at.is_(None),
        )
    )
    if task is None:
        raise AppError(404, "not_found", f"任务不存在：{task_id}")
    return task