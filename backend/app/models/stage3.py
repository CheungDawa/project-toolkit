"""阶段 3 模型：风险 / 风险评估 / 问题 / 变更 / 干系人 / 沟通 / 审计（04 文档 3.8~3.19）。"""
import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Risk(TimestampMixin, Base):
    """风险台账（FR-P0-12）。风险与问题分离（BR-04）：转化后原记录保留。"""

    __tablename__ = "risks"
    __table_args__ = (
        CheckConstraint("probability BETWEEN 1 AND 5", name="ck_risks_probability"),
        CheckConstraint("impact BETWEEN 1 AND 5", name="ck_risks_impact"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("projects.id"), nullable=False, index=True
    )
    category: Mapped[str | None] = mapped_column(String(40), nullable=True)
    description: Mapped[str] = mapped_column(Text(), nullable=False)
    probability: Mapped[int] = mapped_column(Integer(), nullable=False, default=1)
    impact: Mapped[int] = mapped_column(Integer(), nullable=False, default=1)
    score: Mapped[int] = mapped_column(Integer(), nullable=False, default=1)
    level: Mapped[str | None] = mapped_column(String(10), nullable=True)
    owner: Mapped[str | None] = mapped_column(String(100), nullable=True)
    trigger_condition: Mapped[str | None] = mapped_column(Text(), nullable=True)
    prevention: Mapped[str | None] = mapped_column(Text(), nullable=True)
    contingency: Mapped[str | None] = mapped_column(Text(), nullable=True)
    strategy: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="未决")
    residual_level: Mapped[str | None] = mapped_column(String(10), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RiskAssessment(Base):
    """历次风险评估（追加型，历史不可改——DM-5）。"""

    __tablename__ = "risk_assessments"
    __table_args__ = (
        CheckConstraint("probability BETWEEN 1 AND 5", name="ck_assessments_probability"),
        CheckConstraint("impact BETWEEN 1 AND 5", name="ck_assessments_impact"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    risk_id: Mapped[uuid.UUID] = mapped_column(Uuid(), ForeignKey("risks.id"), nullable=False, index=True)
    probability: Mapped[int] = mapped_column(Integer(), nullable=False)
    impact: Mapped[int] = mapped_column(Integer(), nullable=False)
    score: Mapped[int] = mapped_column(Integer(), nullable=False)
    level: Mapped[str | None] = mapped_column(String(10), nullable=True)
    assessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    basis: Mapped[str | None] = mapped_column(Text(), nullable=True)


class Issue(TimestampMixin, Base):
    """问题台账（FR-P0-15）。关闭必须填写解决结果。"""

    __tablename__ = "issues"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("projects.id"), nullable=False, index=True
    )
    risk_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(), ForeignKey("risks.id"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text(), nullable=True)
    severity: Mapped[str | None] = mapped_column(String(20), nullable=True)
    owner: Mapped[str | None] = mapped_column(String(100), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    root_cause: Mapped[str | None] = mapped_column(Text(), nullable=True)
    solution: Mapped[str | None] = mapped_column(Text(), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verified_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    closure_result: Mapped[str | None] = mapped_column(Text(), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="待处理")


class ChangeRequest(TimestampMixin, Base):
    """变更跟踪（FR-P0-17）。"""

    __tablename__ = "change_requests"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("projects.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    origin: Mapped[str | None] = mapped_column(Text(), nullable=True)
    scope_impact: Mapped[str | None] = mapped_column(Text(), nullable=True)
    schedule_impact: Mapped[str | None] = mapped_column(Text(), nullable=True)
    approval_status: Mapped[str] = mapped_column(String(20), nullable=False, default="草拟")
    implementation_plan: Mapped[str | None] = mapped_column(Text(), nullable=True)
    verification_result: Mapped[str | None] = mapped_column(Text(), nullable=True)
    requested_by: Mapped[str | None] = mapped_column(String(100), nullable=True)


class Stakeholder(TimestampMixin, Base):
    """干系人登记（FR-P1-01）。"""

    __tablename__ = "stakeholders"
    __table_args__ = (
        CheckConstraint("influence BETWEEN 1 AND 5", name="ck_stakeholders_influence"),
        CheckConstraint("interest BETWEEN 1 AND 5", name="ck_stakeholders_interest"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("projects.id"), nullable=False, index=True
    )
    person_type: Mapped[str] = mapped_column(String(10), nullable=False, default="person")
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    org: Mapped[str | None] = mapped_column(String(200), nullable=True)
    role: Mapped[str | None] = mapped_column(String(100), nullable=True)
    influence: Mapped[int] = mapped_column(Integer(), nullable=False, default=3)
    interest: Mapped[int] = mapped_column(Integer(), nullable=False, default=3)
    demands: Mapped[str | None] = mapped_column(Text(), nullable=True)
    strategy: Mapped[str | None] = mapped_column(Text(), nullable=True)
    comm_frequency: Mapped[str | None] = mapped_column(String(30), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    contact_wechat: Mapped[str | None] = mapped_column(String(80), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(120), nullable=True)
    priority: Mapped[str | None] = mapped_column(String(10), nullable=True)
    participation: Mapped[str | None] = mapped_column(String(80), nullable=True)
    sub_pos: Mapped[str | None] = mapped_column(String(60), nullable=True)


class StakeholderCommunication(TimestampMixin, Base):
    """干系人沟通历史（FR-P1-02）。"""

    __tablename__ = "stakeholder_communications"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    stakeholder_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(), ForeignKey("stakeholders.id"), nullable=False, index=True
    )
    comm_date: Mapped[date | None] = mapped_column(Date(), nullable=True)
    channel: Mapped[str | None] = mapped_column(String(30), nullable=True)
    content: Mapped[str | None] = mapped_column(Text(), nullable=True)
    conclusion: Mapped[str | None] = mapped_column(Text(), nullable=True)
    follow_up_action: Mapped[str | None] = mapped_column(Text(), nullable=True)
    follow_up_date: Mapped[date | None] = mapped_column(Date(), nullable=True)


class ActivityLog(Base):
    """审计日志（FR 阶段3通用要求；TD-02 人工校正留痕）。"""

    __tablename__ = "activity_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(), ForeignKey("projects.id"), nullable=True, index=True
    )
    object_type: Mapped[str] = mapped_column(String(40), nullable=False)
    object_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(), nullable=True)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    summary: Mapped[str] = mapped_column(Text(), nullable=False)
    payload_diff: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    operator: Mapped[str] = mapped_column(String(100), nullable=False, default="owner")
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)