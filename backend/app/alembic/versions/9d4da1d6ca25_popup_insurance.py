"""popup_insurance: add popup-level insurance fields and product eligibility flag.

Adds:
  - popups.insurance_enabled (bool, NOT NULL, default false)
  - popups.insurance_percentage (numeric(5,2), nullable)
  - products.insurance_eligible (bool, NOT NULL, default false)

Backfill (POPUP-5):
  - products.insurance_eligible = true WHERE legacy insurance_percentage > 0
  - Strict popup backfill: single distinct positive pct across products → promote;
    mixed → leave null/false.
  - Auto-sync insurance_checkout step for promoted popups.

Revision ID: 9d4da1d6ca25
Revises: c7a4e2b1d9f0
Create Date: 2026-04-17 21:48:20.817253
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9d4da1d6ca25"
down_revision: str = "c7a4e2b1d9f0"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add popup insurance columns
    op.add_column(
        "popups",
        sa.Column(
            "insurance_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    op.add_column(
        "popups",
        sa.Column(
            "insurance_percentage",
            sa.Numeric(precision=5, scale=2),
            nullable=True,
        ),
    )

    # 2. Add product eligibility column
    op.add_column(
        "products",
        sa.Column(
            "insurance_eligible",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    # 3. Backfill: products with legacy insurance_percentage > 0 → eligible
    op.execute(
        """
        UPDATE products
        SET insurance_eligible = true
        WHERE insurance_percentage IS NOT NULL
          AND insurance_percentage > 0
        """
    )

    # 4. Strict popup backfill: popups whose insurable products collapse to
    #    exactly one distinct positive percentage → promote.
    op.execute(
        """
        WITH candidate AS (
            SELECT
                p.popup_id,
                COUNT(DISTINCT p.insurance_percentage) AS distinct_pct,
                MAX(p.insurance_percentage)             AS the_pct
            FROM products p
            WHERE p.insurance_percentage IS NOT NULL
              AND p.insurance_percentage > 0
            GROUP BY p.popup_id
            HAVING COUNT(DISTINCT p.insurance_percentage) = 1
        )
        UPDATE popups pop
        SET insurance_enabled    = true,
            insurance_percentage = c.the_pct
        FROM candidate c
        WHERE pop.id = c.popup_id
        """
    )

    # 5. Auto-sync: set insurance_checkout.is_enabled = true for promoted popups
    op.execute(
        """
        UPDATE ticketingsteps ts
        SET is_enabled = true
        FROM popups p
        WHERE ts.popup_id         = p.id
          AND ts.step_type        = 'insurance_checkout'
          AND p.insurance_enabled = true
        """
    )


def downgrade() -> None:
    op.drop_column("popups", "insurance_percentage")
    op.drop_column("popups", "insurance_enabled")
    op.drop_column("products", "insurance_eligible")
