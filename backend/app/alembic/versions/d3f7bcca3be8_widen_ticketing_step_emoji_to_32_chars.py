"""Widen ticketingsteps.emoji to 32 characters.

The column stored a plain emoji character (max 8 bytes) but now doubles
as a curated icon slug (e.g. ``credit-card``, ``badge-check``,
``user-circle``, ``meal-plan``). Several shipped slugs exceed the
original 8-character limit, so the column is widened to 32 — the max
length of any catalog slug. Metadata-only change; no backfill needed.

Revision ID: d3f7bcca3be8
Revises: 789b23407b33
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d3f7bcca3be8"
down_revision: str | Sequence[str] | None = "789b23407b33"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "ticketingsteps",
        "emoji",
        existing_type=sa.String(length=8),
        type_=sa.String(length=32),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.execute("UPDATE ticketingsteps SET emoji = NULL WHERE length(emoji) > 8")
    op.alter_column(
        "ticketingsteps",
        "emoji",
        existing_type=sa.String(length=32),
        type_=sa.String(length=8),
        existing_nullable=True,
    )
