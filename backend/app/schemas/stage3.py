"""风险 / 变更 / 干系人 / 沟通 / 审计 的请求响应模型。"""
from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class RiskBase(BaseModel):
    category: str | None = Field(default=None, max_length=40)
    description: str = Field(min_length=1)
    probability: int = Field(default=1, ge=1, le=5)
    impact: int = Field(default=1, ge=1, le=5)
    owner: str | None = Field(default=None, max_length=100)
    trigger_condition: str | None = None
    prevention: str | None = None
    contingency: str | None = None
    strategy: str | None = Field(default=None, max_length=20)
    residual_level: str | None = Field(default=None, max_length=10)


class RiskCreate(RiskBase):
    pass


class RiskUpdate(BaseModel):
    category: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, min_length=1)
    probability: int | None = Field(default=None, ge=1, le=5)
    impact: int | None = Field(default=None, ge=1, le=5)
    owner: str | None = Field(default=None, max_length=100)
    trigger_condition: str | None = None
    prevention: str | None = None
    contingency: str | None = None
    strategy: str | None = Field(default=None, max_length=20)
    residual_level: str | None = Field(default=None, max_length=10)
    status: str | None = Field(default=None, max_length=30)


class RiskRead(RiskBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    score: int
    level: str | None
    status: str
    created_at: datetime
    updated_at: datetime


class RiskAssessmentCreate(BaseModel):
    probability: int = Field(ge=1, le=5)
    impact: int = Field(ge=1, le=5)
    basis: str | None = None


class RiskAssessmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    risk_id: UUID
    probability: int
    impact: int
    score: int
    level: str | None
    assessed_at: datetime
    basis: str | None


class RiskConvertRequest(BaseModel):
    target: str = Field(pattern="^(issue|task)$")
    task_name: str | None = Field(default=None, max_length=200)
    task_owner: str | None = Field(default=None, max_length=100)


class IssueBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    detail: str | None = None
    severity: str | None = Field(default=None, max_length=20)
    owner: str | None = Field(default=None, max_length=100)
    due_date: date | None = None
    root_cause: str | None = None
    solution: str | None = None
    verified_by: str | None = Field(default=None, max_length=100)
    status: str | None = Field(default=None, max_length=20)


class IssueCreate(IssueBase):
    risk_id: UUID | None = None


class IssueUpdate(IssueBase):
    verified_at: datetime | None = None
    closure_result: str | None = None


class IssueClose(BaseModel):
    closure_result: str = Field(min_length=1, description="关闭结论（必填）")
    verified_at: datetime | None = None
    verified_by: str | None = Field(default=None, max_length=100)


class IssueRead(IssueBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    risk_id: UUID | None
    verified_at: datetime | None
    closure_result: str | None
    created_at: datetime
    updated_at: datetime


class ChangeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    origin: str | None = None
    scope_impact: str | None = None
    schedule_impact: str | None = None
    approval_status: str | None = Field(default=None, max_length=20)
    implementation_plan: str | None = None
    verification_result: str | None = None
    requested_by: str | None = Field(default=None, max_length=100)


class ChangeUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    origin: str | None = None
    scope_impact: str | None = None
    schedule_impact: str | None = None
    approval_status: str | None = Field(default=None, max_length=20)
    implementation_plan: str | None = None
    verification_result: str | None = None
    requested_by: str | None = Field(default=None, max_length=100)


class ChangeRead(ChangeCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: datetime


class StakeholderBase(BaseModel):
    person_type: str = Field(default="person", max_length=10)
    name: str = Field(min_length=1, max_length=100)
    org: str | None = Field(default=None, max_length=200)
    role: str | None = Field(default=None, max_length=100)
    influence: int = Field(default=3, ge=1, le=5)
    interest: int = Field(default=3, ge=1, le=5)
    demands: str | None = None
    strategy: str | None = None
    comm_frequency: str | None = Field(default=None, max_length=30)


class StakeholderCreate(StakeholderBase):
    pass


class StakeholderUpdate(BaseModel):
    person_type: str | None = Field(default=None, max_length=10)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    org: str | None = Field(default=None, max_length=200)
    role: str | None = Field(default=None, max_length=100)
    influence: int | None = Field(default=None, ge=1, le=5)
    interest: int | None = Field(default=None, ge=1, le=5)
    demands: str | None = None
    strategy: str | None = None
    comm_frequency: str | None = Field(default=None, max_length=30)


class StakeholderRead(StakeholderBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: datetime


class CommunicationCreate(BaseModel):
    comm_date: date | None = None
    channel: str | None = Field(default=None, max_length=30)
    content: str | None = None
    conclusion: str | None = None
    follow_up_action: str | None = None
    follow_up_date: date | None = None


class CommunicationRead(CommunicationCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    stakeholder_id: UUID
    created_at: datetime


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID | None
    object_type: str
    object_id: UUID | None
    action: str
    summary: str
    payload_diff: dict[str, Any] | None
    operator: str
    occurred_at: datetime