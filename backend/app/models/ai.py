"""阶段 4 模型：AI 对话 / 消息 / 建议（04 文档 3.16~3.18；BR-05 隔离）。"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class AiConversation(TimestampMixin, Base):
    __tablename__ = "ai_conversations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(), ForeignKey("projects.id"), nullable=True, index=True
    )
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    model_setting_key: Mapped[str | None] = mapped_column(String(80), nullable=True)


class AiMessage(Base):
    __tablename__ = "ai_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("ai_conversations.id"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text(), nullable=False)
    call_status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending")
    model_identifier: Mapped[str | None] = mapped_column(String(120), nullable=True)
    context_digest: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    token_usage: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AiActionProposal(Base):
    """AI 建议（待确认）；仅 accepted 后由服务层写入业务表（BR-05）。"""

    __tablename__ = "ai_action_proposals"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(), ForeignKey("ai_messages.id"), nullable=True, index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("projects.id"), nullable=False, index=True
    )
    action_type: Mapped[str] = mapped_column(String(40), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    diff_preview: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    accepted_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)