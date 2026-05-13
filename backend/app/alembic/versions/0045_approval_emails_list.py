"""Convert event_settings.approval_notification_email -> list column.

Replaces the singular ``approval_notification_email`` Text column with a
plural ``approval_notification_emails`` JSONB list column. Existing
values are migrated into single-element lists so any popup that was
already receiving approval notices keeps doing so without intervention.

Revision ID: 0045_approval_emails_list
Revises: b2c4e6f8a1d3
Create Date: 2026-05-08
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0045_approval_emails_list"
down_revision = "b2c4e6f8a1d3"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "event_settings",
        sa.Column(
            "approval_notification_emails",
            postgresql.JSONB,
            nullable=False,
            server_default="[]",
        ),
    )
    op.execute(
        """
        UPDATE event_settings
           SET approval_notification_emails =
               jsonb_build_array(approval_notification_email)
         WHERE approval_notification_email IS NOT NULL
           AND btrim(approval_notification_email) <> ''
        """
    )
    op.drop_column("event_settings", "approval_notification_email")


def downgrade():
    op.add_column(
        "event_settings",
        sa.Column("approval_notification_email", sa.Text(), nullable=True),
    )
    op.execute(
        """
        UPDATE event_settings
           SET approval_notification_email = approval_notification_emails->>0
         WHERE jsonb_array_length(approval_notification_emails) > 0
        """
    )
    op.drop_column("event_settings", "approval_notification_emails")
