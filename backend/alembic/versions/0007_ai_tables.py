"""AI 三表。

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-10

"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
    op.create_index("ix_ai_conversations_project_id", "ai_conversations", ["project_id"])

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
    op.create_index("ix_ai_messages_conversation_id", "ai_messages", ["conversation_id"])

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
    op.create_index("ix_ai_action_proposals_project_id", "ai_action_proposals", ["project_id"])


def downgrade() -> None:
    op.drop_table("ai_action_proposals")
    op.drop_table("ai_messages")
    op.drop_table("ai_conversations")