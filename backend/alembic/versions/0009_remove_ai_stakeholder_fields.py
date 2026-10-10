"""移除 AI 三表 + 干系人扩展字段（联系方式/优先级/参与程度/层级）。

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-10

用户决策（2026-10-10）：移除 AI 模块；导入旧干系人工具数据所需的扩展字段。
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- 移除 AI 模块 ---
    op.drop_table("ai_action_proposals")
    op.drop_table("ai_messages")
    op.drop_table("ai_conversations")

    # --- 干系人扩展（承接旧干系人管理工具字段） ---
    op.add_column("stakeholders", sa.Column("contact_phone", sa.String(length=40), nullable=True))
    op.add_column("stakeholders", sa.Column("contact_wechat", sa.String(length=80), nullable=True))
    op.add_column("stakeholders", sa.Column("contact_email", sa.String(length=120), nullable=True))
    op.add_column("stakeholders", sa.Column("priority", sa.String(length=10), nullable=True))
    op.add_column("stakeholders", sa.Column("participation", sa.String(length=80), nullable=True))
    op.add_column("stakeholders", sa.Column("sub_pos", sa.String(length=60), nullable=True))


def downgrade() -> None:
    op.drop_column("stakeholders", "sub_pos")
    op.drop_column("stakeholders", "participation")
    op.drop_column("stakeholders", "priority")
    op.drop_column("stakeholders", "contact_email")
    op.drop_column("stakeholders", "contact_wechat")
    op.drop_column("stakeholders", "contact_phone")

    op.create_table(
        "ai_conversations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=True),
        sa.Column("model_setting_key", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "ai_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("call_status", sa.String(length=30), nullable=False, server_default="pending"),
        sa.Column("model_identifier", sa.String(length=120), nullable=True),
        sa.Column("context_digest", sa.JSON(), nullable=True),
        sa.Column("token_usage", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["ai_conversations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "ai_action_proposals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=True),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("action_type", sa.String(length=40), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("diff_preview", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("accepted_by", sa.String(length=100), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["ai_messages.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )