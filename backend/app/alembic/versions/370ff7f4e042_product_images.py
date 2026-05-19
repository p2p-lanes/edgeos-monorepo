"""Add `images` JSONB column to products for multi-image carousel support.

Housing products in the grid/showcase variants now support a gallery of
images. `image_url` remains the cover (rendered first); `images` holds
any additional photos rendered in the swipe carousel + lightbox.

Default is `[]` so existing single-image products keep their current
look (the cover-only render path doesn't read `images`).

Revision ID: 370ff7f4e042
Revises: 0050_venue_display_order
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "370ff7f4e042"
down_revision: str | Sequence[str] | None = "0050_venue_display_order"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "images",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("products", "images")
