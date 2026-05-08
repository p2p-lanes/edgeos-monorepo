"""drop_tier_groups_use_sale_windows: migration 0045 (additive-only)

Adds native sale window columns to products and backfills them from the
existing ticket_tier_phase rows. This migration is purely ADDITIVE — it does
NOT drop any tables or columns. The actual drops of ticket_tier_phase,
ticket_tier_group, popups.tier_progression_enabled, products.start_date, and
products.end_date happen in migration 0046 (PR 2), AFTER the live code that
queries those tables/columns has been removed.

Steps (ADR-3 — order is critical):
  1. ADD products.sale_starts_at TIMESTAMPTZ NULL
  2. ADD products.sale_ends_at   TIMESTAMPTZ NULL
  3. BACKFILL sale window from ticket_tier_phase (10 rows in production)
  4. BACKFILL product name with phase label where not already present

downgrade() raises NotImplementedError — forward-only per NG7.

Revision ID: a1b9c3d7e5f2
Revises: 3f8a1c9e4b2d
Create Date: 2026-05-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import TIMESTAMP

# revision identifiers, used by Alembic.
revision: str = "a1b9c3d7e5f2"
down_revision: str = "c5e9d3b2f8a0"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # -------------------------------------------------------------------------
    # 1 & 2 — Add new sale window columns to products
    # -------------------------------------------------------------------------
    op.add_column(
        "products",
        sa.Column(
            "sale_starts_at",
            TIMESTAMP(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "products",
        sa.Column(
            "sale_ends_at",
            TIMESTAMP(timezone=True),
            nullable=True,
        ),
    )

    # -------------------------------------------------------------------------
    # 3 — Backfill sale window from ticket_tier_phase
    #
    # Critical ordering invariant: this UPDATE must run BEFORE dropping
    # ticket_tier_phase (step 5). We read the phase's window columns and copy
    # them onto the linked product row (one phase per product, enforced by UNIQUE).
    # -------------------------------------------------------------------------
    op.execute(
        sa.text(
            """
            UPDATE products p
               SET sale_starts_at = ph.sale_starts_at,
                   sale_ends_at   = ph.sale_ends_at
              FROM ticket_tier_phase ph
             WHERE ph.product_id = p.id
            """
        )
    )

    # -------------------------------------------------------------------------
    # 4 — Backfill product name with phase label (idempotent guard)
    #
    # Append ' — <label>' only when the label does not already appear in the
    # product name. POSITION returns 0 when the substring is absent.
    # This preserves the visual "phase label — product name" appearance that
    # admins relied on in the tier group editor.
    # -------------------------------------------------------------------------
    op.execute(
        sa.text(
            """
            UPDATE products p
               SET name = p.name || ' — ' || ph.label
              FROM ticket_tier_phase ph
             WHERE ph.product_id = p.id
               AND POSITION(ph.label IN p.name) = 0
            """
        )
    )

    # Drops of ticket_tier_phase, ticket_tier_group, products.start_date,
    # products.end_date, and popups.tier_progression_enabled are deferred to
    # migration 0046 (PR 2) — they require the live code that queries them
    # (tier_router, _resolve_tier_group, _decrement_shared_tier_stocks,
    # enrich_product_with_tier) to be removed first to avoid runtime errors.


def downgrade() -> None:
    raise NotImplementedError(
        "Migration a1b9c3d7e5f2 is forward-only. "
        "To reverse, restore the database from the pre-deploy backup."
    )
