import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import asc
from sqlmodel import Session, col, func, select

from app.api.event.models import Events
from app.api.event.recurrence import (
    DEFAULT_MAX_OCCURRENCES,
    expand,
    parse_rrule,
    synthetic_occurrence_id,
)
from app.api.event.schemas import EventCreate, EventStatus, EventUpdate
from app.api.shared.crud import BaseCRUD


class EventsCRUD(BaseCRUD[Events, EventCreate, EventUpdate]):
    """CRUD operations for Events."""

    def __init__(self) -> None:
        super().__init__(Events)

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        event_status: EventStatus | None = None,
        kind: str | None = None,
        start_after: datetime | None = None,
        start_before: datetime | None = None,
        venue_id: uuid.UUID | None = None,
        track_id: uuid.UUID | None = None,
        tags: list[str] | None = None,
        search: str | None = None,
        expand_occurrences: bool | None = None,
    ) -> tuple[list[Events], int]:
        """Return events for a popup.

        When ``start_after``/``start_before`` are provided (or ``expand_occurrences``
        is truthy), any rows with an ``rrule`` are expanded in memory and
        pseudo-rows for each occurrence in the window are appended, each
        tagged with a synthetic ``occurrence_id`` attribute.
        """
        statement = select(Events).where(Events.popup_id == popup_id)

        if event_status is not None:
            statement = statement.where(Events.status == event_status)
        if kind is not None:
            statement = statement.where(Events.kind == kind)
        if venue_id is not None:
            statement = statement.where(Events.venue_id == venue_id)
        if track_id is not None:
            statement = statement.where(Events.track_id == track_id)
        if tags:
            # Postgres JSONB ?| operator: any of the provided tags present.
            from sqlalchemy.dialects.postgresql import JSONB

            statement = statement.where(
                Events.tags.cast(JSONB).op("?|")(list(tags))
            )
        if start_after is not None:
            statement = statement.where(Events.start_time >= start_after)
        if start_before is not None:
            statement = statement.where(Events.start_time <= start_before)
        if search:
            statement = statement.where(col(Events.title).ilike(f"%{search}%"))

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.order_by(asc(Events.start_time))
        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        want_expansion = bool(expand_occurrences) or (
            start_after is not None or start_before is not None
        )
        if want_expansion:
            results = _expand_rows_in_window(
                session,
                results,
                window_start=start_after,
                window_end=start_before,
            )

        return results, total

    def find_by_owner(
        self,
        session: Session,
        owner_id: uuid.UUID,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Events], int]:
        return self.find(
            session,
            skip=skip,
            limit=limit,
            sort_by="start_time",
            sort_order="asc",
            owner_id=owner_id,
            popup_id=popup_id,
        )

    def find_venue_conflicts(
        self,
        session: Session,
        venue_id: uuid.UUID,
        window_start: datetime,
        window_end: datetime,
        exclude_event_id: uuid.UUID | None = None,
    ) -> list[Events]:
        """Return events (including expanded occurrences) overlapping the
        window on the given venue.

        The window MUST already include the caller's setup/teardown buffer.
        Overlap rule: existing.start < window_end AND existing.end > window_start.
        Cancelled events are ignored (they free the slot).
        """
        # Pull all potentially-relevant rows. Non-recurring rows can be
        # filtered directly. Recurring masters (rrule IS NOT NULL) need to
        # be expanded on-the-fly since their start_time only marks the
        # first occurrence.
        non_recurring = (
            select(Events)
            .where(Events.venue_id == venue_id)
            .where(Events.status != EventStatus.CANCELLED)
            .where(Events.rrule.is_(None))  # type: ignore[union-attr]
            .where(Events.start_time < window_end)
            .where(Events.end_time > window_start)
        )
        if exclude_event_id is not None:
            non_recurring = non_recurring.where(Events.id != exclude_event_id)
        conflicts: list[Events] = list(session.exec(non_recurring).all())

        recurring = (
            select(Events)
            .where(Events.venue_id == venue_id)
            .where(Events.status != EventStatus.CANCELLED)
            .where(Events.rrule.is_not(None))  # type: ignore[union-attr]
        )
        if exclude_event_id is not None:
            recurring = recurring.where(Events.id != exclude_event_id)

        for master in session.exec(recurring).all():
            if _series_overlaps(master, window_start, window_end):
                conflicts.append(master)
        return conflicts


def compute_booking_window(
    start_time: datetime,
    end_time: datetime,
    setup_minutes: int,
    teardown_minutes: int,
) -> tuple[datetime, datetime]:
    """Expand an event's start/end to include setup + teardown lock."""
    return (
        start_time - timedelta(minutes=max(0, setup_minutes)),
        end_time + timedelta(minutes=max(0, teardown_minutes)),
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _expand_rows_in_window(
    session: Session,
    rows: list[Events],
    *,
    window_start: datetime | None,
    window_end: datetime | None,
) -> list[Events]:
    """Return ``rows`` with series masters expanded to occurrences.

    The returned list contains:
    - Every original non-recurring row unchanged.
    - For each recurring master: the master itself PLUS one pseudo-row per
      occurrence in ``[window_start, window_end]`` (exclusive of the
      master's own start_time, which is already returned as the master).

    Pseudo-rows are NOT SQLAlchemy-attached: they are detached copies with
    ``occurrence_id`` set and ``start_time``/``end_time`` overridden.
    """
    result: list[Events] = []
    # Also fetch materialized overrides (children) for series that appear in
    # this page, keyed by (master_id, start_time) so we can suppress the
    # corresponding generated occurrence (we don't want to list the same
    # instance twice).
    master_ids = [e.id for e in rows if e.rrule]
    override_keys: set[tuple[uuid.UUID, datetime]] = set()
    if master_ids:
        overrides = session.exec(
            select(Events).where(Events.recurrence_master_id.in_(master_ids))  # type: ignore[union-attr]
        ).all()
        for child in overrides:
            if child.recurrence_master_id is None:
                continue
            override_keys.add((child.recurrence_master_id, _strip_tz(child.start_time)))

    for ev in rows:
        result.append(ev)
        if not ev.rrule:
            continue
        try:
            rule = parse_rrule(ev.rrule)
        except ValueError:
            # Skip expansion for unparseable rules — the master row is still
            # returned so the caller sees something rather than silent data
            # loss.
            continue
        if rule is None:
            continue

        duration = ev.end_time - ev.start_time

        occurrences = expand(
            dtstart=ev.start_time,
            rule=rule,
            window_start=window_start,
            window_end=window_end,
            exdates=list(ev.recurrence_exdates or []),
            max_occurrences=DEFAULT_MAX_OCCURRENCES,
        )
        for occ_start in occurrences:
            # Skip the master's own first-instance (returned as the real row).
            if _strip_tz(occ_start) == _strip_tz(ev.start_time):
                continue
            key = (ev.id, _strip_tz(occ_start))
            if key in override_keys:
                continue
            pseudo = _clone_as_occurrence(ev, occ_start, duration)
            result.append(pseudo)

    # Sort merged results by start_time for predictable pagination /
    # client-side calendars.
    result.sort(key=lambda e: e.start_time)
    return result


def _clone_as_occurrence(master: Events, occ_start: datetime, duration: timedelta) -> Events:
    """Build a detached Events instance representing a single occurrence."""
    data = {
        column.name: getattr(master, column.name)
        for column in master.__table__.columns
    }
    data["start_time"] = occ_start
    data["end_time"] = occ_start + duration
    # The clone is NOT its own row in DB — we flag this via occurrence_id.
    clone = Events(**data)
    # Detach from the session so SQLAlchemy doesn't try to persist it.
    try:
        from sqlalchemy.orm import object_session

        sess = object_session(clone)
        if sess is not None:
            sess.expunge(clone)
    except Exception:
        pass
    # Tag with synthetic id for the Public response layer.
    # We use a private attribute name to avoid SQLModel field validation.
    clone.__dict__["_occurrence_id"] = synthetic_occurrence_id(master.id, occ_start)
    return clone


def _series_overlaps(
    master: Events,
    window_start: datetime,
    window_end: datetime,
) -> bool:
    """Return True if any expanded occurrence of ``master`` overlaps window."""
    try:
        rule = parse_rrule(master.rrule)
    except ValueError:
        return False
    if rule is None:
        return False
    duration = master.end_time - master.start_time
    # Expand only within the candidate window (fast path). We pad the window
    # by ``duration`` on the left so events that start before window_start
    # but still overlap it are considered.
    padded_start = window_start - duration
    occurrences = expand(
        dtstart=master.start_time,
        rule=rule,
        window_start=padded_start,
        window_end=window_end,
        exdates=list(master.recurrence_exdates or []),
    )
    for occ in occurrences:
        if occ < window_end and (occ + duration) > window_start:
            return True
    return False


def _strip_tz(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt
    import datetime as _dt

    return dt.astimezone(_dt.UTC).replace(tzinfo=None)


def expanded_events_with_occurrence_id(events: Iterable[Events]) -> list[tuple[Events, str | None]]:
    """Pair each event with its synthetic ``occurrence_id`` (or ``None``)."""
    return [(e, e.__dict__.get("_occurrence_id")) for e in events]


events_crud = EventsCRUD()
