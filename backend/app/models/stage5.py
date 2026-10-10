"""阶段 5 模型：进度快照 / 交付资料 / 附件（04 文档 3.7 / 3.14 / 3.15）。"""
import uuid
from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ProgressSnapshot(Base):
    """进度快照（BR-03：燃尽图唯一数据源，追加型；同一天同一 scope 只保留一条最新值）。"""

    __tablename__ = "task_progress_snapshots"
    __table_args__ = (
        UniqueConstraint("project_id", "scope", "snapshot_date", name="uq_snapshot_project_scope_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("projects.id"), nullable=False, index=True
    )
    task_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(), ForeignKey("tasks.id"), nullable=True)
    scope: Mapped[str] = mapped_column(String(10), nullable=False, default="project")
    snapshot_date: Mapped[date] = mapped_column(Date(), nullable=False)
    total_tasks: Mapped[int] = mapped_column(Integer(), nullable=False, default=0)
    completed_tasks: Mapped[int] = mapped_column(Integer(), nullable=False, default=0)
    remaining_tasks: Mapped[int] = mapped_column(Integer(), nullable=False, default=0)
    total_hours: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    remaining_hours: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Deliverable(TimestampMixin, Base):
    """交付资料条目（FR-P1-05）。"""

    __tablename__ = "deliverables"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("projects.id"), nullable=False, index=True
    )
    template_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    category: Mapped[str | None] = mapped_column(String(40), nullable=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    owner: Mapped[str | None] = mapped_column(String(100), nullable=True)
    plan_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    submit_status: Mapped[str] = mapped_column(String(30), nullable=False, default="未提交")
    review_status: Mapped[str] = mapped_column(String(30), nullable=False, default="待审核")
    note: Mapped[str | None] = mapped_column(Text(), nullable=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(), ForeignKey("tasks.id"), nullable=True
    )


class Attachment(Base):
    """附件（多态关联，04 文档 DM-6/7）。"""

    __tablename__ = "attachments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    object_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    object_id: Mapped[uuid.UUID] = mapped_column(Uuid(), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(Text(), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer(), nullable=False, default=0)
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)