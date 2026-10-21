"""复盘模块模型（项目级复盘 + 行动项；行动项可回写为任务/风险/问题）。"""
import uuid
from datetime import date

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    JSON,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Retrospective(TimestampMixin, Base):
    """项目级复盘记录（FR-复盘：phase/milestone/sprint/whole 四种范围）。"""

    __tablename__ = "retrospectives"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("projects.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False, default="whole")
    occurred_on: Mapped[date] = mapped_column(Date(), nullable=False)
    facilitator: Mapped[str | None] = mapped_column(String(100), nullable=True)
    participants: Mapped[list | None] = mapped_column(JSON, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text(), nullable=True)
    atmosphere: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")


class RetroActionItem(TimestampMixin, Base):
    """复盘行动项（good/improve/action）。可回写为任务/风险/问题，回写后原项保留可追溯。"""

    __tablename__ = "retro_action_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    retro_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("retrospectives.id"), nullable=False, index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("projects.id"), nullable=False, index=True
    )
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text(), nullable=False)
    owner: Mapped[str | None] = mapped_column(String(100), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    priority: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    # 回写关联：link_type ∈ {task, risk, issue}，回写后 converted=True 并记录新实体 id
    link_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    link_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(), nullable=True)
    converted: Mapped[bool] = mapped_column(Boolean(), nullable=False, default=False)
    converted_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(), nullable=True)
