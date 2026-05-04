"""Database invariants that must hold on a healthy schema.

These are the same queries listed in ``docs/events-testing-plan.md`` —
each should return zero rows. They catch data shapes that individual
unit tests miss: inconsistent override links, orphaned state-machine
rows, weekly-hours duplicates, and so on.

File name prefix ``zz_`` is intentional: pytest collects alphabetically
by default, so this module runs *after* every other test file. By then
the session-scoped test DB has accumulated rows from the full suite,
which is when the audit is most informative — any violation left
behind by an upstream test (e.g. forgetting to set ``check_time`` on a
``checked_in`` participant) surfaces here.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlmodel import Session


def _assert_no_rows(db: Session, sql: str, *, description: str) -> None:
    rows = list(db.exec(text(sql)).all())
    assert rows == [], f"DB invariant violated — {description}\nRows: {rows!r}"


class TestEventInvariants:
    """Structural invariants on ``events``."""

    def test_event_is_not_both_master_and_override(self, db: Session) -> None:
        _assert_no_rows(
            db,
            """
            SELECT id
            FROM events
            WHERE rrule IS NOT NULL
              AND recurrence_master_id IS NOT NULL
            """,
            description="event has both rrule and recurrence_master_id",
        )

    def test_every_override_points_to_a_real_master(self, db: Session) -> None:
        _assert_no_rows(
            db,
            """
            SELECT o.id
            FROM events o
            LEFT JOIN events m ON m.id = o.recurrence_master_id
            WHERE o.recurrence_master_id IS NOT NULL
              AND (m.id IS NULL OR m.rrule IS NULL)
            """,
            description="override points at non-master (or missing) row",
        )


class TestParticipantInvariants:
    """Structural invariants on ``event_participants``."""

    def test_checked_in_implies_check_time(self, db: Session) -> None:
        _assert_no_rows(
            db,
            """
            SELECT id
            FROM event_participants
            WHERE status = 'checked_in'
              AND check_time IS NULL
            """,
            description="checked_in participant without check_time",
        )

    def test_active_participants_have_registered_at(self, db: Session) -> None:
        _assert_no_rows(
            db,
            """
            SELECT id
            FROM event_participants
            WHERE status IN ('registered', 'checked_in')
              AND registered_at IS NULL
            """,
            description="active participant missing registered_at",
        )

    def test_max_participant_never_exceeded(self, db: Session) -> None:
        _assert_no_rows(
            db,
            """
            SELECT e.id
            FROM events e
            JOIN (
                SELECT event_id, COUNT(*) AS c
                FROM event_participants
                WHERE status IN ('registered', 'checked_in')
                GROUP BY event_id
            ) p ON p.event_id = e.id
            WHERE e.max_participant IS NOT NULL
              AND p.c > e.max_participant
            """,
            description="event has more active participants than max_participant",
        )

    def test_active_participant_not_on_cancelled_or_draft_event(
        self, db: Session
    ) -> None:
        _assert_no_rows(
            db,
            """
            SELECT p.id
            FROM event_participants p
            JOIN events e ON e.id = p.event_id
            WHERE p.status IN ('registered', 'checked_in')
              AND e.status IN ('cancelled', 'draft')
            """,
            description="active participant attached to cancelled/draft event",
        )


class TestVenueInvariants:
    """Structural invariants on ``venue_weekly_hours`` and ``venue_photos``."""

    def test_weekly_hours_day_of_week_is_unique_per_venue(self, db: Session) -> None:
        _assert_no_rows(
            db,
            """
            SELECT venue_id, day_of_week
            FROM venue_weekly_hours
            GROUP BY venue_id, day_of_week
            HAVING COUNT(*) > 1
            """,
            description="duplicate (venue_id, day_of_week) in venue_weekly_hours",
        )

    def test_venue_photos_never_exceed_ten(self, db: Session) -> None:
        _assert_no_rows(
            db,
            """
            SELECT venue_id
            FROM venue_photos
            GROUP BY venue_id
            HAVING COUNT(*) > 10
            """,
            description="venue has more than 10 photos",
        )
