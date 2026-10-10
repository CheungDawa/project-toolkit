"""变更跟踪 / 干系人 / 沟通历史 / 审计日志 API。"""
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.models.stage3 import (
    ActivityLog,
    ChangeRequest,
    Stakeholder,
    StakeholderCommunication,
)
from app.schemas.stage3 import (
    AuditLogRead,
    ChangeCreate,
    ChangeRead,
    ChangeUpdate,
    CommunicationCreate,
    StakeholderCreate,
    StakeholderRead,
    StakeholderUpdate,
)
from app.services import audit

router = APIRouter(prefix="/api", tags=["changes-stakeholders-audit"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------- 变更 ----------

@router.get("/projects/{project_id}/changes", response_model=list[ChangeRead])
def list_changes(project_id: UUID, db: Session = Depends(get_db)) -> list:
    return list(
        db.scalars(
            select(ChangeRequest)
            .where(ChangeRequest.project_id == project_id)
            .order_by(ChangeRequest.created_at)
        ).all()
    )


@router.post("/projects/{project_id}/changes", status_code=201, response_model=ChangeRead)
def create_change(project_id: UUID, payload: ChangeCreate, db: Session = Depends(get_db)) -> ChangeRequest:
    change = ChangeRequest(project_id=project_id, **payload.model_dump())
    db.add(change)
    db.flush()
    audit.record(db, project_id, "change", change.id, "create", f"创建变更：{change.title}")
    db.commit()
    db.refresh(change)
    return change


@router.patch("/changes/{change_id}", response_model=ChangeRead)
def update_change(change_id: UUID, payload: ChangeUpdate, db: Session = Depends(get_db)) -> ChangeRequest:
    change = _get_change(db, change_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(change, key, value)
    db.flush()
    audit.record(
        db, change.project_id, "change", change.id, "update",
        f"更新变更：{change.title}（审批状态：{change.approval_status}）",
    )
    db.commit()
    db.refresh(change)
    return change


@router.delete("/changes/{change_id}", status_code=204)
def delete_change(change_id: UUID, db: Session = Depends(get_db)) -> None:
    change = _get_change(db, change_id)
    db.delete(change)
    db.flush()
    audit.record(db, change.project_id, "change", change.id, "delete", f"删除变更：{change.title}")
    db.commit()


def _get_change(db: Session, change_id: UUID) -> ChangeRequest:
    change = db.scalar(select(ChangeRequest).where(ChangeRequest.id == change_id))
    if change is None:
        raise AppError(404, "not_found", "变更不存在")
    return change


# ---------- 干系人（P1） ----------

@router.get("/projects/{project_id}/stakeholders", response_model=list[StakeholderRead])
def list_stakeholders(project_id: UUID, db: Session = Depends(get_db)) -> list:
    return list(
        db.scalars(
            select(Stakeholder)
            .where(Stakeholder.project_id == project_id)
            .order_by(Stakeholder.created_at)
        ).all()
    )


@router.post("/projects/{project_id}/stakeholders", status_code=201, response_model=StakeholderRead)
def create_stakeholder(project_id: UUID, payload: StakeholderCreate, db: Session = Depends(get_db)) -> Stakeholder:
    stakeholder = Stakeholder(project_id=project_id, **payload.model_dump())
    db.add(stakeholder)
    db.commit()
    db.refresh(stakeholder)
    return stakeholder


@router.patch("/stakeholders/{stakeholder_id}", response_model=StakeholderRead)
def update_stakeholder(stakeholder_id: UUID, payload: StakeholderUpdate, db: Session = Depends(get_db)) -> Stakeholder:
    stakeholder = _get_stakeholder(db, stakeholder_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(stakeholder, key, value)
    db.commit()
    db.refresh(stakeholder)
    return stakeholder


@router.delete("/stakeholders/{stakeholder_id}", status_code=204)
def delete_stakeholder(stakeholder_id: UUID, db: Session = Depends(get_db)) -> None:
    stakeholder = _get_stakeholder(db, stakeholder_id)
    db.delete(stakeholder)
    db.commit()


def _get_stakeholder(db: Session, stakeholder_id: UUID) -> Stakeholder:
    stakeholder = db.scalar(select(Stakeholder).where(Stakeholder.id == stakeholder_id))
    if stakeholder is None:
        raise AppError(404, "not_found", "干系人不存在")
    return stakeholder


# ---------- 沟通历史（P1） ----------

@router.get("/stakeholders/{stakeholder_id}/communications")
def list_communications(stakeholder_id: UUID, db: Session = Depends(get_db)) -> list:
    _get_stakeholder(db, stakeholder_id)
    return list(
        db.scalars(
            select(StakeholderCommunication)
            .where(StakeholderCommunication.stakeholder_id == stakeholder_id)
            .order_by(StakeholderCommunication.comm_date.desc().nulls_last(), StakeholderCommunication.created_at.desc())
        ).all()
    )


@router.post("/stakeholders/{stakeholder_id}/communications", status_code=201)
def create_communication(stakeholder_id: UUID, payload: CommunicationCreate, db: Session = Depends(get_db)) -> dict:
    _get_stakeholder(db, stakeholder_id)
    comm = StakeholderCommunication(stakeholder_id=stakeholder_id, **payload.model_dump())
    db.add(comm)
    db.commit()
    db.refresh(comm)
    return {"id": str(comm.id)}


@router.delete("/communications/{communication_id}", status_code=204)
def delete_communication(communication_id: UUID, db: Session = Depends(get_db)) -> None:
    comm = db.scalar(
        select(StakeholderCommunication).where(StakeholderCommunication.id == communication_id)
    )
    if comm is None:
        raise AppError(404, "not_found", "沟通记录不存在")
    db.delete(comm)
    db.commit()


# ---------- 审计 ----------

@router.get("/projects/{project_id}/audit", response_model=list[AuditLogRead])
def list_audit_logs(
    project_id: UUID,
    action: str | None = None,
    object_type: str | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
) -> list:
    stmt = select(ActivityLog).where(ActivityLog.project_id == project_id)
    if action:
        stmt = stmt.where(ActivityLog.action == action)
    if object_type:
        stmt = stmt.where(ActivityLog.object_type == object_type)
    return list(
        db.scalars(stmt.order_by(ActivityLog.occurred_at.desc()).limit(min(limit, 500))).all()
    )