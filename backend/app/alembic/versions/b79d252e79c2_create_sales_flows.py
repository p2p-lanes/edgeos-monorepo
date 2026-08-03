"""create sales_flows table

Design: sdd/sales-flows — config-override layer between popups and every
channel concern. Class B columns are all NULLABLE by contract; NULL means
"read the popup column of the same name" (D1). restriction_rule (Class C)
is added by a later migration (add_flow_restriction_rule).

Revision ID: b79d252e79c2
Revises: b7c9d4a2f18e
Create Date: 2026-08-03

"""

import sqlalchemy as sa
from alembic import op

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

# revision identifiers, used by Alembic.
revision = "b79d252e79c2"
down_revision = "b7c9d4a2f18e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sales_flows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("popup_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(), nullable=False, server_default="application"),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column(
            "visibility", sa.String(), nullable=False, server_default="portal_listed"
        ),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "reviewers_mode", sa.String(), nullable=False, server_default="inherit"
        ),
        sa.Column(
            "identity_mode",
            sa.String(),
            nullable=False,
            server_default="portal_auth",
        ),
        # Class C — flow-only, reserved. Always NULL in v1 (G0 #5).
        sa.Column("status", sa.String(), nullable=True),
        # Class B — inheritable override, all NULLABLE (D1).
        sa.Column("application_layout", sa.String(), nullable=True),
        sa.Column("requires_application_fee", sa.Boolean(), nullable=True),
        sa.Column("application_fee_amount", sa.Numeric(10, 2), nullable=True),
        sa.Column("allows_scholarship", sa.Boolean(), nullable=True),
        sa.Column("allows_incentive", sa.Boolean(), nullable=True),
        sa.Column("allows_coupons", sa.Boolean(), nullable=True),
        sa.Column("open_checkout_success_url", sa.String(), nullable=True),
        sa.Column("open_checkout_cancel_url", sa.String(), nullable=True),
        sa.Column("open_checkout_signing_secret", sa.String(), nullable=True),
        sa.Column("abandoned_cart_delay_days", sa.Integer(), nullable=True),
        sa.Column("abandoned_cart_repeat_days", sa.Integer(), nullable=True),
        sa.Column("abandoned_cart_max_count", sa.Integer(), nullable=True),
        sa.Column("purchase_reminder_delay_days", sa.Integer(), nullable=True),
        sa.Column("purchase_reminder_repeat_days", sa.Integer(), nullable=True),
        sa.Column("purchase_reminder_max_count", sa.Integer(), nullable=True),
        sa.Column("abandoned_application_delay_days", sa.Integer(), nullable=True),
        sa.Column("abandoned_application_repeat_days", sa.Integer(), nullable=True),
        sa.Column("abandoned_application_max_count", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["popup_id"], ["popups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("popup_id", "slug", name="uq_sales_flows_popup_slug"),
        sa.CheckConstraint(
            "type IN ('application', 'direct', 'upsale')",
            name="ck_sales_flows_type",
        ),
        sa.CheckConstraint(
            "visibility IN ('portal_listed', 'direct_url_only')",
            name="ck_sales_flows_visibility",
        ),
        sa.CheckConstraint(
            "reviewers_mode IN ('inherit', 'override')",
            name="ck_sales_flows_reviewers_mode",
        ),
    )
    op.create_index(
        op.f("ix_sales_flows_tenant_id"), "sales_flows", ["tenant_id"], unique=False
    )
    op.create_index(
        op.f("ix_sales_flows_popup_id"), "sales_flows", ["popup_id"], unique=False
    )
    op.create_index(op.f("ix_sales_flows_slug"), "sales_flows", ["slug"], unique=False)
    # Partial unique index: exactly one default flow per popup.
    op.create_index(
        "uq_sales_flows_default_per_popup",
        "sales_flows",
        ["popup_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )

    add_tenant_table_permissions("sales_flows")


def downgrade() -> None:
    remove_tenant_table_permissions("sales_flows")

    op.drop_index("uq_sales_flows_default_per_popup", table_name="sales_flows")
    op.drop_index(op.f("ix_sales_flows_slug"), table_name="sales_flows")
    op.drop_index(op.f("ix_sales_flows_popup_id"), table_name="sales_flows")
    op.drop_index(op.f("ix_sales_flows_tenant_id"), table_name="sales_flows")
    op.drop_table("sales_flows")
