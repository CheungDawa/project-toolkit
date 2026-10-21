"""复盘模块：retrospectives + retro_action_items。

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-10

手写迁移（本机无 Postgres，autogenerate 无法运行）。down_revision 指向当前 head 0009。
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "retrospectives",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("scope", sa.String(length=20), nullable=False, server_default="whole"),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("facilitator", sa.String(length=100), nullable=True),
        sa.Column("participants", sa.JSON(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("atmosphere", sa.String(length=40), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_retrospectives_project_id", "retrospectives", ["project_id"])

    op.create_table(
        "retro_action_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("retro_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("owner", sa.String(length=100), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("priority", sa.String(length=20), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
        sa.Column("link_type", sa.String(length=20), nullable=True),
        sa.Column("link_id", sa.Uuid(), nullable=True),
        sa.Column("converted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("converted_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["retro_id"], ["retrospectives.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_retro_action_items_project_id", "retro_action_items", ["project_id"])
    op.create_index("ix_retro_action_items_retro_id", "retro_action_items", ["retro_id"])


def downgrade() -> None:
    op.drop_index("ix_retro_action_items_retro_id", table_name="retro_action_items")
    op.drop_index("ix_retro_action_items_project_id", table_name="retro_action_items")
    op.drop_table("retro_action_items")
    op.drop_index("ix_retrospectives_project_id", table_name="retrospectives")
    op.drop_table("retrospectives")
