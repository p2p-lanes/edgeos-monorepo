"""Smoke tests for the fb7da98c8d72_patron_product_rules migration.

These tests run against the shared session-scoped test DB (already at `head`
after conftest.py ran `alembic upgrade head`). They assert the post-migration
schema is exactly what the migration promises.
"""

from sqlmodel import Session


class TestPatronProductRulesMigration:
    """Schema assertions for the patron-product-rules migration."""

    def test_effective_unit_price_column_exists_and_is_nullable(
        self, db: Session
    ) -> None:
        """payment_products.effective_unit_price must exist and be nullable."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable, data_type, numeric_precision, numeric_scale
            FROM information_schema.columns
            WHERE table_name = 'payment_products'
              AND column_name = 'effective_unit_price'
            """
        ).fetchone()
        assert row is not None, (
            "Column 'effective_unit_price' not found on payment_products. "
            "Run migration fb7da98c8d72 to create it."
        )
        assert row[1] == "YES", (
            "effective_unit_price must be nullable (NULL for non-patreon rows)"
        )
        assert row[2] == "numeric", (
            f"effective_unit_price must be NUMERIC type, got {row[2]}"
        )

    def test_patreon_product_unique_index_exists(self, db: Session) -> None:
        """uq_product_patreon_per_popup partial unique index must exist on products."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE tablename = 'products'
              AND indexname = 'uq_product_patreon_per_popup'
            """
        ).fetchone()
        assert row is not None, (
            "Index 'uq_product_patreon_per_popup' not found on products table. "
            "Run migration fb7da98c8d72."
        )

    def test_patreon_product_unique_index_is_unique(self, db: Session) -> None:
        """uq_product_patreon_per_popup must be a UNIQUE index."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT ix.indisunique
            FROM pg_indexes pi
            JOIN pg_class c ON c.relname = pi.indexname
            JOIN pg_index ix ON ix.indexrelid = c.oid
            WHERE pi.tablename = 'products'
              AND pi.indexname = 'uq_product_patreon_per_popup'
            """
        ).fetchone()
        assert row is not None, "uq_product_patreon_per_popup not found in pg_index"
        assert row[0] is True, "uq_product_patreon_per_popup must be a unique index"

    def test_patron_step_unique_index_exists(self, db: Session) -> None:
        """uq_ticketing_step_patron_per_popup partial unique index must exist on ticketingsteps."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE tablename = 'ticketingsteps'
              AND indexname = 'uq_ticketing_step_patron_per_popup'
            """
        ).fetchone()
        assert row is not None, (
            "Index 'uq_ticketing_step_patron_per_popup' not found on ticketingsteps. "
            "Run migration fb7da98c8d72."
        )

    def test_patron_step_unique_index_is_unique(self, db: Session) -> None:
        """uq_ticketing_step_patron_per_popup must be a UNIQUE index."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT ix.indisunique
            FROM pg_indexes pi
            JOIN pg_class c ON c.relname = pi.indexname
            JOIN pg_index ix ON ix.indexrelid = c.oid
            WHERE pi.tablename = 'ticketingsteps'
              AND pi.indexname = 'uq_ticketing_step_patron_per_popup'
            """
        ).fetchone()
        assert row is not None, (
            "uq_ticketing_step_patron_per_popup not found in pg_index"
        )
        assert row[0] is True, (
            "uq_ticketing_step_patron_per_popup must be a unique index"
        )
