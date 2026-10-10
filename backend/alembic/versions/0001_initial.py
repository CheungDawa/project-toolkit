"""初始迁移：projects 表（01 文档 FR-P0-01 / 04 文档 3.1）。

Revision ID: 0001
Revises:
Create Date: 2026-10-10

"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("customer", sa.String(length=200), nullable=True),
        sa.Column("manager", sa.String(length=100), nullable=True),
        sa.Column("phase", sa.String(length=40), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=True),
        sa.Column("plan_start", sa.Date(), nullable=True),
        sa.Column("plan_end", sa.Date(), nullable=True),
        sa.Column("actual_start", sa.Date(), nullable=True),
        sa.Column("actual_end", sa.Date(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("work_calendar_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_projects_code"),
        sa.CheckConstraint(
            "plan_end IS NULL OR plan_start IS NULL OR plan_end >= plan_start",
            name="ck_projects_plan_dates",
        ),
        sa.CheckConstraint(
            "actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start",
            name="ck_projects_actual_dates",
        ),
    )


def downgrade() -> None:
    op.drop_table("projects")
