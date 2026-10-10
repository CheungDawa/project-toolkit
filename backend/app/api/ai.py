"""AI 能力 API：状态/会话/建议中心/六项能力（T4-02~T4-11）。"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.models.ai import AiActionProposal, AiConversation, AiMessage
from app.schemas.ai import (
    AiConversationCreate,
    AiConversationRead,
    AiMessageRead,
    AiProposalRead,
    AiChatRequest,
    AiProposalAccept,
)
from app.services.ai import context as ai_context
from app.services.ai import parser as ai_parser
from app.services.ai import proposals as ai_proposals
from app.services.ai import provider as ai_provider

router = APIRouter(prefix="/api/ai", tags=["ai"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _require_config(db: Session) -> None:
    if not ai_provider.is_configured(db):
        raise AppError(
            422, "model_not_configured",
            "尚未配置 AI 模型服务：请到「系统设置」填写 base_url/model/api_key",
        )


def _call(db: Session, messages: list[dict], temperature: float = 0.0) -> tuple[str, int, str]:
    """调用模型并把服务错误转成统一业务错误。"""
    try:
        return ai_provider.call_model(db, messages, temperature)
    except ai_provider.ModelNotConfigured:
        raise AppError(422, "model_not_configured", "尚未配置 AI 模型服务：请到「系统设置」填写配置") from None
    except ai_provider.ModelCallError as exc:
        raise AppError(422, exc.code, exc.message) from None


# ---------- 状态 ----------

@router.get("/status")
def ai_status(db: Session = Depends(get_db)) -> dict:
    return {
        "configured": ai_provider.is_configured(db),
        "config": ai_provider.safe_config_summary(db),
    }


class AiTestRequest(BaseModel):
    value: dict


@router.post("/test")
def ai_test(payload: AiTestRequest, db: Session = Depends(get_db)) -> dict:
    """连接测试：用传入配置发起一次最小调用，不持久化（T4-03）。"""
    value = payload.value or {}
    if not value.get("base_url") or not value.get("model"):
        raise AppError(422, "invalid_config", "请填写 base_url 与 model")
    config = ai_provider.ModelConfig(
        provider=str(value.get("provider", "openai")),
        base_url=str(value["base_url"]),
        model=str(value["model"]),
        api_key=str(value.get("api_key", "")),
        timeout=int(value.get("timeout", 30)),
    )
    try:
        ai_provider._chat_once(config, [{"role": "user", "content": "ping"}], 0.0)
    except ai_provider.ModelCallError as exc:
        raise AppError(422, exc.code, exc.message) from None
    return {"ok": True, "message": "连接成功"}


# ---------- 会话 ----------

@router.post("/conversations", status_code=201, response_model=AiConversationRead)
def create_conversation(payload: AiConversationCreate, db: Session = Depends(get_db)) -> AiConversation:
    conv = AiConversation(
        project_id=payload.project_id,
        title=payload.title or "新对话",
        model_setting_key="model.default",
        created_at=_utcnow(),
        updated_at=_utcnow(),
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


@router.get("/conversations", response_model=list[AiConversationRead])
def list_conversations(project_id: UUID | None = None, db: Session = Depends(get_db)) -> list:
    stmt = select(AiConversation)
    if project_id is not None:
        stmt = stmt.where(AiConversation.project_id == project_id)
    return list(db.scalars(stmt.order_by(AiConversation.created_at.desc())).all())


@router.get("/conversations/{conversation_id}/messages", response_model=list[AiMessageRead])
def list_messages(conversation_id: UUID, db: Session = Depends(get_db)) -> list:
    _get_conv(db, conversation_id)
    return list(
        db.scalars(
            select(AiMessage)
            .where(AiMessage.conversation_id == conversation_id)
            .order_by(AiMessage.created_at)
        ).all()
    )


@router.post("/conversations/{conversation_id}/messages", response_model=AiMessageRead)
def chat(conversation_id: UUID, payload: AiChatRequest, db: Session = Depends(get_db)) -> AiMessage:
    conv = _get_conv(db, conversation_id)
    _require_config(db)
    user_message = AiMessage(
        conversation_id=conversation_id,
        role="user",
        content=payload.content,
        call_status="succeeded",
        created_at=_utcnow(),
    )
    db.add(user_message)
    db.flush()

    context_text, fields = ai_context.capability_context(db, conv.project_id, "qa")
    system = ai_context.QA_SYSTEM
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"项目上下文：\n{context_text}\n\n问题：{payload.content}"},
    ]
    err = ""
    try:
        content, usage, model = _call(db, messages)
        status = "succeeded"
    except AppError as exc:
        content = ""
        usage = 0
        model = None
        status = exc.code
        err = exc.message
    assistant = AiMessage(
        conversation_id=conversation_id,
        role="assistant",
        content=content,
        call_status=status,
        model_identifier=model,
        context_digest=ai_parser.build_context_digest(conv.project_id, "qa", fields) if conv.project_id else None,
        token_usage=usage,
        error_message=err if status != "succeeded" else None,
        created_at=_utcnow(),
    )
    db.add(assistant)
    db.commit()
    db.refresh(assistant)
    return assistant


def _get_conv(db: Session, conversation_id: UUID) -> AiConversation:
    conv = db.scalar(select(AiConversation).where(AiConversation.id == conversation_id))
    if conv is None:
        raise AppError(404, "not_found", "对话不存在")
    return conv


# ---------- 建议中心 ----------

@router.get("/proposals", response_model=list[AiProposalRead])
def list_proposals(project_id: UUID | None = None, status: str | None = None, db: Session = Depends(get_db)) -> list:
    return ai_proposals.list_proposals(db, project_id, status)


@router.post("/proposals/{proposal_id}/accept", response_model=AiProposalRead)
def accept_proposal(proposal_id: UUID, payload: AiProposalAccept, db: Session = Depends(get_db)) -> AiActionProposal:
    return ai_proposals.accept_proposal(db, proposal_id, actor="owner", confirm=payload.confirm)


@router.post("/proposals/{proposal_id}/reject", response_model=AiProposalRead)
def reject_proposal(proposal_id: UUID, db: Session = Depends(get_db)) -> AiActionProposal:
    return ai_proposals.reject_proposal(db, proposal_id)


# ---------- 能力调用 ----------

@router.post("/projects/{project_id}/wbs-draft", status_code=201, response_model=AiProposalRead)
def wbs_draft(project_id: UUID, description: str | None = None, db: Session = Depends(get_db)) -> AiActionProposal:
    _require_config(db)
    context_text, fields = ai_context.capability_context(db, project_id, "wbs")
    if description:
        context_text += f"\n用户补充要求：{description}"
    messages = [
        {"role": "system", "content": ai_context.WBS_DRAFT_SYSTEM},
        {"role": "user", "content": context_text},
    ]
    content, usage, model = _call(db, messages)
    try:
        data = ai_parser.extract_json(content)
        tasks = ai_parser.validate_wbs_draft(data)
    except ai_parser.AIParseError:
        raise AppError(422, "format_error", "AI 生成的 WBS 初稿无法通过校验，请重试") from None

    diff = {"add": tasks, "modify": [], "delete": []}
    proposal = ai_proposals.create_proposal(
        db, project_id, "wbs_draft", {"tasks": tasks}, diff
    )
    _record_ai_message(db, project_id, "assistant", content, "succeeded", model, fields)
    db.commit()
    db.refresh(proposal)
    return proposal


@router.post("/projects/{project_id}/schedule-check")
def schedule_check(project_id: UUID, db: Session = Depends(get_db)) -> dict:
    _require_config(db)
    context_text, fields = ai_context.capability_context(db, project_id, "schedule")
    messages = [
        {"role": "system", "content": ai_context.SCHEDULE_CHECK_SYSTEM},
        {"role": "user", "content": f"项目任务与依赖：\n{context_text}"},
    ]
    content, usage, model = _call(db, messages)
    _record_ai_message(db, project_id, "assistant", content, "succeeded", model, fields)
    return {"content": content, "model": model, "usage": usage}


@router.post("/projects/{project_id}/risk-advice")
def risk_advice(project_id: UUID, db: Session = Depends(get_db)) -> dict:
    _require_config(db)
    context_text, fields = ai_context.capability_context(db, project_id, "risk")
    messages = [
        {"role": "system", "content": ai_context.RISK_ADVICE_SYSTEM},
        {"role": "user", "content": context_text},
    ]
    content, usage, model = _call(db, messages)
    _record_ai_message(db, project_id, "assistant", content, "succeeded", model, fields)
    return {"content": content, "model": model, "usage": usage}


@router.post("/projects/{project_id}/weekly-report")
def weekly_report(project_id: UUID, db: Session = Depends(get_db)) -> dict:
    _require_config(db)
    context_text, fields = ai_context.capability_context(db, project_id, "report")
    meta = ai_context.weekly_report_meta()
    messages = [
        {"role": "system", "content": ai_context.WEEKLY_REPORT_SYSTEM},
        {"role": "user", "content": f"{meta}\n\n项目数据：\n{context_text}"},
    ]
    content, usage, model = _call(db, messages)
    _record_ai_message(db, project_id, "assistant", content, "succeeded", model, fields)
    return {"content": content, "meta": meta, "model": model, "usage": usage}


@router.post("/projects/{project_id}/ask")
def ask(project_id: UUID, payload: AiChatRequest, db: Session = Depends(get_db)) -> dict:
    _require_config(db)
    context_text, fields = ai_context.capability_context(db, project_id, "qa")
    messages = [
        {"role": "system", "content": ai_context.QA_SYSTEM},
        {"role": "user", "content": f"项目上下文：\n{context_text}\n\n问题：{payload.content}"},
    ]
    content, usage, model = _call(db, messages)
    _record_ai_message(db, project_id, "assistant", content, "succeeded", model, fields)
    return {"content": content, "model": model, "usage": usage}


@router.post("/projects/{project_id}/deliverable-check")
def deliverable_check(project_id: UUID, db: Session = Depends(get_db)) -> dict:
    """AI-5：交付清单缺失检查（依赖阶段 5 交付资料模块）。"""
    _require_config(db)
    from sqlalchemy import select as sa_select
    from app.models.stage5 import Deliverable
    from app.services.ai.context import _fmt_date as _fmt

    items = list(db.scalars(sa_select(Deliverable).where(Deliverable.project_id == project_id)))
    lines = []
    for idx, item in enumerate(items, start=1):
        lines.append(
            f"- {idx} [{item.category or '-'}] {item.name}（提交:{item.submit_status} 审核:{item.review_status} "
            f"期限:{_fmt(item.plan_date)} 责任人:{item.owner or '-'}）"
        )
    context_text = "\n".join(lines) or "（暂无交付资料条目）"
    system = (
        "你是项目交付资料检查助手。基于交付清单（含提交/审核状态），指出缺失项、即将逾期项与补齐全建议。"
        "逐条引用条目序号。仅使用给定数据，缺失标注信息不足。用中文。"
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"交付清单：\n{context_text}"},
    ]
    content, usage, model = _call(db, messages)
    _record_ai_message(db, project_id, "assistant", content, "succeeded", model, ["deliverables.*"])
    return {"content": content, "model": model, "usage": usage}


def _record_ai_message(db, project_id, role, content, status, model, fields) -> None:
    conv = AiConversation(project_id=project_id, title="AI 能力调用", created_at=_utcnow(), updated_at=_utcnow())
    db.add(conv)
    db.flush()
    db.add(
        AiMessage(
            conversation_id=conv.id,
            role=role,
            content=content,
            call_status=status,
            model_identifier=model,
            context_digest=ai_parser.build_context_digest(project_id, "capability", fields) if project_id else None,
            created_at=_utcnow(),
        )
    )