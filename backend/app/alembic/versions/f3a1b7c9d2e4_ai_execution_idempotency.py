"""Durable PostgreSQL idempotency for approved AI writes.

Revision ID: f3a1b7c9d2e4
Revises: d9f4a2c7b1e8
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision = "f3a1b7c9d2e4"
down_revision = "d9f4a2c7b1e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_executions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("execution_id", sa.String(length=64), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("result", postgresql.JSONB(), nullable=True),
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
            "state IN ('pending', 'completed')",
            name="ck_ai_executions_state",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_ai_executions_tenant_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            name="fk_ai_executions_owner_user_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_ai_executions"),
        sa.UniqueConstraint(
            "tenant_id",
            "owner_user_id",
            "execution_id",
            name="uq_ai_executions_owner_execution",
        ),
    )
    op.create_index("ix_ai_executions_tenant_id", "ai_executions", ["tenant_id"])
    op.create_index(
        "ix_ai_executions_owner_expires",
        "ai_executions",
        ["owner_user_id", "expires_at"],
    )
    add_tenant_table_permissions("ai_executions")


def downgrade() -> None:
    remove_tenant_table_permissions("ai_executions")
    op.drop_index("ix_ai_executions_owner_expires", table_name="ai_executions")
    op.drop_index("ix_ai_executions_tenant_id", table_name="ai_executions")
    op.drop_table("ai_executions")
