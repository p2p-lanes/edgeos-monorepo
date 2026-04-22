"""Batch 1 event-related field additions.

Adds:
- event_venues.description (Text, nullable)
- event_settings.allowed_tags (JSONB list, default [])
- event_settings.approval_notification_email (Text, nullable)

Revision ID: 0036_batch1_fields
Revises: 0035_event_hidden_by_human
Create Date: 2026-04-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0036_batch1_fields"
down_revision = "0035_event_hidden_by_human"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "event_venues",
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.add_column(
        "event_settings",
        sa.Column(
            "allowed_tags",
            postgresql.JSONB,
            nullable=False,
            server_default="[]",
        ),
    )
    op.add_column(
        "event_settings",
        sa.Column("approval_notification_email", sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column("event_settings", "approval_notification_email")
    op.drop_column("event_settings", "allowed_tags")
    op.drop_column("event_venues", "description")
