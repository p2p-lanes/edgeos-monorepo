"""Require a nonblank category for every product.

Revision ID: c82e1f4a39d7
Revises: ea7c39d54f18
"""

import sqlalchemy as sa
from alembic import op

revision = "c82e1f4a39d7"
down_revision = "ea7c39d54f18"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Do not guess a category for existing products: category determines which
    # checkout step sells the product. Repair any invalid rows deliberately.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM products WHERE category ~ '^[[:space:]]*$') THEN
                RAISE EXCEPTION 'Fix blank product categories before migrating';
            END IF;
        END $$;
        """
    )
    op.create_check_constraint(
        "ck_products_category_not_blank",
        "products",
        sa.text("category !~ '^[[:space:]]*$'"),
    )


def downgrade() -> None:
    op.drop_constraint("ck_products_category_not_blank", "products", type_="check")
