"""复盘模块请求/响应模型（与前端契约一致：日期用 ISO 字符串，UUID 用字符串）。"""
from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class RetroScope(str, Enum):
    """复盘范围。"""

    PHASE = "phase"
    MILESTONE = "milestone"
    SPRINT = "sprint"
    WHOLE = "whole"


class RetroStatus(str, Enum):
    """复盘状态。"""

    DRAFT = "draft"
    PUBLISHED = "published"


class RetroActionCategory(str, Enum):
    """行动项类别。"""

    GOOD = "good"
    IMPROVE = "improve"
    ACTION = "action"


class RetroActionPriority(str, Enum):
    """行动项优先级。"""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class RetroActionStatus(str, Enum):
    """行动项状态。"""

    OPEN = "open"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    CLOSED = "closed"


class RetroLinkType(str, Enum):
    """回写关联类型。"""

    TASK = "task"
    RISK = "risk"
    ISSUE = "issue"


# ---------- 复盘 ----------


class RetrospectiveBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    scope: RetroScope = RetroScope.WHOLE
    occurred_on: date
    facilitator: str | None = Field(default=None, max_length=100)
    participants: list[str] | None = None
    summary: str | None = None
    atmosphere: str | None = Field(default=None, max_length=40)
    status: RetroStatus = RetroStatus.DRAFT


class RetrospectiveCreate(RetrospectiveBase):
    """创建复盘（project_id 取自路径）。"""


class RetrospectiveUpdate(BaseModel):
    """更新复盘：全部可选字段。"""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    scope: RetroScope | None = None
    occurred_on: date | None = None
    facilitator: str | None = Field(default=None, max_length=100)
    participants: list[str] | None = None
    summary: str | None = None
    atmosphere: str | None = Field(default=None, max_length=40)
    status: RetroStatus | None = None


class RetrospectiveRead(RetrospectiveBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: datetime


# ---------- 行动项 ----------


class RetroActionItemBase(BaseModel):
    category: RetroActionCategory
    content: str = Field(min_length=1)
    owner: str | None = Field(default=None, max_length=100)
    due_date: date | None = None
    priority: RetroActionPriority | None = None
    status: RetroActionStatus = RetroActionStatus.OPEN


class RetroActionItemCreate(RetroActionItemBase):
    """创建行动项（retro_id / project_id 取自路径）。"""


class RetroActionItemUpdate(BaseModel):
    """更新行动项：全部可选（含手动关联 link_type/link_id）。"""

    category: RetroActionCategory | None = None
    content: str | None = Field(default=None, min_length=1)
    owner: str | None = Field(default=None, max_length=100)
    due_date: date | None = None
    priority: RetroActionPriority | None = None
    status: RetroActionStatus | None = None
    link_type: RetroLinkType | None = None
    link_id: UUID | None = None


class RetroActionItemRead(RetroActionItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    retro_id: UUID
    project_id: UUID
    link_type: RetroLinkType | None = None
    link_id: UUID | None = None
    converted: bool = False
    converted_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class RetroConvertRequest(BaseModel):
    """行动项回写请求。"""

    target: RetroLinkType


class RetroConvertResult(BaseModel):
    """行动项回写结果：原 action_item（已标记 converted）+ 新建实体。"""

    action_item: RetroActionItemRead
    entity: dict
    entity_type: RetroLinkType
