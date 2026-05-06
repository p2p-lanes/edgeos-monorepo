"""Tests for ticket_events migration (addendum #12).

TDD phase: RED — these tests assert post-migration schema for ticket_events table.
They will FAIL until the alembic revision creating ticket_events is applied.

Schema required:
  - id uuid PRIMARY KEY
  - tenant_id uuid NOT NULL FK → tenants(id)
  - attendee_product_id uuid NOT NULL FK → attendee_products(id) ON DELETE CASCADE
  - event_type varchar(32) NOT NULL
  - occurred_at timestamptz NOT NULL DEFAULT now()
  - actor_user_id uuid NULL FK → users(id)
  - payload jsonb NULL
  - created_at timestamptz NOT NULL DEFAULT now()

Indexes required:
  - ix_ticket_events_attendee_product ON ticket_events(attendee_product_id)
  - ix_ticket_events_type_occurred ON ticket_events(event_type, occurred_at)
"""

from sqlmodel import Session


class TestTicketEventsMigration:
    """Post-migration schema tests for ticket_events table."""

    # -----------------------------------------------------------------------
    # Table existence
    # -----------------------------------------------------------------------

    def test_ticket_events_table_exists(self, db: Session) -> None:
        """ticket_events table must exist after migration."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'ticket_events'
            """
        ).fetchone()
        assert row is not None, "Table 'ticket_events' not found in public schema"

    # -----------------------------------------------------------------------
    # Columns
    # -----------------------------------------------------------------------

    def test_ticket_events_has_id_column(self, db: Session) -> None:
        """ticket_events must have id UUID PRIMARY KEY."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'ticket_events'
              AND column_name = 'id'
            """
        ).fetchone()
        assert row is not None, "Column 'id' not found in ticket_events"
        assert "uuid" in row[1].lower(), f"Expected UUID type, got: {row[1]}"

    def test_ticket_events_has_tenant_id_column(self, db: Session) -> None:
        """ticket_events must have tenant_id uuid NOT NULL."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'ticket_events'
              AND column_name = 'tenant_id'
            """
        ).fetchone()
        assert row is not None, "Column 'tenant_id' not found in ticket_events"
        assert row[1] == "NO", "tenant_id must be NOT NULL"

    def test_ticket_events_has_attendee_product_id_column(self, db: Session) -> None:
        """ticket_events must have attendee_product_id uuid NOT NULL."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'ticket_events'
              AND column_name = 'attendee_product_id'
            """
        ).fetchone()
        assert row is not None, "Column 'attendee_product_id' not found in ticket_events"
        assert row[1] == "NO", "attendee_product_id must be NOT NULL"

    def test_ticket_events_has_event_type_column(self, db: Session) -> None:
        """ticket_events must have event_type varchar(32) NOT NULL."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable, character_maximum_length
            FROM information_schema.columns
            WHERE table_name = 'ticket_events'
              AND column_name = 'event_type'
            """
        ).fetchone()
        assert row is not None, "Column 'event_type' not found in ticket_events"
        assert row[1] == "NO", "event_type must be NOT NULL"
        assert row[2] == 32, f"event_type max length must be 32, got: {row[2]}"

    def test_ticket_events_has_occurred_at_column(self, db: Session) -> None:
        """ticket_events must have occurred_at timestamptz NOT NULL."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable, data_type
            FROM information_schema.columns
            WHERE table_name = 'ticket_events'
              AND column_name = 'occurred_at'
            """
        ).fetchone()
        assert row is not None, "Column 'occurred_at' not found in ticket_events"
        assert row[1] == "NO", "occurred_at must be NOT NULL"
        assert "timestamp" in row[2].lower(), f"Expected timestamp type, got: {row[2]}"

    def test_ticket_events_has_actor_user_id_column_nullable(self, db: Session) -> None:
        """ticket_events must have actor_user_id uuid NULL (optional, system events)."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'ticket_events'
              AND column_name = 'actor_user_id'
            """
        ).fetchone()
        assert row is not None, "Column 'actor_user_id' not found in ticket_events"
        assert row[1] == "YES", "actor_user_id must be nullable (NULL = system event)"

    def test_ticket_events_has_payload_column_nullable(self, db: Session) -> None:
        """ticket_events must have payload jsonb NULL."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable, data_type
            FROM information_schema.columns
            WHERE table_name = 'ticket_events'
              AND column_name = 'payload'
            """
        ).fetchone()
        assert row is not None, "Column 'payload' not found in ticket_events"
        assert row[1] == "YES", "payload must be nullable"
        assert "json" in row[2].lower(), f"Expected jsonb type, got: {row[2]}"

    def test_ticket_events_has_created_at_column(self, db: Session) -> None:
        """ticket_events must have created_at timestamptz NOT NULL."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'ticket_events'
              AND column_name = 'created_at'
            """
        ).fetchone()
        assert row is not None, "Column 'created_at' not found in ticket_events"
        assert row[1] == "NO", "created_at must be NOT NULL"

    # -----------------------------------------------------------------------
    # Primary key
    # -----------------------------------------------------------------------

    def test_ticket_events_pk_is_id(self, db: Session) -> None:
        """ticket_events primary key must be on 'id'."""
        conn = db.connection()
        rows = conn.exec_driver_sql(
            """
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_name = kcu.table_name
            WHERE tc.table_name = 'ticket_events'
              AND tc.constraint_type = 'PRIMARY KEY'
            """
        ).fetchall()
        pk_columns = {r[0] for r in rows}
        assert pk_columns == {"id"}, (
            f"ticket_events PK must be only 'id', got: {pk_columns}"
        )

    # -----------------------------------------------------------------------
    # Foreign key constraints
    # -----------------------------------------------------------------------

    def test_ticket_events_fk_attendee_product_cascade(self, db: Session) -> None:
        """ticket_events.attendee_product_id must CASCADE on delete."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT rc.delete_rule
            FROM information_schema.referential_constraints rc
            JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_name = rc.constraint_name
            WHERE kcu.table_name = 'ticket_events'
              AND kcu.column_name = 'attendee_product_id'
            """
        ).fetchone()
        assert row is not None, (
            "FK constraint on ticket_events.attendee_product_id not found"
        )
        assert row[0] == "CASCADE", (
            f"attendee_product_id FK must CASCADE on delete, got: {row[0]}"
        )

    # -----------------------------------------------------------------------
    # Indexes
    # -----------------------------------------------------------------------

    def test_ticket_events_index_attendee_product_exists(self, db: Session) -> None:
        """ix_ticket_events_attendee_product index must exist."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE tablename = 'ticket_events'
              AND indexname = 'ix_ticket_events_attendee_product'
            """
        ).fetchone()
        assert row is not None, (
            "Index 'ix_ticket_events_attendee_product' not found on ticket_events"
        )

    def test_ticket_events_index_type_occurred_exists(self, db: Session) -> None:
        """ix_ticket_events_type_occurred index must exist."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE tablename = 'ticket_events'
              AND indexname = 'ix_ticket_events_type_occurred'
            """
        ).fetchone()
        assert row is not None, (
            "Index 'ix_ticket_events_type_occurred' not found on ticket_events"
        )
