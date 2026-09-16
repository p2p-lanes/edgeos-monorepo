"""a coupon belongs to the flow it discounts

Design: sdd/sales-flows-rediseno — the flow-scoped resources, coupons after
groups.

A coupon was found by (code, popup), so one written for a volunteer campaign
was redeemable in every flow the gathering sold through. `validate_coupon`
already took a `flow_id` to decide whether coupons were allowed at all, and
no caller passed one, so that question was answered against the default flow
however the buyer had actually arrived: a flow with coupons switched off
still took them.

Every existing coupon takes its popup's default flow, which is the only flow
its `allows_coupons` check was ever being read from. Uniqueness moves with
it: a code is unique per flow rather than per gathering, so the same word can
mean a different discount in two flows.

That is a real change to what one coupon row means, and it is the honest one.
`current_uses` counts a single row, so a code spanning two flows shared one
allowance between them — "50 uses for volunteers" was never 50. A code wanted
in two flows is now two coupons, and each counts its own.

Any flow type may own a coupon. Unlike an invite or a group, redeeming one
creates nothing; it discounts a sale, and every flow sells.

Revision ID: d9f2b6c48a37
Revises: c4a91e37f5d8
Create Date: 2026-08-07 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "d9f2b6c48a37"
down_revision = "c4a91e37f5d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    op.add_column(
        "coupons",
        sa.Column("sales_flow_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_coupons_sales_flow_id", "coupons", "sales_flows", ["sales_flow_id"], ["id"]
    )
    op.create_index("ix_coupons_sales_flow_id", "coupons", ["sales_flow_id"])

    orphans = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM coupons c "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM sales_flows f "
            "  WHERE f.popup_id = c.popup_id AND f.is_default"
            ")"
        )
    ).scalar()
    if orphans:
        raise RuntimeError(
            "coupons_belong_to_a_flow: "
            f"{orphans} coupon(s) belong to a popup with no default flow"
        )

    conn.execute(
        sa.text(
            "UPDATE coupons c SET sales_flow_id = f.id "
            "FROM sales_flows f "
            "WHERE f.popup_id = c.popup_id AND f.is_default"
        )
    )

    op.alter_column(
        "coupons",
        "sales_flow_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )

    # Every row moved to one flow per popup, so no two rows can collide here.
    op.drop_constraint("uq_coupon_code_popup_id", "coupons", type_="unique")
    op.create_unique_constraint(
        "uq_coupon_code_sales_flow_id", "coupons", ["code", "sales_flow_id"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_coupon_code_sales_flow_id", "coupons", type_="unique")
    op.create_unique_constraint(
        "uq_coupon_code_popup_id", "coupons", ["code", "popup_id"]
    )
    op.drop_index("ix_coupons_sales_flow_id", table_name="coupons")
    op.drop_constraint("fk_coupons_sales_flow_id", "coupons", type_="foreignkey")
    op.drop_column("coupons", "sales_flow_id")
