"""Add event_settings.allowed_kinds and drop event_venues.amenities.

The product replaces the free-text event ``kind`` with a per-popup curated
list (mirrors how ``allowed_tags`` already works), and removes
``amenities`` from venues since it overlapped with the structured
``properties`` relation. Existing amenities are dropped — devs can re-
attach them as venue properties.

Revision ID: 0036_event_kinds_no_amenities
Revises: baa61e35a1e5
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0036_event_kinds_no_amenities"
down_revision = "baa61e35a1e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "event_settings",
        sa.Column(
            "allowed_kinds",
            JSONB,
            nullable=False,
            server_default="[]",
        ),
    )
    op.drop_column("event_venues", "amenities")


def downgrade() -> None:
    op.add_column(
        "event_venues",
        sa.Column(
            "amenities",
            JSONB,
            nullable=False,
            server_default="[]",
        ),
    )
    op.drop_column("event_settings", "allowed_kinds")
