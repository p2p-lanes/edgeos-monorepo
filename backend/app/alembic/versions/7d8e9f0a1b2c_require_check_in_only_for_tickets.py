"""Require check-in only for ticket products.

Revision ID: 7d8e9f0a1b2c
Revises: 6c1d2e3f4a5b
Create Date: 2026-05-12
"""

from collections.abc import Sequence

from alembic import op

revision: str = "7d8e9f0a1b2c"
down_revision: str = "6c1d2e3f4a5b"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE products SET requires_check_in = false WHERE category <> 'ticket'")
    op.create_check_constraint(
        "ck_products_requires_check_in_ticket_only",
        "products",
        "category = 'ticket' OR requires_check_in = false",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_products_requires_check_in_ticket_only",
        "products",
        type_="check",
    )
