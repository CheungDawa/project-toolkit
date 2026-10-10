"""阶段 2 模型：任务 / 依赖 / 里程碑 / 基线（04 文档 3.2~3.6）。"""
import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Task(TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint("project_id", "wbs_code", name="uq_tasks_project_wbs"),
        CheckConstraint("progress >= 0 AND progress <= 100", name="ck_tasks_progress_range"),
        CheckConstraint(
            "plan_end IS NULL OR plan_start IS NULL OR plan_end >= plan_start",
            name="ck_tasks_plan_dates",
        ),
        CheckConstraint(
            "actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start",
            name="ck_tasks_actual_dates",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("projects.id"), nullable=False, index=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(), ForeignKey("tasks.id"), nullable=True, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer(), nullable=False, default=0)
    wbs_code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    owner: Mapped[str | None] = mapped_column(String(100), nullable=True)
    collaborators: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    plan_start: Mapped[date | None] = mapped_column(Date(), nullable=True)
    plan_end: Mapped[date | None] = mapped_column(Date(), nullable=True)
    actual_start: Mapped[date | None] = mapped_column(Date(), nullable=True)
    actual_end: Mapped[date | None] = mapped_column(Date(), nullable=True)
    duration_days: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    work_hours: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    progress: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="未开始")
    priority: Mapped[str | None] = mapped_column(String(20), nullable=True)
    acceptance_criteria: Mapped[str | None] = mapped_column(Text(), nullable=True)
    deliverable_name: Mapped[str | None] = mapped_column(Text(), nullable=True)
    progress_source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    risk_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(), ForeignKey("risks.id"), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TaskDependency(Base):
    __tablename__ = "task_dependencies"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "predecessor_id", "successor_id", "dep_type",
            name="uq_deps_project_pair",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("projects.id"), nullable=False, index=True
    )
    predecessor_id: Mapped[uuid.UUID] = mapped_column(Uuid(), ForeignKey("tasks.id"), nullable=False)
    successor_id: Mapped[uuid.UUID] = mapped_column(Uuid(), ForeignKey("tasks.id"), nullable=False)
    dep_type: Mapped[str] = mapped_column(String(10), nullable=False, default="FS")
    lag_days: Mapped[int] = mapped_column(Integer(), nullable=False, default=0)


class Milestone(TimestampMixin, Base):
    __tablename__ = "milestones"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("projects.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    plan_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    actual_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)


class ScheduleBaseline(TimestampMixin, Base):
    __tablename__ = "schedule_baselines"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("projects.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[int] = mapped_column(Integer(), nullable=False, default=1)
    frozen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    note: Mapped[str | None] = mapped_column(Text(), nullable=True)


class BaselineTaskSnapshot(Base):
    """基线冻结时的任务计划快照（只追加，禁止 UPDATE——BR-02）。"""

    __tablename__ = "baseline_task_snapshots"
    __table_args__ = (
        UniqueConstraint("baseline_id", "task_id", name="uq_baseline_task"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    baseline_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("schedule_baselines.id"), nullable=False, index=True
    )
    task_id: Mapped[uuid.UUID] = mapped_column(Uuid(), ForeignKey("tasks.id"), nullable=False)
    level: Mapped[int] = mapped_column(Integer(), nullable=False, default=1)
    wbs_code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer(), nullable=False, default=0)
    plan_start: Mapped[date | None] = mapped_column(Date(), nullable=True)
    plan_end: Mapped[date | None] = mapped_column(Date(), nullable=True)
    duration_days: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    work_hours: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    progress: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)