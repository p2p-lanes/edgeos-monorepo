"""Add display_order to event_venues for manual drag-and-drop ordering.

Backoffice users can now reorder venues by drag-and-drop in the venues
list and that order is honored by every venue listing (backoffice list,
day-by-venue calendar, portal day view, portal venues list).

To keep visual continuity on rollout, this migration backfills
``display_order`` with the existing alphabetical ranking within each
popup. Newly created venues default to 0 and will sit at the top with
the ``title`` tiebreaker resolving ties — that's intentional; if it
becomes annoying we can switch to ``max(display_order)+1`` at create
time in a follow-up.

Revision ID: 0050_venue_display_order
Revises: c8d3a5e1f29b
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0050_venue_display_order"
down_revision: str | Sequence[str] | None = "c8d3a5e1f29b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "event_venues",
        sa.Column(
            "display_order",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.create_index(
        "ix_event_venues_display_order",
        "event_venues",
        ["display_order"],
    )

    op.execute(
        sa.text(
            """
            UPDATE event_venues v
            SET display_order = sub.rn - 1
            FROM (
              SELECT id,
                     ROW_NUMBER() OVER (
                       PARTITION BY popup_id ORDER BY title
                     ) AS rn
              FROM event_venues
            ) sub
            WHERE v.id = sub.id
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_event_venues_display_order", table_name="event_venues")
    op.drop_column("event_venues", "display_order")
