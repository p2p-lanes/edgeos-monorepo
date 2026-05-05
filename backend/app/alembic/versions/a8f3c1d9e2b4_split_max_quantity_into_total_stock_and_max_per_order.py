"""Split max_quantity into total_stock_cap, total_stock_remaining, max_per_order.

Drops products.max_quantity and replaces it with three purpose-specific columns
whose semantics are unambiguous:

  - total_stock_cap:       Admin-set inventory ceiling (NULL = unlimited).
  - total_stock_remaining: Live atomic counter (NULL = unlimited, no tracking).
  - max_per_order:         Per-cart cap (NULL = unlimited; pure validator, no counter).

Backfill heuristic (locked in proposal §"Data migration heuristic"):
  - category IN ('housing', 'merch'):
        total_stock_cap = max_quantity, total_stock_remaining = max_quantity
  - category = 'ticket' AND product NOT in a tier group:
        same as above
  - category = 'ticket' AND product IS in a tier group:
        total_stock_cap = NULL (tier group's shared_stock_cap wins)
  - max_per_order = NULL for ALL existing products (admins set post-migration)

Idempotency: alembic_version table guards against double-execution. The individual
steps (add_column, backfill UPDATE, drop_column) are not wrapped in IF NOT EXISTS
guards — the version table is the idempotency boundary.

Revision ID: a8f3c1d9e2b4
Revises: 0043_tenant_scoped_popup_slug
Create Date: 2026-05-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a8f3c1d9e2b4"
down_revision: str = "0043_tenant_scoped_popup_slug"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Step 1 — add three new nullable columns
    # ------------------------------------------------------------------
    op.add_column("products", sa.Column("total_stock_cap", sa.Integer(), nullable=True))
    op.add_column(
        "products", sa.Column("total_stock_remaining", sa.Integer(), nullable=True)
    )
    op.add_column("products", sa.Column("max_per_order", sa.Integer(), nullable=True))

    # ------------------------------------------------------------------
    # Step 2 — backfill per category heuristic
    #
    # Reads max_quantity BEFORE Step 4 drops it (same-transaction ordering).
    # max_per_order starts NULL for ALL rows — admins set it explicitly later.
    # Tier-grouped tickets keep total_stock_cap = NULL (group cap wins).
    # ------------------------------------------------------------------
    op.execute(
        """
        UPDATE products p
        SET total_stock_cap       = p.max_quantity,
            total_stock_remaining = p.max_quantity
        WHERE p.max_quantity IS NOT NULL
          AND p.deleted_at IS NULL
          AND (
              p.category IN ('housing', 'merch')
              OR (
                  p.category = 'ticket'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM ticket_tier_phase ttp
                      WHERE ttp.product_id = p.id
                  )
              )
          )
        """
    )

    # ------------------------------------------------------------------
    # Step 3 — CHECK constraints (defense in depth; Pydantic also enforces)
    # ------------------------------------------------------------------
    op.create_check_constraint(
        "ck_products_max_per_order_positive",
        "products",
        "max_per_order IS NULL OR max_per_order >= 1",
    )
    op.create_check_constraint(
        "ck_products_total_stock_cap_positive",
        "products",
        "total_stock_cap IS NULL OR total_stock_cap >= 0",
    )
    op.create_check_constraint(
        "ck_products_total_stock_remaining_bounds",
        "products",
        (
            "total_stock_remaining IS NULL OR ("
            "total_stock_remaining >= 0 AND ("
            "total_stock_cap IS NULL OR total_stock_remaining <= total_stock_cap"
            "))"
        ),
    )

    # ------------------------------------------------------------------
    # Step 4 — drop the old column (runs after backfill reads it)
    # ------------------------------------------------------------------
    op.drop_column("products", "max_quantity")


def downgrade() -> None:
    # Best-effort reversal: restore max_quantity from total_stock_cap.
    # Lossy by design — max_per_order semantics cannot be reconstructed.
    op.add_column(
        "products", sa.Column("max_quantity", sa.Integer(), nullable=True)
    )
    op.execute(
        """
        UPDATE products
        SET max_quantity = total_stock_cap
        WHERE total_stock_cap IS NOT NULL
        """
    )
    op.drop_constraint(
        "ck_products_total_stock_remaining_bounds", "products", type_="check"
    )
    op.drop_constraint(
        "ck_products_total_stock_cap_positive", "products", type_="check"
    )
    op.drop_constraint(
        "ck_products_max_per_order_positive", "products", type_="check"
    )
    op.drop_column("products", "max_per_order")
    op.drop_column("products", "total_stock_remaining")
    op.drop_column("products", "total_stock_cap")
