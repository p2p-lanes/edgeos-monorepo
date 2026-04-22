"""Add ical_sequence counter to events for RFC 5546 SEQUENCE tracking.

Every time an event's calendar-material fields change (start/end/title/location
/cancel) we bump this counter and re-send an iTIP REQUEST/CANCEL to the
recipients so their email clients can update the calendar entry.

Revision ID: 0034_events_ical_sequence
Revises: 0033_events_recurrence
Create Date: 2026-04-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0034_events_ical_sequence"
down_revision = "0033_events_recurrence"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "events",
        sa.Column(
            "ical_sequence",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade():
    op.drop_column("events", "ical_sequence")
