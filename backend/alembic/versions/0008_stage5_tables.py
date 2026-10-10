"""阶段 5：快照 / 交付资料 / 附件。

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-10

"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_progress_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        sa.Column("scope", sa.String(length=10), nullable=False, server_default="project"),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("total_tasks", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed_tasks", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("remaining_tasks", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_hours", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("remaining_hours", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "scope", "snapshot_date", name="uq_snapshot_project_scope_date"),
    )
    op.create_index("ix_task_progress_snapshots_project_id", "task_progress_snapshots", ["project_id"])

    op.create_table(
        "deliverables",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("template_id", sa.String(length=80), nullable=True),
        sa.Column("category", sa.String(length=40), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("owner", sa.String(length=100), nullable=True),
        sa.Column("plan_date", sa.Date(), nullable=True),
        sa.Column("submit_status", sa.String(length=30), nullable=False, server_default="未提交"),
        sa.Column("review_status", sa.String(length=30), nullable=False, server_default="待审核"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_deliverables_project_id", "deliverables", ["project_id"])

    op.create_table(
        "attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("object_type", sa.String(length=40), nullable=False),
        sa.Column("object_id", sa.Uuid(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("mime_type", sa.String(length=120), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_attachments_object_type_object_id", "attachments", ["object_type", "object_id"])


def downgrade() -> None:
    op.drop_table("attachments")
    op.drop_table("deliverables")
    op.drop_table("task_progress_snapshots")