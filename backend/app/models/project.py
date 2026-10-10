"""项目档案模型（01 文档 FR-P0-01 / 04 文档 3.1 + 会话 1 增补 deleted_at 软删除）。"""
import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Project(TimestampMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("code", name="uq_projects_code"),
        CheckConstraint(
            "plan_end IS NULL OR plan_start IS NULL OR plan_end >= plan_start",
            name="ck_projects_plan_dates",
        ),
        CheckConstraint(
            "actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start",
            name="ck_projects_actual_dates",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    customer: Mapped[str | None] = mapped_column(String(200), nullable=True)
    manager: Mapped[str | None] = mapped_column(String(100), nullable=True)
    phase: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    plan_start: Mapped[date | None] = mapped_column(Date(), nullable=True)
    plan_end: Mapped[date | None] = mapped_column(Date(), nullable=True)
    actual_start: Mapped[date | None] = mapped_column(Date(), nullable=True)
    actual_end: Mapped[date | None] = mapped_column(Date(), nullable=True)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)
    work_calendar_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
