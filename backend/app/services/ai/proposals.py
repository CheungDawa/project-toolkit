"""AI 建议暂存与确认（T4-05/T4-06；BR-05 唯一写入路径 = 用户接受）。"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.ai import AiActionProposal, AiMessage
from app.models.task import Task
from app.services import audit as audit_service
from app.services import wbs as wbs_service

HIGH_IMPACT_ACTIONS = {"bulk_reschedule", "delete_tasks"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def create_proposal(
    db: Session,
    project_id: UUID,
    action_type: str,
    payload: dict,
    diff_preview: dict | None,
    message_id: UUID | None = None,
) -> AiActionProposal:
    proposal = AiActionProposal(
        message_id=message_id,
        project_id=project_id,
        action_type=action_type,
        payload=payload,
        diff_preview=diff_preview,
        status="pending",
        created_at=_utcnow(),
    )
    db.add(proposal)
    return proposal


def accept_proposal(db: Session, proposal_id: UUID, actor: str = "owner", confirm: bool = False) -> AiActionProposal:
    proposal = _get_proposal(db, proposal_id)
    if proposal.status != "pending":
        raise AppError(422, "not_pending", "该建议已处理")
    if proposal.action_type in HIGH_IMPACT_ACTIONS and not confirm:
        raise AppError(422, "high_impact_confirm_required", "高影响操作需二次确认", fields={"confirm": ["高影响操作需二次确认"]})

    if proposal.action_type == "wbs_draft":
        _apply_wbs_draft(db, proposal)
    elif proposal.action_type == "task_update":
        _apply_task_update(db, proposal)
    else:
        raise AppError(422, "unsupported_action", f"暂不支持的建议类型：{proposal.action_type}")

    proposal.status = "accepted"
    proposal.accepted_by = actor
    proposal.accepted_at = _utcnow()
    audit_service.record(
        db, proposal.project_id, "ai_proposal", proposal.id, "accept_ai",
        f"接受 AI 建议：{proposal.action_type}",
    )
    db.commit()
    return proposal


def reject_proposal(db: Session, proposal_id: UUID) -> AiActionProposal:
    proposal = _get_proposal(db, proposal_id)
    if proposal.status != "pending":
        raise AppError(422, "not_pending", "该建议已处理")
    proposal.status = "rejected"
    proposal.rejected_at = _utcnow()
    audit_service.record(
        db, proposal.project_id, "ai_proposal", proposal.id, "reject_ai", "拒绝 AI 建议",
    )
    db.commit()
    return proposal


def _get_proposal(db: Session, proposal_id: UUID) -> AiActionProposal:
    proposal = db.scalar(select(AiActionProposal).where(AiActionProposal.id == proposal_id))
    if proposal is None:
        raise AppError(404, "not_found", "建议不存在")
    return proposal


def _apply_wbs_draft(db: Session, proposal: AiActionProposal) -> None:
    """按 payload.tasks 创建任务树（wbs 引用父级），重算编码并审计。"""
    tasks = proposal.payload.get("tasks") or []
    if not tasks:
        raise AppError(422, "empty_draft", "WBS 初稿为空")
    by_wbs: dict[str, Task] = {}
    for item in tasks:
        parent = None
        parent_wbs = str(item.get("parent_wbs") or "").strip()
        if parent_wbs:
            parent = by_wbs.get(parent_wbs)
            if parent is None:
                raise AppError(422, "invalid_parent", f"父 WBS 不存在：{parent_wbs}")
        task = Task(
            project_id=proposal.project_id,
            parent_id=parent.id if parent else None,
            wbs_code=str(item.get("wbs") or ""),
            name=item["name"],
            owner=item.get("owner"),
            plan_start=item.get("plan_start"),
            plan_end=item.get("plan_end"),
            work_hours=item.get("work_hours"),
            progress=item.get("progress") or 0,
        )
        db.add(task)
        db.flush()
        by_wbs[str(item.get("wbs") or "")] = task
    wbs_service.recompute_codes(db, proposal.project_id)
    audit_service.record(
        db, proposal.project_id, "task", None, "ai_apply",
        f"应用 AI 生成的 WBS 初稿：{len(tasks)} 个任务",
    )


def _apply_task_update(db: Session, proposal: AiActionProposal) -> None:
    task_id = proposal.payload.get("task_id")
    if not task_id:
        raise AppError(422, "validation_draft", "缺少任务引用")
    task = db.scalar(select(Task).where(Task.id == UUID(str(task_id)), Task.deleted_at.is_(None)))
    if task is None:
        raise AppError(404, "not_found", "目标任务不存在")
    for key in ("plan_start", "plan_end", "progress", "status", "owner"):
        if key in proposal.payload:
            setattr(task, key, proposal.payload[key])
    db.flush()
    audit_service.record(db, task.project_id, "task", task.id, "ai_apply", f"应用 AI 建议更新任务：{task.name}")


def list_proposals(db: Session, project_id: UUID | None = None, status: str | None = None) -> list[AiActionProposal]:
    stmt = select(AiActionProposal)
    if project_id is not None:
        stmt = stmt.where(AiActionProposal.project_id == project_id)
    if status:
        stmt = stmt.where(AiActionProposal.status == status)
    return list(db.scalars(stmt.order_by(AiActionProposal.created_at.desc())).all())