"""任务 / 依赖 / 里程碑 / 基线 请求响应模型。"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class TaskBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    owner: str | None = Field(default=None, max_length=100)
    collaborators: list[str] = Field(default_factory=list)
    plan_start: date | None = None
    plan_end: date | None = None
    actual_start: date | None = None
    actual_end: date | None = None
    work_hours: float | None = Field(default=None, ge=0)
    progress: float = Field(default=0, ge=0, le=100)
    status: str = Field(default="未开始", max_length=30)
    priority: str | None = Field(default=None, max_length=20)
    acceptance_criteria: str | None = None
    deliverable_name: str | None = None


class TaskCreate(TaskBase):
    parent_id: UUID | None = None


class TaskUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    owner: str | None = Field(default=None, max_length=100)
    collaborators: list[str] | None = None
    plan_start: date | None = None
    plan_end: date | None = None
    actual_start: date | None = None
    actual_end: date | None = None
    work_hours: float | None = Field(default=None, ge=0)
    progress: float | None = Field(default=None, ge=0, le=100)
    status: str | None = Field(default=None, max_length=30)
    priority: str | None = Field(default=None, max_length=20)
    acceptance_criteria: str | None = None
    deliverable_name: str | None = None


class TaskBulkItem(BaseModel):
    """WBS 批量编辑的单行变更（只提交需要改的字段，未提交的字段保持原值）。"""

    id: UUID
    progress: int | None = Field(default=None, ge=0, le=100)
    status: str | None = Field(default=None, max_length=30)
    owner: str | None = Field(default=None, max_length=100)


class TaskBulkUpdate(BaseModel):
    """批量更新请求体：1~500 条，一次事务提交（P1-4）。"""

    items: list[TaskBulkItem] = Field(min_length=1, max_length=500)


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    parent_id: UUID | None
    sort_order: int
    wbs_code: str
    name: str
    owner: str | None
    collaborators: list[str] = Field(default_factory=list)
    plan_start: date | None
    plan_end: date | None
    actual_start: date | None
    actual_end: date | None
    duration_days: int | None
    work_hours: float | None
    progress: float
    effective_progress: float = 0  # 父任务汇总后的有效进度
    status: str
    priority: str | None
    acceptance_criteria: str | None
    deliverable_name: str | None
    progress_source: str
    risk_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class TaskListResponse(BaseModel):
    items: list[TaskRead]
    dependencies: list[DependencyRead]


class TaskReorder(BaseModel):
    task_id: UUID
    new_parent_id: UUID | None = None
    new_index: int = Field(default=0, ge=0)


class DependencyCreate(BaseModel):
    predecessor_id: UUID
    successor_id: UUID
    dep_type: str = Field(default="FS", pattern="^(FS|SS|FF|SF)$")
    lag_days: int = Field(default=0, ge=0)


class DependencyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    predecessor_id: UUID
    successor_id: UUID
    dep_type: str
    lag_days: int


class MilestoneBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    plan_date: date | None = None
    actual_date: date | None = None
    status: str | None = Field(default=None, max_length=40)
    description: str | None = None


class MilestoneCreate(MilestoneBase):
    pass


class MilestoneUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    plan_date: date | None = None
    actual_date: date | None = None
    status: str | None = Field(default=None, max_length=40)
    description: str | None = None


class MilestoneRead(MilestoneBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: datetime


class BaselineCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    note: str | None = None


class BaselineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    name: str
    version: int
    frozen_at: datetime
    note: str | None
    created_at: datetime


class BaselineDiffRow(BaseModel):
    task_id: UUID
    wbs_code: str
    level: int
    name: str
    current: dict[str, Any]
    baseline: dict[str, Any]
    changed: bool