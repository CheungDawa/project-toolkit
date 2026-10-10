"""AI 请求/响应模型。"""
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AiConversationCreate(BaseModel):
    project_id: UUID | None = None
    title: str | None = None


class AiConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID | None
    title: str | None
    model_setting_key: str | None
    created_at: datetime
    updated_at: datetime


class AiChatRequest(BaseModel):
    content: str


class AiMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    conversation_id: UUID
    role: str
    content: str
    call_status: str
    model_identifier: str | None
    context_digest: dict[str, Any] | None
    token_usage: int | None
    error_message: str | None
    created_at: datetime


class AiProposalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    message_id: UUID | None
    project_id: UUID
    action_type: str
    payload: dict[str, Any]
    diff_preview: dict[str, Any] | None
    status: str
    accepted_by: str | None
    accepted_at: datetime | None
    rejected_at: datetime | None
    created_at: datetime


class AiProposalAccept(BaseModel):
    confirm: bool = False


class AiProposalReject(BaseModel):
    pass