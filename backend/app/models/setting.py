"""系统配置项（app_settings，04 文档 3.20；T1-10 骨架 + 阶段 2/3/4 逐步填充）。"""
import uuid
from datetime import datetime

from sqlalchemy import JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Setting(TimestampMixin, Base):
    __tablename__ = "app_settings"
    __table_args__ = (
        UniqueConstraint("key", name="uq_app_settings_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    value: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    description: Mapped[str | None] = mapped_column(Text(), nullable=True)