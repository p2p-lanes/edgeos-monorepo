"""Add rejection_reason column to events.

Persists the admin-provided reason captured by the /reject endpoint so the
owner can see why their event request was denied in the portal. Rows that
were rejected before this migration stay with NULL and the UI guards on
truthy values.

Revision ID: 0046_event_rejection_reason
Revises: 0045_approval_emails_list
Create Date: 2026-05-11
"""

import sqlalchemy as sa
from alembic import op

revision = "0046_event_rejection_reason"
down_revision = "0045_approval_emails_list"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("rejection_reason", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("events", "rejection_reason")
