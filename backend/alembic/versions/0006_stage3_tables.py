"""阶段 3 七表 + tasks.risk_id 转化回链。

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-10

"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("risk_id", sa.Uuid(), nullable=True))

    op.create_table(
        "risks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("category", sa.String(length=40), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("probability", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("impact", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("score", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("level", sa.String(length=10), nullable=True),
        sa.Column("owner", sa.String(length=100), nullable=True),
        sa.Column("trigger_condition", sa.Text(), nullable=True),
        sa.Column("prevention", sa.Text(), nullable=True),
        sa.Column("contingency", sa.Text(), nullable=True),
        sa.Column("strategy", sa.String(length=20), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="未决"),
        sa.Column("residual_level", sa.String(length=10), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("probability BETWEEN 1 AND 5", name="ck_risks_probability"),
        sa.CheckConstraint("impact BETWEEN 1 AND 5", name="ck_risks_impact"),
    )
    op.create_index("ix_risks_project_id", "risks", ["project_id"])

    op.create_table(
        "risk_assessments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("risk_id", sa.Uuid(), nullable=False),
        sa.Column("probability", sa.Integer(), nullable=False),
        sa.Column("impact", sa.Integer(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("level", sa.String(length=10), nullable=True),
        sa.Column("assessed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("basis", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["risk_id"], ["risks.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("probability BETWEEN 1 AND 5", name="ck_assessments_probability"),
        sa.CheckConstraint("impact BETWEEN 1 AND 5", name="ck_assessments_impact"),
    )
    op.create_index("ix_risk_assessments_risk_id", "risk_assessments", ["risk_id"])

    op.create_table(
        "issues",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("risk_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("severity", sa.String(length=20), nullable=True),
        sa.Column("owner", sa.String(length=100), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("root_cause", sa.Text(), nullable=True),
        sa.Column("solution", sa.Text(), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verified_by", sa.String(length=100), nullable=True),
        sa.Column("closure_result", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="待处理"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["risk_id"], ["risks.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_issues_project_id", "issues", ["project_id"])
    op.create_index("ix_issues_risk_id", "issues", ["risk_id"])

    op.create_table(
        "change_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("origin", sa.Text(), nullable=True),
        sa.Column("scope_impact", sa.Text(), nullable=True),
        sa.Column("schedule_impact", sa.Text(), nullable=True),
        sa.Column("approval_status", sa.String(length=20), nullable=False, server_default="草拟"),
        sa.Column("implementation_plan", sa.Text(), nullable=True),
        sa.Column("verification_result", sa.Text(), nullable=True),
        sa.Column("requested_by", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_change_requests_project_id", "change_requests", ["project_id"])

    op.create_table(
        "stakeholders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("person_type", sa.String(length=10), nullable=False, server_default="person"),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("org", sa.String(length=200), nullable=True),
        sa.Column("role", sa.String(length=100), nullable=True),
        sa.Column("influence", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("interest", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("demands", sa.Text(), nullable=True),
        sa.Column("strategy", sa.Text(), nullable=True),
        sa.Column("comm_frequency", sa.String(length=30), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("influence BETWEEN 1 AND 5", name="ck_stakeholders_influence"),
        sa.CheckConstraint("interest BETWEEN 1 AND 5", name="ck_stakeholders_interest"),
    )
    op.create_index("ix_stakeholders_project_id", "stakeholders", ["project_id"])

    op.create_table(
        "stakeholder_communications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("stakeholder_id", sa.Uuid(), nullable=False),
        sa.Column("comm_date", sa.Date(), nullable=True),
        sa.Column("channel", sa.String(length=30), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("conclusion", sa.Text(), nullable=True),
        sa.Column("follow_up_action", sa.Text(), nullable=True),
        sa.Column("follow_up_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["stakeholder_id"], ["stakeholders.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_stakeholder_communications_stakeholder_id",
        "stakeholder_communications", ["stakeholder_id"],
    )

    op.create_table(
        "activity_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("object_type", sa.String(length=40), nullable=False),
        sa.Column("object_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("payload_diff", sa.JSON(), nullable=True),
        sa.Column("operator", sa.String(length=100), nullable=False, server_default="owner"),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_activity_logs_project_id", "activity_logs", ["project_id"])

    op.create_foreign_key(
        "fk_tasks_risk_id", "tasks", "risks", ["risk_id"], ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_tasks_risk_id", "tasks", type_="foreignkey")
    op.drop_table("activity_logs")
    op.drop_table("stakeholder_communications")
    op.drop_table("stakeholders")
    op.drop_table("change_requests")
    op.drop_table("issues")
    op.drop_table("risk_assessments")
    op.drop_table("risks")
    op.drop_column("tasks", "risk_id")