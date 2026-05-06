"""Tests for 0044_ticket_as_first_class_entity migration.

TDD phase: RED — these tests assert post-migration schema + data semantics.
They will FAIL until the migration revision is created and applied.

Spec: C7/migration-explosion, C5/payment-products-uuid-pk
Design: §1 Steps A-G + requires_check_in backfill
"""

from sqlmodel import Session


class TestTicketEntityMigration:
    """Post-migration schema and data invariant tests."""

    # -----------------------------------------------------------------------
    # Schema: attendee_products
    # -----------------------------------------------------------------------

    def test_attendee_products_has_id_column(self, db: Session) -> None:
        """attendee_products must have an id UUID column after migration."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'attendee_products'
              AND column_name = 'id'
            """
        ).fetchone()
        assert row is not None, "Column 'id' not found in attendee_products"
        assert "uuid" in row[1].lower(), f"Expected UUID type, got: {row[1]}"

    def test_attendee_products_has_check_in_code_column(self, db: Session) -> None:
        """attendee_products must have a check_in_code column."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'attendee_products'
              AND column_name = 'check_in_code'
            """
        ).fetchone()
        assert row is not None, "Column 'check_in_code' not found in attendee_products"

    def test_attendee_products_has_payment_id_column(self, db: Session) -> None:
        """attendee_products must have a payment_id UUID column."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'attendee_products'
              AND column_name = 'payment_id'
            """
        ).fetchone()
        assert row is not None, "Column 'payment_id' not found in attendee_products"

    def test_attendee_products_has_no_quantity_column(self, db: Session) -> None:
        """attendee_products must NOT have a quantity column after migration."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'attendee_products'
              AND column_name = 'quantity'
            """
        ).fetchone()
        assert row is None, (
            "Column 'quantity' still exists in attendee_products — migration must drop it"
        )

    def test_attendee_products_pk_is_id(self, db: Session) -> None:
        """attendee_products primary key must be on 'id' only."""
        conn = db.connection()
        rows = conn.exec_driver_sql(
            """
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_name = kcu.table_name
            WHERE tc.table_name = 'attendee_products'
              AND tc.constraint_type = 'PRIMARY KEY'
            """
        ).fetchall()
        pk_columns = {r[0] for r in rows}
        assert pk_columns == {"id"}, (
            f"attendee_products PK must be only 'id', got: {pk_columns}"
        )

    def test_attendee_products_check_in_code_unique_index(self, db: Session) -> None:
        """ux_attendee_products_check_in_code unique index must exist."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE tablename = 'attendee_products'
              AND indexname = 'ux_attendee_products_check_in_code'
            """
        ).fetchone()
        assert row is not None, (
            "Unique index 'ux_attendee_products_check_in_code' not found"
        )

    # -----------------------------------------------------------------------
    # Schema: payment_products
    # -----------------------------------------------------------------------

    def test_payment_products_has_id_column(self, db: Session) -> None:
        """payment_products must have an id UUID column."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'payment_products'
              AND column_name = 'id'
            """
        ).fetchone()
        assert row is not None, "Column 'id' not found in payment_products"
        assert "uuid" in row[1].lower(), f"Expected UUID type, got: {row[1]}"

    def test_payment_products_pk_is_id(self, db: Session) -> None:
        """payment_products primary key must be on 'id' only."""
        conn = db.connection()
        rows = conn.exec_driver_sql(
            """
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_name = kcu.table_name
            WHERE tc.table_name = 'payment_products'
              AND tc.constraint_type = 'PRIMARY KEY'
            """
        ).fetchall()
        pk_columns = {r[0] for r in rows}
        assert pk_columns == {"id"}, (
            f"payment_products PK must be only 'id', got: {pk_columns}"
        )

    # -----------------------------------------------------------------------
    # Schema: attendees.check_in_code nullable
    # -----------------------------------------------------------------------

    def test_attendees_check_in_code_is_nullable(self, db: Session) -> None:
        """attendees.check_in_code must be nullable after migration."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT is_nullable
            FROM information_schema.columns
            WHERE table_name = 'attendees'
              AND column_name = 'check_in_code'
            """
        ).fetchone()
        assert row is not None, "Column 'check_in_code' not found in attendees"
        assert row[0] == "YES", (
            f"attendees.check_in_code must be nullable (YES), got: {row[0]}"
        )

    # -----------------------------------------------------------------------
    # Schema: partial unique index on attendees
    # -----------------------------------------------------------------------

    def test_attendees_partial_unique_index_exists(self, db: Session) -> None:
        """ux_attendees_human_popup_direct partial unique index must exist."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE tablename = 'attendees'
              AND indexname = 'ux_attendees_human_popup_direct'
            """
        ).fetchone()
        assert row is not None, (
            "Partial unique index 'ux_attendees_human_popup_direct' not found"
        )
        assert "where" in row[1].lower(), (
            f"Expected a WHERE clause (partial index), got: {row[1]}"
        )

    # -----------------------------------------------------------------------
    # Schema: products.requires_check_in
    # -----------------------------------------------------------------------

    def test_products_has_requires_check_in_column(self, db: Session) -> None:
        """products must have a requires_check_in boolean column."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, data_type, column_default
            FROM information_schema.columns
            WHERE table_name = 'products'
              AND column_name = 'requires_check_in'
            """
        ).fetchone()
        assert row is not None, "Column 'requires_check_in' not found in products"
        assert "bool" in row[1].lower(), f"Expected boolean type, got: {row[1]}"
