"""Add per-flow SimpleFI pricing overrides.

Revision ID: b73c9e20a451
Revises: 6f702315ea94
"""

import sqlalchemy as sa
from alembic import op

revision = "b73c9e20a451"
down_revision = "6f702315ea94"
branch_labels = None
depends_on = None

FIELDS = (
    "simplefi_card_adjustment_pct",
    "simplefi_crypto_adjustment_pct",
    "simplefi_pay_in_full_adjustment_pct",
    "simplefi_installments_adjustment_pct",
)


def upgrade() -> None:
    for name in FIELDS:
        op.add_column("sales_flows", sa.Column(name, sa.Numeric(5, 2), nullable=True))
        op.create_check_constraint(
            f"ck_sales_flows_{name}", "sales_flows", f"{name} BETWEEN -99 AND 100"
        )


def downgrade() -> None:
    for name in reversed(FIELDS):
        op.drop_constraint(f"ck_sales_flows_{name}", "sales_flows", type_="check")
        op.drop_column("sales_flows", name)
