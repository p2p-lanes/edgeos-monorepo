"""attendee_products purchase_metadata

Adds a nullable JSONB column on attendee_products to carry per-purchase
metadata for the meal_plan_select ticketing step (daily_choices,
dietary_restriction, special_request).

Revision ID: a1f9c2e8b5d1
Revises: 370ff7f4e042
Create Date: 2026-05-20

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = "a1f9c2e8b5d1"
down_revision = "370ff7f4e042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "attendee_products",
        sa.Column("purchase_metadata", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("attendee_products", "purchase_metadata")
