"""Add application fee fields to popups and payment_type to payments.

Adds requires_application_fee and application_fee_amount to popups table.
Adds payment_type to payments table with index.

Revision ID: 0023_application_fee
Revises: 0022_custom_domains
Create Date: 2026-04-06

"""

import sqlalchemy as sa
from alembic import op

revision = "0023_application_fee"
down_revision = "0022_custom_domains"
branch_labels = None
depends_on = None


def upgrade():
    # Add application fee fields to popups
    op.add_column(
        "popups",
        sa.Column(
            "requires_application_fee",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "popups",
        sa.Column(
            "application_fee_amount",
            sa.Numeric(10, 2),
            nullable=True,
        ),
    )

    # Add payment_type to payments
    op.add_column(
        "payments",
        sa.Column(
            "payment_type",
            sa.String(),
            nullable=False,
            server_default="pass_purchase",
        ),
    )
    op.create_index(
        "ix_payments_payment_type",
        "payments",
        ["payment_type"],
    )


def downgrade():
    op.drop_index("ix_payments_payment_type", table_name="payments")
    op.drop_column("payments", "payment_type")
    op.drop_column("popups", "application_fee_amount")
    op.drop_column("popups", "requires_application_fee")
