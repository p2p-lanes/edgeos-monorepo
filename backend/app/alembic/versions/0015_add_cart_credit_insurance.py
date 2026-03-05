"""Add carts table, credit field on applications, insurance fields on products and payments

Revision ID: 0015_add_cart_credit_insurance
Revises: 0014_protected_formsections
Create Date: 2026-03-04

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

# revision identifiers, used by Alembic.
revision = "0015_add_cart_credit_insurance"
down_revision = "0014_protected_formsections"
branch_labels = None
depends_on = None


def upgrade():
    # 1. Add credit column to applications
    op.add_column(
        "applications",
        sa.Column(
            "credit",
            sa.Numeric(10, 2),
            nullable=False,
            server_default="0",
        ),
    )

    # 2. Add insurance_percentage to products
    op.add_column(
        "products",
        sa.Column(
            "insurance_percentage",
            sa.Numeric(5, 2),
            nullable=True,
        ),
    )

    # 3. Add insurance_amount to payments
    op.add_column(
        "payments",
        sa.Column(
            "insurance_amount",
            sa.Numeric(10, 2),
            nullable=False,
            server_default="0",
        ),
    )

    # 4. Create carts table
    op.create_table(
        "carts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "human_id",
            UUID(as_uuid=True),
            sa.ForeignKey("humans.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "popup_id",
            UUID(as_uuid=True),
            sa.ForeignKey("popups.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("items", JSONB, nullable=False, server_default="{}"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("human_id", "popup_id", name="uq_cart_human_popup"),
    )

    # 5. Apply RLS to carts
    add_tenant_table_permissions("carts")


def downgrade():
    # Remove carts
    remove_tenant_table_permissions("carts")
    op.drop_table("carts")

    # Remove insurance_amount from payments
    op.drop_column("payments", "insurance_amount")

    # Remove insurance_percentage from products
    op.drop_column("products", "insurance_percentage")

    # Remove credit from applications
    op.drop_column("applications", "credit")
