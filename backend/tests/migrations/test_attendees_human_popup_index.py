"""Tests for the ix_attendees_human_popup composite index migration.

Verifies:
  1. The index exists on the attendees table after upgrade
  2. The index covers both human_id and popup_id columns (in that order)
  3. The index is dropped cleanly on downgrade (manual verification step)

TDD phase: RED — this test is written BEFORE the migration exists.
It will FAIL until the migration is created and alembic upgrade head is run.
"""

from sqlmodel import Session


class TestAttendeesHumanPopupIndex:
    def test_composite_index_exists_after_migration(self, db: Session) -> None:
        """ix_attendees_human_popup must exist on the attendees table after upgrade head."""
        conn = db.connection()

        row = conn.exec_driver_sql(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE tablename = 'attendees'
              AND indexname = 'ix_attendees_human_popup'
            """,
        ).fetchone()

        assert row is not None, (
            "Index 'ix_attendees_human_popup' not found on table 'attendees'. "
            "Run the migration to create it."
        )

    def test_composite_index_covers_human_id_and_popup_id(self, db: Session) -> None:
        """ix_attendees_human_popup must index (human_id, popup_id) in that order."""
        conn = db.connection()

        row = conn.exec_driver_sql(
            """
            SELECT indexdef
            FROM pg_indexes
            WHERE tablename = 'attendees'
              AND indexname = 'ix_attendees_human_popup'
            """,
        ).fetchone()

        assert row is not None, (
            "Index 'ix_attendees_human_popup' not found on table 'attendees'."
        )

        indexdef = row[0].lower()

        assert "human_id" in indexdef, (
            f"human_id not found in index definition: {indexdef}"
        )
        assert "popup_id" in indexdef, (
            f"popup_id not found in index definition: {indexdef}"
        )

        human_pos = indexdef.index("human_id")
        popup_pos = indexdef.index("popup_id")
        assert human_pos < popup_pos, (
            f"human_id must come before popup_id in index, got: {indexdef}"
        )
