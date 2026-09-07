"""Guest form: what a property asks, and what a booking answered.

Two columns on each side of the question.

On ``accommodation_properties``: ``guest_form_mode`` decides whether the
step's questions are asked for this property at all ("inherit", "off",
"custom"), and ``guest_form`` holds its own form when it overrides.

On ``accommodation_bookings``: ``booker_answers`` holds what whoever the room
is for answered, and ``form_snapshot`` freezes the form as it stood when the
booking was made, so a later rename does not relabel answers already given
and already sent to the property owner. Per-guest answers need no column:
they go inside the existing ``guests`` JSONB, whose entries grow from
``{"name": ...}`` to ``{"name": ..., "answers": {...}}``.

Additive and defaulted throughout: existing rows read as "inherit" and "no
answers", which is what they were.

Revision ID: a4f1c8b2e7d3
Revises: c7e5a1b9d3f2
Create Date: 2026-09-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a4f1c8b2e7d3"
down_revision: str | None = "c7e5a1b9d3f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "accommodation_properties",
        sa.Column(
            "guest_form_mode",
            sa.String(length=20),
            nullable=False,
            server_default="inherit",
        ),
    )
    op.add_column(
        "accommodation_properties",
        sa.Column("guest_form", postgresql.JSONB, nullable=True),
    )
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
    op.drop_column("accommodation_properties", "guest_form")
    op.drop_column("accommodation_properties", "guest_form_mode")
