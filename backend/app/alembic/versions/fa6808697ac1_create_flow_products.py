"""create flow_products table

Near-verbatim group_products (app/api/group/schemas.py::GroupProductsBase).
Design: sdd/sales-flows D3 — an empty product set for a flow means "all
active popup products"; resolved in sales_flow/resolver.py (a later slice),
never represented as explicit rows here.

Revision ID: fa6808697ac1
Revises: b79d252e79c2
Create Date: 2026-08-03

"""

import sqlalchemy as sa
from alembic import op

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

# revision identifiers, used by Alembic.
revision = "fa6808697ac1"
down_revision = "b79d252e79c2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "flow_products",
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("flow_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["flow_id"], ["sales_flows.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("flow_id", "product_id"),
    )
    op.create_index(
        op.f("ix_flow_products_tenant_id"), "flow_products", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_flow_products_product_id"),
        "flow_products",
        ["product_id"],
        unique=False,
    )

    add_tenant_table_permissions("flow_products")


def downgrade() -> None:
    remove_tenant_table_permissions("flow_products")

    op.drop_index(op.f("ix_flow_products_product_id"), table_name="flow_products")
    op.drop_index(op.f("ix_flow_products_tenant_id"), table_name="flow_products")
    op.drop_table("flow_products")
