"""Add host_display_name column to events.

Optional free-text host name displayed to participants on the portal event
detail page. Event creators set it via shortcuts in the backoffice (tenant
name, their own name, a picked participant, or a custom value). NULL means
the portal falls back to the tenant's name at render time.

Revision ID: 0047_event_host_display_name
Revises: 0046_event_rejection_reason
Create Date: 2026-05-11
"""

import sqlalchemy as sa
from alembic import op

revision = "0047_event_host_display_name"
down_revision = "0046_event_rejection_reason"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("host_display_name", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("events", "host_display_name")
