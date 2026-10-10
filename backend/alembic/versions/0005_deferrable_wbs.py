"""uq_tasks_project_wbs 改为延迟校验，支持同事务内批量重算 WBS 编码。

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-10

"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("uq_tasks_project_wbs", "tasks", type_="unique")
    op.create_unique_constraint(
        "uq_tasks_project_wbs",
        "tasks",
        ["project_id", "wbs_code"],
        deferrable=True,
        initially="DEFERRED",
    )


def downgrade() -> None:
    op.drop_constraint("uq_tasks_project_wbs", "tasks", type_="unique")
    op.create_unique_constraint(
        "uq_tasks_project_wbs",
        "tasks",
        ["project_id", "wbs_code"],
    )