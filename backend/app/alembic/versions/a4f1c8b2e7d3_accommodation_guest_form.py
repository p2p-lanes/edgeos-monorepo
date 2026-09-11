"""Guest form: what a booking answered.

``booker_answers`` holds what whoever the room is for answered, and
``form_snapshot`` freezes the form as it stood when the booking was made, so a
later rename does not relabel answers already given and already sent to the
property owner. Per-guest answers need no column: they go inside the existing
``guests`` JSONB, whose entries grow from ``{"name": ...}`` to
``{"name": ..., "answers": {...}}``.

The questions themselves are not here. They live on the accommodation step, in
``template_config.guest_form``, which is JSONB that already exists.

Additive and defaulted: existing rows read as "no answers", which is what they
were.

Revision ID: a4f1c8b2e7d3
Revises: a6f4c2e9d1b7
Create Date: 2026-09-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a4f1c8b2e7d3"
down_revision: str | None = "a6f4c2e9d1b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "accommodation_bookings",
        sa.Column(
            "booker_answers",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.add_column(
        "accommodation_bookings",
        sa.Column("form_snapshot", postgresql.JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("accommodation_bookings", "form_snapshot")
    op.drop_column("accommodation_bookings", "booker_answers")
