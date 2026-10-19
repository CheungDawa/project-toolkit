"""变更跟踪 / 干系人 / 沟通历史 / 审计日志 API。"""
import logging
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.models.project import Project
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
    CommunicationRead,
    StakeholderCreate,
    StakeholderRead,
    StakeholderUpdate,
)
from app.services import audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["changes-stakeholders-audit"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_project(db: Session, project_id: UUID) -> Project:
    """项目必须存在且未删除，否则 404（避免让 FK 异常落到行级错误里）。"""
    project = db.scalar(
        select(Project).where(Project.id == project_id, Project.deleted_at.is_(None))
    )
    if project is None:
        raise AppError(404, "not_found", "项目不存在")
    return project


def _safe_rollback(db: Session) -> None:
    try:
        db.rollback()
    except Exception:  # noqa: BLE001
        logger.exception("回滚会话失败")


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


class StakeholderImportRequest(BaseModel):
    items: list[StakeholderCreate]


@router.post("/projects/{project_id}/stakeholders/import")
def import_stakeholders(
    project_id: UUID, payload: StakeholderImportRequest, db: Session = Depends(get_db)
) -> dict:
    """批量导入干系人（旧工具迁移用）。

    加固点：
    1. 项目不存在 → 404（不再让外键冲突伪装成行级错误，也不会让收尾审计炸成 500）；
    2. 同一项目内「姓名 + 单位」已存在（含本批次内重复）→ 跳过并计入 skipped，重复导入不再翻倍；
    3. 单行 Db 异常用 savepoint（begin_nested）隔离，不影响其余行；
    4. 全部行构造完成后**单次提交**，审计与可选收尾操作放在提交之后且失败只记日志。

    返回：{"created": int, "skipped": int, "errors": [{"row", "message"}]}
    """
    _ensure_project(db, project_id)

    handled: set[tuple[str, str]] = set()
    for name, org in db.execute(
        select(Stakeholder.name, Stakeholder.org).where(Stakeholder.project_id == project_id)
    ).all():
        handled.add(_identity(name, org))

    created = 0
    skipped = 0
    errors: list[dict] = []
    for index, item in enumerate(payload.items, start=1):
        data = item.model_dump()
        name = str(data.get("name") or "").strip()
        if not name:
            errors.append({"row": index, "message": "姓名不能为空"})
            continue
        org = data.get("org")
        org = str(org).strip() if org not in (None, "") else None
        key = _identity(name, org)
        if key in handled:
            skipped += 1
            continue
        try:
            with db.begin_nested():  # savepoint：单行失败只回滚这一行
                data["name"] = name
                data["org"] = org
                db.add(Stakeholder(project_id=project_id, **data))
                db.flush()  # 立即落 SQL，使行级错误在 savepoint 内暴露
        except Exception as exc:  # noqa: BLE001
            logger.warning("导入干系人第 %s 行失败：%s", index, exc)
            errors.append({"row": index, "message": str(exc)})
            continue
        handled.add(key)
        created += 1

    if created:
        try:
            db.commit()
        except Exception as exc:  # noqa: BLE001
            _safe_rollback(db)
            logger.exception("批量导入干系人提交失败，已整批回滚")
            raise AppError(
                422, "import_failed", f"批量导入干系人失败：{exc}"
            ) from None

    _record_import_audit(db, project_id, created, skipped, errors)
    return {"created": created, "skipped": skipped, "errors": errors}


def _identity(name: str | None, org: str | None) -> tuple[str, str]:
    """去重键：姓名 + 单位（大小写/空格不敏感）。"""
    return (
        str(name or "").strip().casefold(),
        str(org or "").strip().casefold(),
    )


def _record_import_audit(
    db: Session, project_id: UUID, created: int, skipped: int, errors: list[dict]
) -> None:
    """审计写在数据提交之后；失败只记日志，绝不让接口变成 500。"""
    try:
        audit.record(
            db, project_id, "stakeholder", None, "import",
            f"批量导入干系人：新增 {created} 条，跳过重复 {skipped} 条，失败 {len(errors)} 条",
            payload_diff={"created": created, "skipped": skipped, "errors": errors[:20]},
        )
        db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("批量导入干系人后写入审计日志失败（数据已提交，不影响导入结果）")
        _safe_rollback(db)


# ---------- 沟通历史（P1） ----------

@router.get("/stakeholders/{stakeholder_id}/communications", response_model=list[CommunicationRead])
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