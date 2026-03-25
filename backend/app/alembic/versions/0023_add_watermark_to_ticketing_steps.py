"""Add watermark column to ticketing steps; backfill descriptions and display variants.

Revision ID: 0023_add_watermark_to_ticketing_steps
Revises: 0022_custom_ticketing_steps
Create Date: 2026-03-25

"""

import sqlalchemy as sa
from alembic import op

revision = "0023_add_step_watermark"
down_revision = "0022_custom_ticketing_steps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add watermark column
    op.add_column("ticketingsteps", sa.Column("watermark", sa.String(), nullable=True))

    # Backfill watermark for default steps
    op.execute("UPDATE ticketingsteps SET watermark = 'Passes'  WHERE step_type = 'tickets'")
    op.execute("UPDATE ticketingsteps SET watermark = 'Housing' WHERE step_type = 'housing'")
    op.execute("UPDATE ticketingsteps SET watermark = 'Merch'   WHERE step_type = 'merch'")
    op.execute("UPDATE ticketingsteps SET watermark = 'Patron'  WHERE step_type = 'patron'")
    op.execute("UPDATE ticketingsteps SET watermark = 'Confirm' WHERE step_type = 'confirm'")

    # Backfill descriptions for existing steps that lack them
    op.execute("UPDATE ticketingsteps SET description = 'Choose passes for yourself and family members' WHERE step_type = 'tickets' AND description IS NULL")
    op.execute("UPDATE ticketingsteps SET description = 'Optional: Book accommodation for your stay' WHERE step_type = 'housing' AND description IS NULL")
    op.execute("UPDATE ticketingsteps SET description = 'Optional: Pick up exclusive merch at the event' WHERE step_type = 'merch' AND description IS NULL")
    op.execute("UPDATE ticketingsteps SET description = 'Optional: Support the community with a contribution' WHERE step_type = 'patron' AND description IS NULL")
    op.execute("UPDATE ticketingsteps SET description = 'Optional: Protect your purchase' WHERE step_type = 'insurance_checkout' AND description IS NULL")
    op.execute("UPDATE ticketingsteps SET description = 'Review your order before payment' WHERE step_type = 'confirm' AND description IS NULL")

    # Backfill display_variant for existing steps that lack them
    op.execute("UPDATE ticketingsteps SET display_variant = 'ticket-select'    WHERE step_type = 'tickets' AND display_variant IS NULL")
    op.execute("UPDATE ticketingsteps SET display_variant = 'housing-date'     WHERE step_type = 'housing' AND display_variant IS NULL")
    op.execute("UPDATE ticketingsteps SET display_variant = 'merch-image'      WHERE step_type = 'merch' AND display_variant IS NULL")
    op.execute("UPDATE ticketingsteps SET display_variant = 'patron-preset'    WHERE step_type = 'patron' AND display_variant IS NULL")


def downgrade() -> None:
    op.drop_column("ticketingsteps", "watermark")
