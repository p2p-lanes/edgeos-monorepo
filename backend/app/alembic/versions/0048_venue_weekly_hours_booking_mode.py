"""Add booking_mode column to venue_weekly_hours.

Per-slot booking permission so a single venue can be permissionless during
some hours and approval-required during others. NULL is the explicit "fall
back to venue default" sentinel; no backfill is needed because existing
venues keep working when every row is NULL.

Revision ID: 0048_venue_slot_booking_mode
Revises: 0d62c955bfdf
Create Date: 2026-05-14
"""

import sqlalchemy as sa
from alembic import op

revision = "0048_venue_slot_booking_mode"
down_revision = "0d62c955bfdf"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "venue_weekly_hours",
        sa.Column("booking_mode", sa.String(length=30), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("venue_weekly_hours", "booking_mode")
