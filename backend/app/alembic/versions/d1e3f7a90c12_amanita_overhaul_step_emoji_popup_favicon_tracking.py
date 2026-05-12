"""Amanita overhaul: ticketingsteps.emoji + popups.favicon_url + popups.tracking_snippets.

Three additive columns, each opt-in and backwards-compatible:

* ``ticketingsteps.emoji`` — tenant-picked emoji rendered next to the step
  icon in the portal nav. ``NULL`` keeps the legacy Lucide icon.
* ``popups.favicon_url`` — URL of the favicon shown on the checkout page.
  ``NULL`` falls back to the platform default.
* ``popups.tracking_snippets`` — JSONB blob mapping anchor names
  (``cart``, ``buyer``, ``thank_you``) to sanitized HTML/JS snippets that
  get injected at the matching portal anchor. Lets tenants add Facebook /
  Instagram pixels per popup without code changes.

All three default to ``NULL`` so the migration is non-destructive for
existing tenants.

Revision ID: d1e3f7a90c12
Revises: c5e9d3b2f8a0
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "d1e3f7a90c12"
down_revision: str | Sequence[str] | None = "c5e9d3b2f8a0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ticketingsteps",
        sa.Column("emoji", sa.String(length=8), nullable=True),
    )
    op.add_column(
        "popups",
        sa.Column("favicon_url", sa.String(), nullable=True),
    )
    op.add_column(
        "popups",
        sa.Column("tracking_snippets", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("popups", "tracking_snippets")
    op.drop_column("popups", "favicon_url")
    op.drop_column("ticketingsteps", "emoji")
