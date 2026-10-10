"""阶段 2：任务/依赖/里程碑/基线五表。

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-10

"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("wbs_code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("owner", sa.String(length=100), nullable=True),
        sa.Column("collaborators", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("plan_start", sa.Date(), nullable=True),
        sa.Column("plan_end", sa.Date(), nullable=True),
        sa.Column("actual_start", sa.Date(), nullable=True),
        sa.Column("actual_end", sa.Date(), nullable=True),
        sa.Column("duration_days", sa.Integer(), nullable=True),
        sa.Column("work_hours", sa.Numeric(8, 2), nullable=True),
        sa.Column("progress", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="未开始"),
        sa.Column("priority", sa.String(length=20), nullable=True),
        sa.Column("acceptance_criteria", sa.Text(), nullable=True),
        sa.Column("deliverable_name", sa.Text(), nullable=True),
        sa.Column("progress_source", sa.String(length=20), nullable=False, server_default="manual"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["parent_id"], ["tasks.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "wbs_code", name="uq_tasks_project_wbs"),
        sa.CheckConstraint("progress >= 0 AND progress <= 100", name="ck_tasks_progress_range"),
        sa.CheckConstraint(
            "plan_end IS NULL OR plan_start IS NULL OR plan_end >= plan_start",
            name="ck_tasks_plan_dates",
        ),
        sa.CheckConstraint(
            "actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start",
            name="ck_tasks_actual_dates",
        ),
    )
    op.create_index("ix_tasks_project_id", "tasks", ["project_id"])
    op.create_index("ix_tasks_parent_id", "tasks", ["parent_id"])

    op.create_table(
        "task_dependencies",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("predecessor_id", sa.Uuid(), nullable=False),
        sa.Column("successor_id", sa.Uuid(), nullable=False),
        sa.Column("dep_type", sa.String(length=10), nullable=False, server_default="FS"),
        sa.Column("lag_days", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["predecessor_id"], ["tasks.id"]),
        sa.ForeignKeyConstraint(["successor_id"], ["tasks.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id", "predecessor_id", "successor_id", "dep_type",
            name="uq_deps_project_pair",
        ),
    )
    op.create_index("ix_task_dependencies_project_id", "task_dependencies", ["project_id"])

    op.create_table(
        "milestones",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("plan_date", sa.Date(), nullable=True),
        sa.Column("actual_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_milestones_project_id", "milestones", ["project_id"])

    op.create_table(
        "schedule_baselines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("frozen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_schedule_baselines_project_id", "schedule_baselines", ["project_id"])

    op.create_table(
        "baseline_task_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("baseline_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("wbs_code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("plan_start", sa.Date(), nullable=True),
        sa.Column("plan_end", sa.Date(), nullable=True),
        sa.Column("duration_days", sa.Integer(), nullable=True),
        sa.Column("work_hours", sa.Numeric(8, 2), nullable=True),
        sa.Column("progress", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["baseline_id"], ["schedule_baselines.id"]),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("baseline_id", "task_id", name="uq_baseline_task"),
    )
    op.create_index("ix_baseline_task_snapshots_baseline_id", "baseline_task_snapshots", ["baseline_id"])


def downgrade() -> None:
    op.drop_table("baseline_task_snapshots")
    op.drop_table("schedule_baselines")
    op.drop_table("milestones")
    op.drop_table("task_dependencies")
    op.drop_table("tasks")