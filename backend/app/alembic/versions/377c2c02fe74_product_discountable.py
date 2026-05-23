"""product_discountable: per-product flag controlling whether discounts apply.

Adds:
  - products.discountable (bool, NOT NULL, default true)

Defaults to true so existing products keep current behavior. When set to false
on a specific product, the backend's `_calculate_amounts` routes its amount to
the non-discountable bucket — same treatment as patreon products — so coupons,
group discounts, and scholarship discounts never reduce its price.

The portal mirrors the same split when computing `discountableSubtotal`.

Revision ID: 377c2c02fe74
Revises: 84513cbb2260
Create Date: 2026-05-23 21:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "377c2c02fe74"
down_revision: str = "84513cbb2260"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "discountable",
            sa.Boolean(),
            nullable=False,
            server_default="true",
        ),
    )
    # Patreon products are donations and must never be discounted. Backfill so
    # the new flag captures the existing business rule for legacy rows.
    op.execute("UPDATE products SET discountable = false WHERE category = 'patreon'")


def downgrade() -> None:
    op.drop_column("products", "discountable")
