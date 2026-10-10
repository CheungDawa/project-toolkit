"""系统设置表 + 默认配置种子（04 文档 3.20）。

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-10

"""
import uuid
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_app_settings_key"),
    )

    settings_table = sa.table(
        "app_settings",
        sa.column("id", sa.Uuid()),
        sa.column("key", sa.String()),
        sa.column("value", sa.JSON()),
        sa.column("description", sa.Text()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )

    now = _now()
    defaults = [
        {
            "key": "workcalendar.overrides",
            "value": {"weekends": [0, 6], "holidays": [], "note": "周末定义+节假日；项目级例外日期见 workcalendar.project"},
            "description": "全局工作日历（TD-01，阶段 2 启用）",
        },
        {
            "key": "risk.matrix",
            "value": {"rows": [1, 2, 3, 4, 5], "cols": [1, 2, 3, 4, 5], "levels": {"low": 4, "medium": 9, "high": 25}},
            "description": "风险概率×影响评分矩阵（可配置，阶段 3 启用）",
        },
        {
            "key": "progress.rule",
            "value": {"method": "work_hours", "fallback": "equal", "allow_manual_correction": True},
            "description": "进度汇总规则：按工时加权，无工时等权重（D-04，阶段 2 启用）",
        },
        {
            "key": "snapshot.policy",
            "value": {"mode": "daily_first_write"},
            "description": "进度快照采集策略（BR-03，阶段 5 启用）",
        },
        {
            "key": "model.default",
            "value": {},
            "description": "AI 模型默认配置（阶段 4 填充；API 密钥仅存服务端，不回显）",
        },
    ]

    op.bulk_insert(
        settings_table,
        [
            {
                "id": uuid.uuid4(),
                "key": row["key"],
                "value": row["value"],
                "description": row["description"],
                "created_at": now,
                "updated_at": now,
            }
            for row in defaults
        ],
    )


def downgrade() -> None:
    op.drop_table("app_settings")