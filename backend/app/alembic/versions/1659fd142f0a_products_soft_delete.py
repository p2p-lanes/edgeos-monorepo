"""products_soft_delete: add deleted_at for logical deletion and scope slug uniqueness to live rows.

Adds products.deleted_at (nullable timestamptz). Replaces the plain unique
constraint on (slug, popup_id) with a partial unique index restricted to rows
where deleted_at IS NULL, so soft-deleted products release their slug.

Revision ID: 1659fd142f0a
Revises: 383a07c89142
Create Date: 2026-04-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "1659fd142f0a"
down_revision: str = "383a07c89142"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.drop_constraint("uq_product_slug_popup_id", "products", type_="unique")
    op.create_index(
        "uq_product_slug_popup_id_active",
        "products",
        ["slug", "popup_id"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_product_slug_popup_id_active", table_name="products")
    op.create_unique_constraint(
        "uq_product_slug_popup_id", "products", ["slug", "popup_id"]
    )
    op.drop_column("products", "deleted_at")
