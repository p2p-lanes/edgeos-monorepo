"""Pre-migration audit — fails non-zero if duplicates exist in (human_id, popup_id)
for direct-sale attendees. Run BEFORE applying the ticket-as-first-class-entity
migration. Refuse to deploy if exit code != 0.

Usage:
    cd backend
    uv run python -m scripts.audit_attendee_uniqueness

Deploy runbook gate:
    Run this script and require exit code 0 before applying the migration.
    If exit code != 0, reconcile the duplicate rows manually and re-run.
"""

import sys

from sqlalchemy.engine import Engine
from sqlmodel import Session, func, select

from app.api.attendee.models import Attendees
from app.core.db import engine as _default_engine

DUPLICATE_QUERY = (
    select(
        Attendees.human_id,
        Attendees.popup_id,
        func.count().label("dup_count"),
    )
    .where(
        Attendees.application_id.is_(None),  # type: ignore[union-attr]
        Attendees.human_id.is_not(None),  # type: ignore[union-attr]
    )
    .group_by(Attendees.human_id, Attendees.popup_id)
    .having(func.count() > 1)
)


def main(engine: Engine | None = None) -> int:
    """Run the duplicate-attendee audit.

    Args:
        engine: SQLAlchemy engine to use. Defaults to the production engine from
                app.core.db. Pass a test engine in tests.

    Returns:
        0 if no duplicates found, 1 otherwise.
    """
    _engine = engine if engine is not None else _default_engine
    with Session(_engine) as session:
        rows = session.exec(DUPLICATE_QUERY).all()
        if rows:
            print(f"FAIL: {len(rows)} duplicate (human_id, popup_id) pairs found")
            for row in rows:
                print(f"  human={row.human_id} popup={row.popup_id} count={row.dup_count}")
            return 1
        print("OK: no direct-sale attendee duplicates")
        return 0


if __name__ == "__main__":
    sys.exit(main())
