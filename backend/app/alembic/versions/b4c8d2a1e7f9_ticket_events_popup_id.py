"""Add popup_id column to ticket_events.

Revision ID: b4c8d2a1e7f9
Revises: a3f9e1b2c4d7
Create Date: 2026-05-07

Reasoning:
  ticket_events is a popup-scoped event log but until now only carried
  tenant_id directly — popup had to be inferred via
  attendee_products → attendees → popup_id. That's both more expensive
  to filter on and inconsistent with every other popup-scoped table in
  the schema. This migration adds popup_id as a first-class column and
  backfills it from the existing attendee chain.

Forward-only migration. Raises RuntimeError on downgrade.

Steps:
  A. Add nullable popup_id column
  B. Backfill from attendee_products → attendees.popup_id
  C. ALTER NOT NULL + add FK to popups(id)
  D. Index on popup_id for filter queries
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision = "b4c8d2a1e7f9"
down_revision = "a3f9e1b2c4d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Step A: add nullable column ─────────────────────────────────────────
    op.add_column(
        "ticket_events",
        sa.Column(
            "popup_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )

    # ── Step B: backfill from attendee_products → attendees.popup_id ────────
    op.execute(
        """
        UPDATE ticket_events te
        SET popup_id = a.popup_id
        FROM attendee_products ap
        JOIN attendees a ON ap.attendee_id = a.id
        WHERE te.attendee_product_id = ap.id
        """
    )

    # ── Step C: enforce NOT NULL + add FK to popups(id) ─────────────────────
    op.alter_column("ticket_events", "popup_id", nullable=False)
    op.create_foreign_key(
        "fk_ticket_events_popup_id",
        "ticket_events",
        "popups",
        ["popup_id"],
        ["id"],
    )

    # ── Step D: index for popup-scoped filter queries ───────────────────────
    op.create_index(
        "ix_ticket_events_popup_id",
        "ticket_events",
        ["popup_id"],
    )


def downgrade() -> None:
    raise RuntimeError(
        "ticket_events_popup_id is a forward-only migration. "
        "Downgrade is not implemented — popup_id is required for "
        "popup-scoped filtering and the column cannot be safely dropped "
        "while existing consumers depend on it."
    )
