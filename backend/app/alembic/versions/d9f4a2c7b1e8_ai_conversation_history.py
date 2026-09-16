"""AI conversation history and token usage.

Revision ID: d9f4a2c7b1e8
Revises: c4d8e6f1a2b3
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision = "d9f4a2c7b1e8"
down_revision = "c4d8e6f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column(
            "messages",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "schema_version", sa.SmallInteger(), nullable=False, server_default="1"
        ),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "jsonb_typeof(messages) = 'array'",
            name="ck_ai_conversations_messages_array",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_ai_conversations_tenant_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            name="fk_ai_conversations_owner_user_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_ai_conversations"),
    )
    op.create_index("ix_ai_conversations_tenant_id", "ai_conversations", ["tenant_id"])
    op.create_index(
        "ix_ai_conversations_owner_updated",
        "ai_conversations",
        ["owner_user_id", "updated_at"],
    )
    op.create_index(
        "ix_ai_conversations_expires_at", "ai_conversations", ["expires_at"]
    )
    add_tenant_table_permissions("ai_conversations")

    op.create_table(
        "ai_conversation_usage",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=False),
        sa.Column("input_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "cached_input_tokens", sa.BigInteger(), nullable=False, server_default="0"
        ),
        sa.Column("output_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "reasoning_tokens", sa.BigInteger(), nullable=False, server_default="0"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "input_tokens >= 0 AND cached_input_tokens >= 0 "
            "AND output_tokens >= 0 AND reasoning_tokens >= 0",
            name="ck_ai_conversation_usage_nonnegative",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_ai_conversation_usage_tenant_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["ai_conversations.id"],
            name="fk_ai_conversation_usage_conversation_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_ai_conversation_usage"),
        sa.UniqueConstraint(
            "conversation_id",
            "event_id",
            name="uq_ai_conversation_usage_event",
        ),
    )
    op.create_index(
        "ix_ai_conversation_usage_tenant_id",
        "ai_conversation_usage",
        ["tenant_id"],
    )
    op.create_index(
        "ix_ai_conversation_usage_conversation_created",
        "ai_conversation_usage",
        ["conversation_id", "created_at"],
    )
    add_tenant_table_permissions("ai_conversation_usage")


def downgrade() -> None:
    remove_tenant_table_permissions("ai_conversation_usage")
    op.drop_index(
        "ix_ai_conversation_usage_conversation_created",
        table_name="ai_conversation_usage",
    )
    op.drop_index(
        "ix_ai_conversation_usage_tenant_id", table_name="ai_conversation_usage"
    )
    op.drop_table("ai_conversation_usage")

    remove_tenant_table_permissions("ai_conversations")
    op.drop_index("ix_ai_conversations_expires_at", table_name="ai_conversations")
    op.drop_index("ix_ai_conversations_owner_updated", table_name="ai_conversations")
    op.drop_index("ix_ai_conversations_tenant_id", table_name="ai_conversations")
    op.drop_table("ai_conversations")
