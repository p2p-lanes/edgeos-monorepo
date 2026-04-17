"""Add settlement currency to payments.

Separates the commercial sale currency from the currency/coin used to settle the
payment, so user-facing documents can stay aligned with popup pricing while
still preserving minimal settlement details.

Revision ID: 9b1f9c8e4d2a
Revises: 7f8b4af4a2c1
Create Date: 2026-04-17

"""

import sqlalchemy as sa
from alembic import op

revision = "9b1f9c8e4d2a"
down_revision = "7f8b4af4a2c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "payments",
        sa.Column("settlement_currency", sa.String(length=16), nullable=True),
    )

    op.execute(
        """
        UPDATE payments AS payment
        SET
            settlement_currency = payment.currency,
            currency = popup.currency
        FROM popups AS popup
        WHERE payment.popup_id = popup.id
          AND payment.source = 'SimpleFI'
          AND payment.currency IS DISTINCT FROM popup.currency
        """
    )


def downgrade() -> None:
    op.drop_column("payments", "settlement_currency")
