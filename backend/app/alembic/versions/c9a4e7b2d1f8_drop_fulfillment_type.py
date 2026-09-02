"""Drop persisted fulfillment classification contracts.

Revision ID: c9a4e7b2d1f8
Revises: b7d3e1f8c2a4
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c9a4e7b2d1f8"
down_revision: str | Sequence[str] | None = "b7d3e1f8c2a4"
branch_labels = depends_on = None

_TABLES = ("products", "payment_products", "attendee_products")
_COMPATIBILITY_CONSTRAINT = "ck_payment_product_fulfillment_identity_compatibility"
_ALLOWED = (
    "fulfillment_type IS NULL OR fulfillment_type IN ('access', 'participant', 'order')"
)
_IDENTITY_COMPATIBILITY = (
    "fulfillment_type IS NULL OR fulfillment_type = 'order' OR "
    "(fulfillment_type IN ('access', 'participant') AND "
    "(payment_recipient_id IS NOT NULL OR attendee_id IS NOT NULL))"
)


def upgrade() -> None:
    op.drop_constraint(
        _COMPATIBILITY_CONSTRAINT,
        "payment_products",
        type_="check",
    )
    op.drop_index(
        "ix_attendee_products_attendee_fulfillment_type",
        table_name="attendee_products",
    )
    op.drop_index(
        "ix_payment_products_payment_fulfillment_type",
        table_name="payment_products",
    )
    op.drop_index("ix_products_fulfillment_type", table_name="products")
    for table in reversed(_TABLES):
        op.drop_constraint(f"ck_{table}_fulfillment_type", table, type_="check")
        op.drop_column(table, "fulfillment_type")


def downgrade() -> None:
    for table in _TABLES:
        op.add_column(table, sa.Column("fulfillment_type", sa.String(), nullable=True))
        op.create_check_constraint(f"ck_{table}_fulfillment_type", table, _ALLOWED)
    op.create_index("ix_products_fulfillment_type", "products", ["fulfillment_type"])
    op.create_index(
        "ix_payment_products_payment_fulfillment_type",
        "payment_products",
        ["payment_id", "fulfillment_type"],
    )
    op.create_index(
        "ix_attendee_products_attendee_fulfillment_type",
        "attendee_products",
        ["attendee_id", "fulfillment_type"],
    )
    op.create_check_constraint(
        _COMPATIBILITY_CONSTRAINT,
        "payment_products",
        _IDENTITY_COMPATIBILITY,
    )
