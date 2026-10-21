"""Add inheritable popup SimpleFI pricing defaults."""

import sqlalchemy as sa
from alembic import op

revision = "c84d0f31e672"
down_revision = "b73c9e20a451"
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
        op.add_column("popups", sa.Column(name, sa.Numeric(5, 2), nullable=True))
        op.create_check_constraint(
            f"ck_popups_{name}", "popups", f"{name} BETWEEN -99 AND 100"
        )


def downgrade() -> None:
    for name in reversed(FIELDS):
        op.drop_constraint(f"ck_popups_{name}", "popups", type_="check")
        op.drop_column("popups", name)
