"""修正工作日历种子：weekends 采用 Python weekday 约定（周六=5、周日=6）。

0002 种子曾写入 [0, 6]（实为周一+周日），导致工期计算把周六当工作日。
Revision ID: 0004
Revises: 0003
Create Date: 2026-10-10

"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE app_settings "
        "SET value = jsonb_set(value::jsonb, '{weekends}', '[5,6]') "
        "WHERE key = 'workcalendar.overrides' "
        "AND value->>'weekends' IS NOT NULL"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE app_settings "
        "SET value = jsonb_set(value::jsonb, '{weekends}', '[0,6]') "
        "WHERE key = 'workcalendar.overrides'"
    )