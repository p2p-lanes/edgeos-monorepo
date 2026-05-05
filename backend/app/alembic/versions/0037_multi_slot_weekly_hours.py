"""Allow multiple open/close slots per (venue, day_of_week).

Drops the ``uq_venue_day`` unique constraint so a venue can e.g. be open
09:00-11:00 AND 17:00-21:00 on the same weekday. Check constraint on the
day range stays.

Revision ID: 0037_multi_slot_weekly_hours
Revises: 0036_batch1_fields
Create Date: 2026-04-17
"""
from alembic import op

revision = "0037_multi_slot_weekly_hours"
down_revision = "0036_batch1_fields"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint(
        "uq_venue_day", "venue_weekly_hours", type_="unique"
    )


def downgrade():
    op.create_unique_constraint(
        "uq_venue_day",
        "venue_weekly_hours",
        ["venue_id", "day_of_week"],
    )
