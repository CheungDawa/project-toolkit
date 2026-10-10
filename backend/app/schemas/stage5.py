"""交付资料请求/响应模型。"""
from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DeliverableCreate(BaseModel):
    category: str | None = Field(default=None, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    owner: str | None = Field(default=None, max_length=100)
    plan_date: date | None = None
    submit_status: str = Field(default="未提交", max_length=30)
    review_status: str = Field(default="待审核", max_length=30)
    note: str | None = None
    task_id: UUID | None = None


class DeliverableUpdate(BaseModel):
    category: str | None = Field(default=None, max_length=40)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    owner: str | None = Field(default=None, max_length=100)
    plan_date: date | None = None
    submit_status: str | None = Field(default=None, max_length=30)
    review_status: str | None = Field(default=None, max_length=30)
    note: str | None = None
    task_id: UUID | None = None


class DeliverableRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    template_id: str | None
    category: str | None
    name: str
    owner: str | None
    plan_date: date | None
    submit_status: str
    review_status: str
    note: str | None
    task_id: UUID | None
    created_at: datetime
    updated_at: datetime


class TemplateItem(BaseModel):
    category: str
    name: str
    description: str | None = None