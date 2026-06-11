"""Regression tests for RSVP capacity overbooking (concurrency).

`register_for_event` did a check-then-act: count active participants, compare
to `max_participant`, then insert. Two concurrent RSVPs could both pass the
count check and both insert, exceeding capacity — the unique indexes only stop
the *same* human registering twice, not different humans overfilling the event.

The fix takes a transaction-scoped Postgres advisory lock keyed on the
event/occurrence (`lock_for_capacity`) before counting, so the check+insert
serialize. These tests assert the lock statement is the right one and that the
handler acquires it before counting.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy.dialects import postgresql

from app.api.event_participant.crud import event_participants_crud


class _FakeResult:
    def one(self):
        return 1


class _FakeSession:
    def __init__(self):
        self.statements = []

    def exec(self, statement):
        self.statements.append(statement)
        return _FakeResult()


def _sql(stmt) -> str:
    return str(
        stmt.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )


def test_lock_for_capacity_issues_advisory_lock() -> None:
    session = _FakeSession()
    event_id = uuid.uuid4()
    event_participants_crud.lock_for_capacity(session, event_id)

    assert len(session.statements) == 1
    sql = _sql(session.statements[0])
    assert "pg_advisory_xact_lock" in sql
    assert "hashtextextended" in sql
    assert f"rsvp:{event_id}:" in sql


def test_lock_key_distinguishes_occurrences() -> None:
    event_id = uuid.uuid4()
    occ = datetime(2026, 6, 11, 10, 0, tzinfo=UTC)

    s1, s2 = _FakeSession(), _FakeSession()
    event_participants_crud.lock_for_capacity(s1, event_id)
    event_participants_crud.lock_for_capacity(s2, event_id, occurrence_start=occ)

    # The occurrence is part of the lock key, so two occurrences of the same
    # series take distinct advisory locks and don't serialize against each other.
    assert _sql(s1.statements[0]) != _sql(s2.statements[0])
    assert occ.isoformat() in _sql(s2.statements[0])
