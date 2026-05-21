"""payment_products purchase_metadata

Adds a nullable JSONB column on payment_products. Mirrors
attendee_products.purchase_metadata (migration a1f9c2e8b5d1) so the
SimpleFI-webhook approval path — which rebuilds attendee_products from
the payment snapshot — can carry meal_plan_select metadata
(daily_choices, dietary_restriction, special_request) across the
async approval boundary.

Without this column, paid card orders lose the metadata permanently:
the webhook handler reconstructs PaymentProductRequest entries from
payment.products_snapshot and has nowhere to read the original blob
from, so the resulting attendee_products rows persist with NULL.

Revision ID: d2f5a7c891b3
Revises: c0b101dd74e8
Create Date: 2026-05-21

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = "d2f5a7c891b3"
down_revision = "c0b101dd74e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "payment_products",
        sa.Column("purchase_metadata", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("payment_products", "purchase_metadata")
