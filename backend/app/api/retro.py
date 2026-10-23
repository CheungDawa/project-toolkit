"""复盘模块 API：复盘 CRUD + 行动项 CRUD + 行动项回写（task/risk/issue）。

路由风格对齐 tasks.py：project_id 走路径参数（UUID），db 走 get_db 依赖，
项目缺失统一 404。所有日期走 ISO 字符串、UUID 走字符串（由 pydantic 处理）。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.models.project import Project
from app.models.retro import Retrospective, RetroActionItem
from app.models.stage3 import Issue, Risk
from app.models.task import Task
from app.schemas.retro import (
    RetroActionItemCreate,
    RetroActionItemRead,
    RetroActionItemUpdate,
    RetroConvertRequest,
    RetroConvertResult,
    RetroLinkType,
    RetrospectiveCreate,
    RetrospectiveRead,
    RetrospectiveUpdate,
)
from app.services import audit
from app.services import risk_score
from app.services import wbs as wbs_service

router = APIRouter(prefix="/api", tags=["retrospectives"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _get_project_or_404(db: Session, project_id: UUID) -> Project:
    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise AppError(404, "not_found", "项目不存在")
    return project


def _get_retro_or_404(db: Session, retro_id: UUID, project_id: UUID) -> Retrospective:
    retro = db.scalar(
        select(Retrospective).where(
            Retrospective.id == retro_id, Retrospective.project_id == project_id
        )
    )
    if retro is None:
        raise AppError(404, "not_found", "复盘不存在")
    return retro


def _get_item_or_404(db: Session, item_id: UUID, retro_id: UUID, project_id: UUID) -> RetroActionItem:
    item = db.scalar(
        select(RetroActionItem).where(
            RetroActionItem.id == item_id,
            RetroActionItem.retro_id == retro_id,
            RetroActionItem.project_id == project_id,
        )
    )
    if item is None:
        raise AppError(404, "not_found", "行动项不存在")
    return item


# ---------- 复盘 CRUD ----------


@router.get("/projects/{project_id}/retrospectives", response_model=list[RetrospectiveRead])
def list_retrospectives(project_id: UUID, db: Session = Depends(get_db)) -> list:
    _get_project_or_404(db, project_id)
    return list(
        db.scalars(
            select(Retrospective)
            .where(Retrospective.project_id == project_id)
            .order_by(Retrospective.occurred_on.desc(), Retrospective.created_at)
        ).all()
    )


@router.post(
    "/projects/{project_id}/retrospectives",
    status_code=201,
    response_model=RetrospectiveRead,
)
def create_retrospective(
    project_id: UUID, payload: RetrospectiveCreate, db: Session = Depends(get_db)
) -> Retrospective:
    _get_project_or_404(db, project_id)
    retro = Retrospective(
        project_id=project_id,
        title=payload.title,
        scope=payload.scope.value,
        occurred_on=payload.occurred_on,
        facilitator=payload.facilitator,
        participants=list(payload.participants) if payload.participants else None,
        summary=payload.summary,
        atmosphere=payload.atmosphere,
        status=payload.status.value,
        created_at=_utcnow(),
        updated_at=_utcnow(),
    )
    db.add(retro)
    db.flush()
    audit.record(db, project_id, "retrospective", retro.id, "create", f"创建复盘：{retro.title}")
    db.commit()
    db.refresh(retro)
    return retro


@router.get(
    "/projects/{project_id}/retrospectives/{retro_id}",
    response_model=RetrospectiveRead,
)
def get_retrospective(
    project_id: UUID, retro_id: UUID, db: Session = Depends(get_db)
) -> Retrospective:
    return _get_retro_or_404(db, retro_id, project_id)


@router.patch(
    "/projects/{project_id}/retrospectives/{retro_id}",
    response_model=RetrospectiveRead,
)
def update_retrospective(
    project_id: UUID, retro_id: UUID, payload: RetrospectiveUpdate, db: Session = Depends(get_db)
) -> Retrospective:
    retro = _get_retro_or_404(db, retro_id, project_id)
    data = payload.model_dump(exclude_unset=True)
    if "scope" in data and data["scope"] is not None:
        data["scope"] = data["scope"].value
    if "status" in data and data["status"] is not None:
        data["status"] = data["status"].value
    for key, value in data.items():
        setattr(retro, key, value)
    retro.updated_at = _utcnow()
    db.flush()
    audit.record(db, project_id, "retrospective", retro.id, "update", f"更新复盘：{retro.title}")
    db.commit()
    db.refresh(retro)
    return retro


@router.delete("/projects/{project_id}/retrospectives/{retro_id}", status_code=204)
def delete_retrospective(project_id: UUID, retro_id: UUID, db: Session = Depends(get_db)) -> None:
    retro = _get_retro_or_404(db, retro_id, project_id)
    # 级联删除其行动项（行动项依附于复盘，复盘删除后无独立意义）
    items = list(db.scalars(select(RetroActionItem).where(RetroActionItem.retro_id == retro_id)).all())
    for item in items:
        db.delete(item)
    audit.record(db, project_id, "retrospective", retro.id, "delete", f"删除复盘：{retro.title}")
    db.delete(retro)
    db.commit()


# ---------- 行动项 CRUD ----------


@router.get(
    "/projects/{project_id}/retrospectives/{retro_id}/action-items",
    response_model=list[RetroActionItemRead],
)
def list_action_items(
    project_id: UUID, retro_id: UUID, db: Session = Depends(get_db)
) -> list:
    _get_retro_or_404(db, retro_id, project_id)
    return list(
        db.scalars(
            select(RetroActionItem)
            .where(RetroActionItem.retro_id == retro_id, RetroActionItem.project_id == project_id)
            .order_by(RetroActionItem.created_at)
        ).all()
    )


@router.post(
    "/projects/{project_id}/retrospectives/{retro_id}/action-items",
    status_code=201,
    response_model=RetroActionItemRead,
)
def create_action_item(
    project_id: UUID, retro_id: UUID, payload: RetroActionItemCreate, db: Session = Depends(get_db)
) -> RetroActionItem:
    _get_retro_or_404(db, retro_id, project_id)
    item = RetroActionItem(
        retro_id=retro_id,
        project_id=project_id,
        category=payload.category.value,
        content=payload.content,
        owner=payload.owner,
        due_date=payload.due_date,
        priority=payload.priority.value if payload.priority else None,
        status=payload.status.value,
        created_at=_utcnow(),
        updated_at=_utcnow(),
    )
    db.add(item)
    db.flush()
    audit.record(
        db, project_id, "retro_action_item", item.id, "create", f"创建行动项：{item.content[:50]}"
    )
    db.commit()
    db.refresh(item)
    return item


@router.patch(
    "/projects/{project_id}/retrospectives/{retro_id}/action-items/{item_id}",
    response_model=RetroActionItemRead,
)
def update_action_item(
    project_id: UUID, retro_id: UUID, item_id: UUID,
    payload: RetroActionItemUpdate, db: Session = Depends(get_db),
) -> RetroActionItem:
    item = _get_item_or_404(db, item_id, retro_id, project_id)
    data = payload.model_dump(exclude_unset=True)
    if "category" in data and data["category"] is not None:
        data["category"] = data["category"].value
    if "priority" in data:
        data["priority"] = data["priority"].value if data["priority"] else None
    if "status" in data and data["status"] is not None:
        data["status"] = data["status"].value
    if "link_type" in data:
        data["link_type"] = data["link_type"].value if data["link_type"] else None
    for key, value in data.items():
        setattr(item, key, value)
    item.updated_at = _utcnow()
    db.flush()
    audit.record(
        db, project_id, "retro_action_item", item.id, "update", f"更新行动项：{item.content[:50]}"
    )
    db.commit()
    db.refresh(item)
    return item


@router.post(
    "/projects/{project_id}/retrospectives/{retro_id}/action-items/{item_id}/convert",
    response_model=RetroConvertResult,
)
def convert_action_item(
    project_id: UUID,
    retro_id: UUID,
    item_id: UUID,
    payload: RetroConvertRequest,
    db: Session = Depends(get_db),
) -> dict:
    """行动项回写为 task/risk/issue：在事务内新建对应实体并回写 action_item。

    回写后原 action_item 保留（converted=True, converted_id/link_type/link_id 记录新实体），
    可追溯。复用 wbs_service 建任务的 wbs_code 逻辑与 risk_score 评分引擎。
    传承截止日期（due_date）至任务计划结束或问题要求解决期限。
    """
    item = _get_item_or_404(db, item_id, retro_id, project_id)

    target = payload.target
    new_entity: object
    new_id: UUID

    if target == RetroLinkType.TASK:
        task = Task(
            project_id=project_id,
            wbs_code=str(uuid.uuid4()),  # 占位唯一，提交后 recompute 重算真实编码
            name=item.content[:200],
            owner=item.owner,
            plan_end=item.due_date,  # 传承截止时间至计划结束日
            status="未开始",
            priority=item.priority,
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
        db.add(task)
        db.flush()
        # 复用 wbs 编码逻辑（与风险转任务一致）
        wbs_service.recompute_codes(db, project_id)
        audit.record(
            db, project_id, "task", task.id, "convert_from_retro",
            f"复盘行动项转任务：{item.content[:50]}",
        )
        new_entity = task
        new_id = task.id
    elif target == RetroLinkType.RISK:
        risk = Risk(
            project_id=project_id,
            description=item.content,
            owner=item.owner,
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
        score, level = risk_score.evaluate(db, risk.probability, risk.impact)
        risk.score, risk.level = score, level
        db.add(risk)
        db.flush()
        audit.record(
            db, project_id, "risk", risk.id, "convert_from_retro",
            f"复盘行动项转风险：{item.content[:50]}",
        )
        new_entity = risk
        new_id = risk.id
    else:  # issue
        p_val = (item.priority or "").lower()
        severity = {"low": "低", "medium": "中", "high": "高"}.get(p_val, None)
        issue = Issue(
            project_id=project_id,
            title=item.content[:200],
            detail=item.content,
            owner=item.owner,
            due_date=item.due_date,  # 传承解决期限
            severity=severity or None,
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
        db.add(issue)
        db.flush()
        audit.record(
            db, project_id, "issue", issue.id, "convert_from_retro",
            f"复盘行动项转问题：{item.content[:50]}",
        )
        new_entity = issue
        new_id = issue.id

    # 回写 action_item（原项保留）
    item.converted = True
    item.converted_id = new_id
    item.link_type = target.value
    item.link_id = new_id
    item.updated_at = _utcnow()
    db.flush()
    audit.record(
        db, project_id, "retro_action_item", item.id, "converted",
        f"行动项回写为{target.value}：{item.content[:50]}",
    )
    db.commit()
    db.refresh(item)

    entity_dict = _entity_to_dict(target, new_entity)
    return {
        "action_item": RetroActionItemRead.model_validate(item),
        "entity": entity_dict,
        "entity_type": target,
    }


def _entity_to_dict(target: RetroLinkType, entity: object) -> dict:
    """把新建实体序列化为可返回字典（与对应 Read schema 字段一致）。"""
    if target == RetroLinkType.TASK:
        task = entity  # type: ignore[assignment]
        return {
            "id": str(task.id),
            "project_id": str(task.project_id),
            "wbs_code": task.wbs_code,
            "name": task.name,
            "owner": task.owner,
            "status": task.status,
            "priority": task.priority,
            "progress": float(task.progress or 0),
            "plan_end": task.plan_end.isoformat() if task.plan_end else None,
        }
    if target == RetroLinkType.RISK:
        risk = entity  # type: ignore[assignment]
        return {
            "id": str(risk.id),
            "project_id": str(risk.project_id),
            "description": risk.description,
            "owner": risk.owner,
            "level": risk.level,
            "score": risk.score,
            "status": risk.status,
        }
    issue = entity  # type: ignore[assignment]
    return {
        "id": str(issue.id),
        "project_id": str(issue.project_id),
        "title": issue.title,
        "detail": issue.detail,
        "owner": issue.owner,
        "severity": issue.severity,
        "status": issue.status,
        "due_date": issue.due_date.isoformat() if issue.due_date else None,
    }
