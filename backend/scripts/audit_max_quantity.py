#!/usr/bin/env python3
# ruff: noqa: T201
"""Pre-migration audit script for product-inventory-redesign.

Run this READ-ONLY script BEFORE applying the Alembic migration that splits
max_quantity into total_stock_cap / total_stock_remaining / max_per_order.

This script flags three classes of ambiguous products that the architect should
review before migration runs in production:

  A. Tickets with max_quantity AND in a tier group with shared_stock_cap
     → these will get total_stock_cap = NULL (old max_quantity is lost)

  B. Non-standard categories (not housing / merch / ticket)
     → the backfill heuristic does not cover them; admin must decide

  C. Standalone tickets with max_quantity (NOT in a tier group)
     → these WILL be backfilled to total_stock_cap; listed for visibility

No DB writes are performed. Review the output and resolve any concerns before
applying the migration.

Usage:
    cd backend/
    uv run python scripts/audit_max_quantity.py

Environment:
    Reads POSTGRES_* settings from the app config (same as the application).
    Alternatively, set DATABASE_URL to override.
"""

import os
import sys
from typing import Any

# ---------------------------------------------------------------------------
# Database connection
# ---------------------------------------------------------------------------


def _get_engine():
    """Build a SQLAlchemy engine from app settings or DATABASE_URL env var."""
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        try:
            from app.core.config import settings

            database_url = settings.SQLALCHEMY_DATABASE_URI.encoded_string()
        except Exception as exc:
            print(f"ERROR: Could not load app settings: {exc}", file=sys.stderr)
            print(
                "Hint: run from the backend/ directory or set DATABASE_URL.",
                file=sys.stderr,
            )
            sys.exit(1)

    from sqlalchemy import create_engine

    return create_engine(database_url)


# ---------------------------------------------------------------------------
# Audit queries (read-only)
# ---------------------------------------------------------------------------

QUERY_A = """
-- A. Tickets with max_quantity AND in a tier group with shared_stock_cap
--    These will be backfilled to total_stock_cap = NULL (old max_quantity is lost).
--    Review: are admins relying on max_quantity for anything here?
SELECT
    p.id,
    p.name,
    p.popup_id,
    p.category,
    p.max_quantity,
    ttg.id AS tier_group_id,
    ttg.shared_stock_cap
FROM products p
JOIN ticket_tier_phase ttp ON ttp.product_id = p.id
JOIN ticket_tier_group ttg ON ttg.id = ttp.group_id
WHERE p.max_quantity IS NOT NULL
  AND p.deleted_at IS NULL
ORDER BY p.popup_id, p.name;
"""

QUERY_B = """
-- B. Non-standard categories (not housing / merch / ticket) with max_quantity
--    The backfill heuristic does not cover these; admin must decide.
SELECT
    id,
    name,
    popup_id,
    category,
    max_quantity
FROM products
WHERE max_quantity IS NOT NULL
  AND category NOT IN ('housing', 'merch', 'ticket')
  AND deleted_at IS NULL
ORDER BY popup_id, name;
"""

QUERY_C = """
-- C. Standalone tickets with max_quantity (NOT in a tier group)
--    These WILL be backfilled to total_stock_cap = max_quantity.
--    Listed for visibility — verify intent (some may have been used as max_per_order).
SELECT
    p.id,
    p.name,
    p.popup_id,
    p.max_quantity
FROM products p
LEFT JOIN ticket_tier_phase ttp ON ttp.product_id = p.id
WHERE p.max_quantity IS NOT NULL
  AND p.category = 'ticket'
  AND ttp.id IS NULL
  AND p.deleted_at IS NULL
ORDER BY p.popup_id, p.name;
"""


def _run_query(conn: Any, label: str, description: str, sql: str) -> int:
    """Execute a query and print results as a simple text table. Returns row count."""
    # Execute once to get both column names and rows
    result = conn.execute(sql)
    col_names = list(result.keys())
    rows = result.fetchall()

    print(f"\n{'=' * 70}")
    print(f"  {label}")
    print(f"  {description}")
    print(f"{'=' * 70}")

    if not rows:
        print("  (no rows found — safe to proceed)")
        return 0

    print(f"  !! {len(rows)} row(s) flagged — review before migrating !!\n")

    # Simple column-aligned table
    widths = [max(len(str(col_names[i])), max(len(str(r[i])) for r in rows)) for i in range(len(col_names))]
    header = "  " + " | ".join(str(col_names[i]).ljust(widths[i]) for i in range(len(col_names)))
    separator = "  " + "-+-".join("-" * w for w in widths)
    print(header)
    print(separator)
    for row in rows:
        print("  " + " | ".join(str(row[i]).ljust(widths[i]) for i in range(len(col_names))))

    return len(rows)


def main() -> None:
    engine = _get_engine()
    total_flagged = 0

    print("\nproduct-inventory-redesign — Pre-migration audit")
    print("Connecting to DB...")

    with engine.connect() as conn:
        total_flagged += _run_query(
            conn,
            "A — Tier-grouped tickets with max_quantity (will lose max_quantity on migration)",
            "total_stock_cap will be set to NULL; old max_quantity value is discarded.",
            QUERY_A,
        )
        total_flagged += _run_query(
            conn,
            "B — Non-standard category products with max_quantity (heuristic gap)",
            "Backfill heuristic does not cover these. Admin must decide.",
            QUERY_B,
        )
        total_flagged += _run_query(
            conn,
            "C — Standalone ticket products with max_quantity (will be backfilled)",
            "These WILL get total_stock_cap = max_quantity. Confirm intent.",
            QUERY_C,
        )

    print(f"\n{'=' * 70}")
    if total_flagged == 0:
        print("  RESULT: No ambiguous rows found. Migration can proceed safely.")
    else:
        print(
            f"  RESULT: {total_flagged} row(s) flagged across all queries.\n"
            "  Review each category above before running the Alembic migration.\n"
            "  The migration WILL proceed regardless — this script is advisory only."
        )
    print(f"{'=' * 70}\n")


if __name__ == "__main__":
    main()
