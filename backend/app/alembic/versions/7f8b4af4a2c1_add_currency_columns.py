"""Add currency columns to popups and payment_products.

Adds popup-level currency selection (USD/ARS/EUR) and snapshots the product
currency on payment_products so downstream documents keep the original sale
currency even if payment settlement metadata changes.

Revision ID: 7f8b4af4a2c1
Revises: 3e11ce245531
Create Date: 2026-04-17

"""

import sqlalchemy as sa
from alembic import op

revision = "7f8b4af4a2c1"
down_revision = "3e11ce245531"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column(
            "currency",
            sa.String(3),
            nullable=False,
            server_default="USD",
        ),
    )

    op.add_column(
        "payment_products",
        sa.Column(
            "product_currency",
            sa.String(3),
            nullable=False,
            server_default="USD",
        ),
    )


def downgrade() -> None:
    op.drop_column("payment_products", "product_currency")
    op.drop_column("popups", "currency")
