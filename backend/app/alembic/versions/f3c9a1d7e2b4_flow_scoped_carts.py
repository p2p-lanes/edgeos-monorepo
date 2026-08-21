"""Scope carts and historical aliases to the selected sales flow.

Revision ID: f3c9a1d7e2b4
Revises: e2b6a90d4c17
"""

import sqlalchemy as sa
from alembic import op

from app.alembic.utils import add_tenant_table_permissions, remove_tenant_table_permissions

revision = "f3c9a1d7e2b4"
down_revision = "e2b6a90d4c17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("carts", sa.Column("sales_flow_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_carts_sales_flow_id", "carts", "sales_flows", ["sales_flow_id"], ["id"]
    )
    op.drop_constraint("uq_cart_human_popup", "carts", type_="unique")
    op.create_unique_constraint(
        "uq_cart_human_popup_flow", "carts", ["human_id", "popup_id", "sales_flow_id"]
    )
    op.create_index("ix_carts_sales_flow_id", "carts", ["sales_flow_id"])
    op.execute(
        "UPDATE carts AS c SET sales_flow_id = f.id FROM sales_flows AS f "
        "WHERE c.popup_id = f.popup_id AND f.is_default AND c.sales_flow_id IS NULL"
    )
    op.create_table(
        "sales_flow_aliases",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("popup_id", sa.UUID(), nullable=False),
        sa.Column("sales_flow_id", sa.UUID(), nullable=False),
        sa.Column("alias", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["popup_id"], ["popups.id"]),
        sa.ForeignKeyConstraint(["sales_flow_id"], ["sales_flows.id"]),
        sa.UniqueConstraint("popup_id", "alias", name="uq_sales_flow_alias"),
    )
    add_tenant_table_permissions("sales_flow_aliases")


def downgrade() -> None:
    remove_tenant_table_permissions("sales_flow_aliases")
    op.drop_table("sales_flow_aliases")
    op.drop_index("ix_carts_sales_flow_id", table_name="carts")
    op.drop_constraint("uq_cart_human_popup_flow", "carts", type_="unique")
    op.create_unique_constraint("uq_cart_human_popup", "carts", ["human_id", "popup_id"])
    op.drop_constraint("fk_carts_sales_flow_id", "carts", type_="foreignkey")
    op.drop_column("carts", "sales_flow_id")
