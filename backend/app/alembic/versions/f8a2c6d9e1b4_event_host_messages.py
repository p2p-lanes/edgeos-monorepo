"""Store host messages and delivery summaries for event managers."""

import sqlalchemy as sa
from alembic import op

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision = "f8a2c6d9e1b4"
down_revision = "c82e1f4a39d7"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "event_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column(
            "event_id",
            sa.Uuid(),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("author_name", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("occurrence_start", sa.DateTime(timezone=True)),
        sa.Column("recipient_count", sa.Integer(), nullable=False),
        sa.Column("sent_count", sa.Integer(), nullable=False),
        sa.Column("failed_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_event_messages_tenant_id", "event_messages", ["tenant_id"])
    op.create_index(
        "ix_event_messages_event_created", "event_messages", ["event_id", "created_at"]
    )
    add_tenant_table_permissions("event_messages")


def downgrade():
    remove_tenant_table_permissions("event_messages")
    op.drop_table("event_messages")
