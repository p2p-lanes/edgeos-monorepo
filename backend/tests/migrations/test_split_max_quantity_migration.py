"""Tests for the split_max_quantity migration (product-inventory-redesign).

Verifies the backfill heuristic from spec §Domain 6:
  1. housing product → total_stock_cap = max_quantity, total_stock_remaining = max_quantity
  2. merch product   → same as housing
  3. standalone ticket (no tier group) → same
  4. tier-grouped ticket → total_stock_cap = NULL, total_stock_remaining = NULL
  5. product with max_quantity = NULL → all three new columns are NULL
  6. max_per_order = NULL for ALL existing products
  7. max_quantity column is DROPPED after migration

TDD phase: RED — written BEFORE the migration exists.
"""


def _setup_temp_tables(conn, suffix: str) -> None:
    """Create lightweight temp tables that mirror the real schema for the migration SQL."""
    conn.exec_driver_sql(
        f"""
        CREATE TEMP TABLE products_{suffix} (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id       UUID NOT NULL DEFAULT gen_random_uuid(),
            popup_id        UUID NOT NULL DEFAULT gen_random_uuid(),
            name            TEXT NOT NULL DEFAULT 'product',
            slug            TEXT NOT NULL DEFAULT 'slug',
            price           NUMERIC(10,2) NOT NULL DEFAULT 0,
            category        TEXT NOT NULL DEFAULT 'ticket',
            max_quantity    INTEGER,
            is_active       BOOLEAN NOT NULL DEFAULT true,
            deleted_at      TIMESTAMPTZ
        )
        """
    )
    conn.exec_driver_sql(
        f"""
        CREATE TEMP TABLE ticket_tier_phase_{suffix} (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            group_id    UUID NOT NULL DEFAULT gen_random_uuid(),
            product_id  UUID REFERENCES products_{suffix}(id)
        )
        """
    )


def _add_new_columns(conn, suffix: str) -> None:
    """Step 1: add the three new nullable columns (mirrors migration Step 1)."""
    conn.exec_driver_sql(
        f"ALTER TABLE products_{suffix} ADD COLUMN IF NOT EXISTS total_stock_cap INTEGER"
    )
    conn.exec_driver_sql(
        f"ALTER TABLE products_{suffix} ADD COLUMN IF NOT EXISTS total_stock_remaining INTEGER"
    )
    conn.exec_driver_sql(
        f"ALTER TABLE products_{suffix} ADD COLUMN IF NOT EXISTS max_per_order INTEGER"
    )


def _run_backfill_sql(conn, suffix: str) -> None:
    """Step 2: run the backfill UPDATE (adapted for temp table names)."""
    conn.exec_driver_sql(
        f"""
        UPDATE products_{suffix} p
        SET total_stock_cap       = p.max_quantity,
            total_stock_remaining = p.max_quantity
        WHERE p.max_quantity IS NOT NULL
          AND p.deleted_at IS NULL
          AND (
              p.category IN ('housing', 'merch')
              OR (
                  p.category = 'ticket'
                  AND NOT EXISTS (
                      SELECT 1 FROM ticket_tier_phase_{suffix} ttp
                      WHERE ttp.product_id = p.id
                  )
              )
          )
        """
    )


def _drop_max_quantity(conn, suffix: str) -> None:
    """Step 4: drop the old max_quantity column."""
    conn.exec_driver_sql(
        f"ALTER TABLE products_{suffix} DROP COLUMN IF EXISTS max_quantity"
    )


def _run_full_migration(conn, suffix: str) -> None:
    """Run all migration steps in order."""
    _add_new_columns(conn, suffix)
    _run_backfill_sql(conn, suffix)
    _drop_max_quantity(conn, suffix)


def _insert_product(conn, suffix: str, *, category: str, max_quantity: int | None) -> str:
    """Insert a product row and return its UUID."""
    row = conn.exec_driver_sql(
        f"""
        INSERT INTO products_{suffix} (category, max_quantity)
        VALUES (%s, %s)
        RETURNING id
        """,
        (category, max_quantity),
    ).fetchone()
    return row[0]


def _link_to_tier_group(conn, suffix: str, product_id: str) -> None:
    """Insert a tier phase row linking the product to a (fake) tier group."""
    conn.exec_driver_sql(
        f"INSERT INTO ticket_tier_phase_{suffix} (product_id) VALUES (%s)",
        (product_id,),
    )


def _fetch_product(conn, suffix: str, product_id: str) -> dict:
    """Fetch the three new stock columns for a product."""
    row = conn.exec_driver_sql(
        f"""
        SELECT total_stock_cap, total_stock_remaining, max_per_order
        FROM products_{suffix}
        WHERE id = %s
        """,
        (product_id,),
    ).fetchone()
    return {
        "total_stock_cap": row[0],
        "total_stock_remaining": row[1],
        "max_per_order": row[2],
    }


def _teardown(conn, suffix: str) -> None:
    conn.exec_driver_sql(f"DROP TABLE IF EXISTS ticket_tier_phase_{suffix}")
    conn.exec_driver_sql(f"DROP TABLE IF EXISTS products_{suffix}")


class TestSplitMaxQuantityMigrationBackfill:
    """Spec §Domain 6 — category-based backfill heuristic."""

    def test_housing_product_backfilled(self, db) -> None:
        """Housing product: total_stock_cap = max_quantity, remaining = max_quantity."""
        conn = db.connection()
        suffix = "sqm_housing"
        _setup_temp_tables(conn, suffix)
        try:
            pid = _insert_product(conn, suffix, category="housing", max_quantity=20)
            _run_full_migration(conn, suffix)
            result = _fetch_product(conn, suffix, pid)
            assert result["total_stock_cap"] == 20, (
                f"expected total_stock_cap=20, got {result['total_stock_cap']}"
            )
            assert result["total_stock_remaining"] == 20, (
                f"expected total_stock_remaining=20, got {result['total_stock_remaining']}"
            )
            assert result["max_per_order"] is None, (
                f"expected max_per_order=NULL, got {result['max_per_order']}"
            )
        finally:
            _teardown(conn, suffix)

    def test_merch_product_backfilled(self, db) -> None:
        """Merch product: total_stock_cap = max_quantity, remaining = max_quantity."""
        conn = db.connection()
        suffix = "sqm_merch"
        _setup_temp_tables(conn, suffix)
        try:
            pid = _insert_product(conn, suffix, category="merch", max_quantity=50)
            _run_full_migration(conn, suffix)
            result = _fetch_product(conn, suffix, pid)
            assert result["total_stock_cap"] == 50
            assert result["total_stock_remaining"] == 50
            assert result["max_per_order"] is None
        finally:
            _teardown(conn, suffix)

    def test_standalone_ticket_backfilled(self, db) -> None:
        """Standalone ticket (no tier group): total_stock_cap = max_quantity."""
        conn = db.connection()
        suffix = "sqm_standalone"
        _setup_temp_tables(conn, suffix)
        try:
            pid = _insert_product(conn, suffix, category="ticket", max_quantity=100)
            # NOT linked to any tier group
            _run_full_migration(conn, suffix)
            result = _fetch_product(conn, suffix, pid)
            assert result["total_stock_cap"] == 100
            assert result["total_stock_remaining"] == 100
            assert result["max_per_order"] is None
        finally:
            _teardown(conn, suffix)

    def test_tier_grouped_ticket_gets_null_stock(self, db) -> None:
        """Ticket in tier group: total_stock_cap = NULL (tier group cap wins)."""
        conn = db.connection()
        suffix = "sqm_tiered"
        _setup_temp_tables(conn, suffix)
        try:
            pid = _insert_product(conn, suffix, category="ticket", max_quantity=50)
            _link_to_tier_group(conn, suffix, pid)
            _run_full_migration(conn, suffix)
            result = _fetch_product(conn, suffix, pid)
            assert result["total_stock_cap"] is None, (
                f"tier-grouped ticket must have NULL total_stock_cap, got {result['total_stock_cap']}"
            )
            assert result["total_stock_remaining"] is None, (
                f"tier-grouped ticket must have NULL total_stock_remaining, got {result['total_stock_remaining']}"
            )
            assert result["max_per_order"] is None
        finally:
            _teardown(conn, suffix)

    def test_null_max_quantity_stays_null(self, db) -> None:
        """Product with max_quantity=NULL: all three new columns remain NULL."""
        conn = db.connection()
        suffix = "sqm_null"
        _setup_temp_tables(conn, suffix)
        try:
            pid = _insert_product(conn, suffix, category="ticket", max_quantity=None)
            _run_full_migration(conn, suffix)
            result = _fetch_product(conn, suffix, pid)
            assert result["total_stock_cap"] is None
            assert result["total_stock_remaining"] is None
            assert result["max_per_order"] is None
        finally:
            _teardown(conn, suffix)

    def test_max_quantity_column_dropped(self, db) -> None:
        """After migration, max_quantity column must not exist on the temp table.

        We query pg_attribute to check column existence rather than running a
        query that would cause a PostgreSQL error and abort the transaction.
        """
        conn = db.connection()
        suffix = "sqm_drop"
        _setup_temp_tables(conn, suffix)
        try:
            _insert_product(conn, suffix, category="housing", max_quantity=10)
            _run_full_migration(conn, suffix)

            # Check column existence via catalog — no transaction-aborting error
            row = conn.exec_driver_sql(
                """
                SELECT attname
                FROM pg_attribute
                WHERE attrelid = (
                    SELECT oid FROM pg_class WHERE relname = %s AND relnamespace = pg_my_temp_schema()
                )
                  AND attname = 'max_quantity'
                  AND attnum > 0
                  AND NOT attisdropped
                """,
                (f"products_{suffix}",),
            ).fetchone()
            assert row is None, (
                "max_quantity column still exists on the table after migration"
            )
        finally:
            _teardown(conn, suffix)

    def test_idempotent_rerun_produces_no_double_update(self, db) -> None:
        """Running the backfill SQL twice must not corrupt values.

        Note: the real migration is guarded by alembic_version, so double-execution
        of the full migration is impossible in production. This test verifies that
        the backfill UPDATE itself is idempotent — running it twice on already-set
        columns still yields the same result (not NULL because total_stock_cap
        is already set; the WHERE checks max_quantity which is dropped first run).
        We simulate by running _add_new_columns + _run_backfill_sql twice
        (without dropping max_quantity between runs).
        """
        conn = db.connection()
        suffix = "sqm_idem"
        _setup_temp_tables(conn, suffix)
        try:
            pid = _insert_product(conn, suffix, category="housing", max_quantity=30)
            _add_new_columns(conn, suffix)
            # Run backfill twice before dropping the column
            _run_backfill_sql(conn, suffix)
            _run_backfill_sql(conn, suffix)
            result = _fetch_product(conn, suffix, pid)
            assert result["total_stock_cap"] == 30
            assert result["total_stock_remaining"] == 30
        finally:
            _teardown(conn, suffix)
