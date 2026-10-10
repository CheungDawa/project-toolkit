"""项目 API 的请求/响应模型（Pydantic v2）。"""
from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProjectCreate(BaseModel):
    code: str = Field(min_length=1, max_length=32, description="项目编号，全局唯一")
    name: str = Field(min_length=1, max_length=200)
    customer: str | None = Field(default=None, max_length=200)
    manager: str | None = Field(default=None, max_length=100)
    phase: str | None = Field(default=None, max_length=40)
    status: str | None = Field(default=None, max_length=40)
    plan_start: date | None = None
    plan_end: date | None = None
    actual_start: date | None = None
    actual_end: date | None = None
    description: str | None = None


class ProjectUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    customer: str | None = Field(default=None, max_length=200)
    manager: str | None = Field(default=None, max_length=100)
    phase: str | None = Field(default=None, max_length=40)
    status: str | None = Field(default=None, max_length=40)
    plan_start: date | None = None
    plan_end: date | None = None
    actual_start: date | None = None
    actual_end: date | None = None
    description: str | None = None


class ProjectRead(ProjectCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None
    deleted_at: datetime | None = None


class ProjectPage(BaseModel):
    items: list[ProjectRead]
    total: int
    page: int
    size: int
