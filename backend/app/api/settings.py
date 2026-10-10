"""系统设置 API（T1-10 骨架；密钥类配置仅服务端，不回显）。"""
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.models.setting import Setting
from app.schemas.setting import SettingRead, SettingUpdate

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _get_or_404(db: Session, key: str) -> Setting:
    setting = db.scalar(select(Setting).where(Setting.key == key))
    if setting is None:
        raise AppError(404, "not_found", f"配置项不存在：{key}")
    return setting


@router.get("", response_model=list[SettingRead])
def list_settings(db: Session = Depends(get_db)) -> Any:
    return list(db.scalars(select(Setting).order_by(Setting.key)).all())


@router.get("/{key}", response_model=SettingRead)
def get_setting(key: str, db: Session = Depends(get_db)) -> Any:
    return _get_or_404(db, key)


@router.put("/{key}", response_model=SettingRead)
def update_setting(key: str, payload: SettingUpdate, db: Session = Depends(get_db)) -> Any:
    setting = _get_or_404(db, key)
    setting.value = payload.value
    db.commit()
    db.refresh(setting)
    return setting