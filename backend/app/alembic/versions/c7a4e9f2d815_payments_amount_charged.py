"""Add payments.amount_charged — actual settled total from SimpleFi.

SimpleFi merchants can configure signed per-rail price adjustments (card /
crypto), so the amount the buyer is actually charged can differ from the
quoted ``payments.amount``. This column records the charged total in the
payment's fiat currency, filled from settlement webhooks:

  regular payments     — card: card_payment.price_details.final_amount;
                         crypto: the request's crypto-rail adjusted total
  installment payments — accumulated per installment as each one settles

NULL for unsettled and non-SimpleFi payments; revenue reporting reads
COALESCE(amount_charged, amount).

Revision ID: c7a4e9f2d815
Revises: e09ad276878b
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c7a4e9f2d815"
down_revision: str | Sequence[str] | None = "e09ad276878b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "payments",
        sa.Column("amount_charged", sa.Numeric(10, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("payments", "amount_charged")
