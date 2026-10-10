"""系统设置（app_settings）请求/响应模型。"""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class SettingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    value: Any
    description: str | None = None
    updated_at: datetime


class SettingUpdate(BaseModel):
    value: Any