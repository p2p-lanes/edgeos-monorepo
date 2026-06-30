import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import asc, or_, text
from sqlmodel import Session, col, delete, func, select

from app.api.event.models import EventHiddenByHuman, EventInvitations, Events
from app.api.event.recurrence import (
    DEFAULT_MAX_OCCURRENCES,
    expand,
    parse_rrule,
    synthetic_occurrence_id,
)
from app.api.event.schemas import EventCreate, EventStatus, EventUpdate, EventVisibility
from app.api.human.models import Humans
from app.api.shared.crud import BaseCRUD


class EventsCRUD(BaseCRUD[Events, EventCreate, EventUpdate]):
    """CRUD operations for Events."""

    def __init__(self) -> None:
        super().__init__(Events)

    def get_detached_child(
        self,
        session: Session,
        master_id: uuid.UUID,
        occ_start: datetime,
    ) -> Events | None:
        """Return the already-materialized override for a given occurrence.

        A detached override is a child row with ``recurrence_master_id ==
        master_id`` whose ``start_time`` equals the occurrence. Matching uses
        ``_strip_tz`` so it mirrors how the series expander keys overrides
        (see ``_expand_rows_with_occurrences``), making detach idempotent: a
        retry of the same occurrence finds the existing child instead of
        creating a duplicate. Returns ``None`` when no override exists yet.
        """
        target = _strip_tz(occ_start)
        statement = select(Events).where(Events.recurrence_master_id == master_id)
        for child in session.exec(statement).all():
            if _strip_tz(child.start_time) == target:
                return child
        return None

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int | None = 100,
        event_status: EventStatus | None = None,
        kind: str | None = None,
        start_after: datetime | None = None,
        start_before: datetime | None = None,
        venue_id: uuid.UUID | None = None,
        venue_ids: list[uuid.UUID] | None = None,
        location_kind: str | None = None,
        track_ids: list[uuid.UUID] | None = None,
        owner_id: uuid.UUID | None = None,
        managed_by_human_id: uuid.UUID | None = None,
        tags: list[str] | None = None,
        search: str | None = None,
        visibility: EventVisibility | None = None,
        exclude_visibility: list[EventVisibility] | None = None,
        exclude_statuses: list[EventStatus] | None = None,
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
        if exclude_statuses:
            statement = statement.where(col(Events.status).not_in(exclude_statuses))
        if visibility is not None:
            statement = statement.where(Events.visibility == visibility)
        if exclude_visibility:
            statement = statement.where(
                col(Events.visibility).not_in(exclude_visibility)
            )
        if kind is not None:
            statement = statement.where(Events.kind == kind)
        if venue_id is not None:
            statement = statement.where(Events.venue_id == venue_id)
        if venue_ids:
            statement = statement.where(col(Events.venue_id).in_(venue_ids))
        if location_kind == "custom":
            # No venue + a custom_location_name (e.g. a Google Maps link).
            statement = statement.where(Events.venue_id.is_(None))  # type: ignore[union-attr]
            statement = statement.where(Events.custom_location_name.is_not(None))  # type: ignore[union-attr]
        elif location_kind == "meeting":
            # Online-only meetings: no venue and no custom location.
            statement = statement.where(Events.venue_id.is_(None))  # type: ignore[union-attr]
            statement = statement.where(Events.custom_location_name.is_(None))  # type: ignore[union-attr]
        if track_ids:
            statement = statement.where(col(Events.track_id).in_(track_ids))
        if owner_id is not None:
            statement = statement.where(Events.owner_id == owner_id)
        if managed_by_human_id is not None:
            # Events the human manages: owner, designated host, or a listed
            # collaborator. Pushed into SQL so pagination counts the managed
            # set (not a post-filtered page) — otherwise a managed event past
            # the limit would never be fetched. ``collaborator_ids`` is a
            # native uuid[], so ``= ANY(...)`` checks membership.
            statement = statement.where(
                or_(
                    Events.owner_id == managed_by_human_id,
                    Events.host_id == managed_by_human_id,
                    col(Events.collaborator_ids).any(managed_by_human_id),
                )
            )
        if tags:
            # Postgres JSONB ?| operator: any of the provided tags present.
            # The right operand must be text[] — wrapping with array() makes
            # it render as ARRAY['a','b'] instead of being bound as JSONB
            # (which would fail with "operator does not exist: jsonb ?| jsonb").
            from sqlalchemy.dialects.postgresql import array

            statement = statement.where(Events.tags.op("?|")(array(list(tags))))
        # Recurring masters (``rrule IS NOT NULL``) must bypass the start_time
        # window filter: a series whose master row starts before the window
        # can still have occurrences inside it. ``_expand_rows_in_window``
        # narrows them down in memory after expansion.
        if start_after is not None:
            statement = statement.where(
                or_(
                    Events.rrule.is_not(None),  # type: ignore[union-attr]
                    Events.start_time >= start_after,
                )
            )
        if start_before is not None:
            statement = statement.where(
                or_(
                    Events.rrule.is_not(None),  # type: ignore[union-attr]
                    Events.start_time <= start_before,
                )
            )
        if search:
            statement = statement.where(col(Events.title).ilike(f"%{search}%"))

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        # Order by start_time with ``id`` as a unique tiebreaker so the row
        # order is deterministic across requests. Without the tiebreaker,
        # events sharing a start_time order arbitrarily, which makes any
        # offset/limit paging unstable (the same boundary row can repeat or
        # vanish between pages).
        statement = statement.order_by(asc(Events.start_time), asc(Events.id))
        # ``limit=None`` returns the full filtered set in one query (no paging
        # boundaries). The portal events list uses this so recurring expansion
        # runs once over the complete window instead of per page.
        if limit is not None:
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

    def find_in_range_expanded(
        self,
        session: Session,
        popup_id: uuid.UUID,
        *,
        start_after: datetime | None = None,
        start_before: datetime | None = None,
        event_status: EventStatus | None = None,
        search: str | None = None,
        tags: list[str] | None = None,
        track_ids: list[uuid.UUID] | None = None,
        venue_ids: list[uuid.UUID] | None = None,
        managed_by_human_id: uuid.UUID | None = None,
    ) -> list[Events]:
        """Return occurrence-expanded events in a window for a popup.

        Applies the same filters as ``find_by_popup`` (including the
        recurring-master OR bypass so series starting before the window
        are still expanded) but without pagination — a month-sized window
        is naturally bounded.  Results are ordered by ``start_time`` asc
        and fully expanded via ``_expand_rows_in_window``.
        """
        statement = select(Events).where(Events.popup_id == popup_id)

        if event_status is not None:
            statement = statement.where(Events.status == event_status)
        if managed_by_human_id is not None:
            # Events the human manages: owner, designated host, or a listed
            # collaborator. Pushed into SQL so the "My events" calendar matches
            # the list view's managed channel.
            statement = statement.where(
                or_(
                    Events.owner_id == managed_by_human_id,
                    Events.host_id == managed_by_human_id,
                    col(Events.collaborator_ids).any(managed_by_human_id),
                )
            )
        if track_ids:
            statement = statement.where(col(Events.track_id).in_(track_ids))
        if venue_ids:
            statement = statement.where(col(Events.venue_id).in_(venue_ids))
        if tags:
            from sqlalchemy.dialects.postgresql import array

            statement = statement.where(Events.tags.op("?|")(array(list(tags))))
        if start_after is not None:
            statement = statement.where(
                or_(
                    Events.rrule.is_not(None),  # type: ignore[union-attr]
                    Events.start_time >= start_after,
                )
            )
        if start_before is not None:
            statement = statement.where(
                or_(
                    Events.rrule.is_not(None),  # type: ignore[union-attr]
                    Events.start_time <= start_before,
                )
            )
        if search:
            statement = statement.where(col(Events.title).ilike(f"%{search}%"))

        statement = statement.order_by(asc(Events.start_time))
        results = list(session.exec(statement).all())

        return _expand_rows_in_window(
            session,
            results,
            window_start=start_after,
            window_end=start_before,
        )

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

    def list_distinct_tags(
        self,
        db: Session,
        *,
        popup_id: uuid.UUID,
        only_published_public: bool = False,
    ) -> list[str]:
        """Distinct event tags within a popup, sorted case-insensitive.

        ``only_published_public=True`` matches the public-calendar visibility
        so anonymous users don't see tags that only exist in drafts.
        """
        # ``status`` and ``visibility`` are stored as the Python ``Enum``
        # NAMES (uppercase) via SQLAlchemy's native Enum, not the lowercase
        # values exposed in the schema. Filter against the stored form.
        sql = """
            SELECT DISTINCT btrim(tag) AS tag
            FROM events,
                 jsonb_array_elements_text(events.tags) AS tag
            WHERE events.popup_id = :popup_id
              AND events.status != 'CANCELLED'
        """
        if only_published_public:
            sql += " AND events.status = 'PUBLISHED' AND events.visibility = 'PUBLIC'"
        rows = db.exec(text(sql).bindparams(popup_id=popup_id)).all()
        tags: list[str] = []
        for row in rows:
            # SQLAlchemy 2.x ``Row`` is tuple-like but not a ``tuple``
            # subclass; index the first column directly.
            value = row[0]
            if value is None:
                continue
            cleaned = str(value).strip()
            if cleaned:
                tags.append(cleaned)
        # Dedup again post-trim (DISTINCT didn't see the trim) and sort
        # case-insensitively for stable, human-friendly ordering.
        return sorted(set(tags), key=lambda s: s.casefold())

    def count_published_events_by_track(
        self, db: Session, *, popup_id: uuid.UUID
    ) -> dict[uuid.UUID, int]:
        """Distinct published events per track for a popup, across all history.

        Backs the portal track filter / Tracks section so it can show each
        track's event count without pulling every event to the client and
        counting on the front (which also capped at the page limit). Counts
        distinct event ids so recurring masters aren't inflated. ``status`` is
        stored as the uppercase Enum name, so filter against that form.
        """
        sql = """
            SELECT track_id, COUNT(DISTINCT id) AS event_count
            FROM events
            WHERE popup_id = :popup_id
              AND track_id IS NOT NULL
              AND status = 'PUBLISHED'
            GROUP BY track_id
        """
        rows = db.exec(text(sql).bindparams(popup_id=popup_id)).all()
        return {row[0]: int(row[1]) for row in rows}

    def count_published_events_by_venue(
        self, db: Session, *, popup_id: uuid.UUID
    ) -> list[tuple[uuid.UUID, str, int]]:
        """Distinct published events per venue for a popup, across all history.

        Backs the portal venue filter so it can show each venue's event count
        and hide venues with no events without pulling the full event list to
        the client. Joins ``event_venues`` for the title so the filter has a
        label without a second query. Counts distinct event ids so recurring
        masters aren't inflated. ``status`` is stored as the uppercase Enum
        name, so filter against that form.
        """
        sql = """
            SELECT e.venue_id, v.title AS venue_title,
                   COUNT(DISTINCT e.id) AS event_count
            FROM events e
            JOIN event_venues v ON v.id = e.venue_id
            WHERE e.popup_id = :popup_id
              AND e.venue_id IS NOT NULL
              AND e.status = 'PUBLISHED'
            GROUP BY e.venue_id, v.title
        """
        rows = db.exec(text(sql).bindparams(popup_id=popup_id)).all()
        return [(row[0], row[1], int(row[2])) for row in rows]

    def list_distinct_hosts(
        self,
        session: Session,
        *,
        popup_id: uuid.UUID,
    ) -> list[Humans]:
        """Distinct hosts (Humans referenced by ``Events.owner_id``) within a popup.

        Joins ``Events.owner_id`` to ``Humans.id`` so events whose owner is not
        a human (e.g. backoffice-created events owned by a staff User) are
        naturally excluded — those have no host to filter by. Sorted by name
        then email for a stable, human-friendly picker.
        """
        statement = (
            select(Humans)
            .join(Events, Events.owner_id == Humans.id)  # type: ignore[arg-type]
            .where(Events.popup_id == popup_id)
            .distinct()
        )
        humans = list(session.exec(statement).all())
        return sorted(
            humans,
            key=lambda h: (
                f"{h.first_name or ''} {h.last_name or ''}".strip().casefold()
                or h.email.casefold(),
                h.email.casefold(),
            ),
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
        Draft, cancelled and rejected events are ignored (they free the slot).
        """
        # Pull all potentially-relevant rows. Non-recurring rows can be
        # filtered directly. Recurring masters (rrule IS NOT NULL) need to
        # be expanded on-the-fly since their start_time only marks the
        # first occurrence.
        freed_statuses = [
            EventStatus.DRAFT,
            EventStatus.CANCELLED,
            EventStatus.REJECTED,
        ]
        non_recurring = (
            select(Events)
            .where(Events.venue_id == venue_id)
            .where(col(Events.status).notin_(freed_statuses))
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
            .where(col(Events.status).notin_(freed_statuses))
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
        ev_in_window = _ts_in_window(ev.start_time, window_start, window_end)
        if not ev.rrule:
            # Non-recurring rows (and detached override children) were already
            # pre-filtered by SQL when a window was provided; keep them.
            result.append(ev)
            continue
        # Recurring master: only include the row itself if its own start
        # falls in the window — otherwise we'd show a stale "first instance"
        # marker for a series whose visible occurrences are all pseudo-rows.
        if ev_in_window:
            result.append(ev)
        try:
            rule = parse_rrule(ev.rrule)
        except ValueError:
            # Skip expansion for unparseable rules — if the master was in
            # window it's already been appended above; otherwise we
            # intentionally emit nothing rather than silently guessing.
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
            timezone=ev.timezone,
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


def _clone_as_occurrence(
    master: Events, occ_start: datetime, duration: timedelta
) -> Events:
    """Build a detached Events instance representing a single occurrence."""
    data = {
        column.name: getattr(master, column.name) for column in master.__table__.columns
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
        timezone=master.timezone,
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


def _ts_in_window(
    ts: datetime,
    window_start: datetime | None,
    window_end: datetime | None,
) -> bool:
    """Return True if ``ts`` lies within the (optional) window bounds."""
    ts_n = _strip_tz(ts)
    if window_start is not None and ts_n < _strip_tz(window_start):
        return False
    if window_end is not None and ts_n > _strip_tz(window_end):
        return False
    return True


def expanded_events_with_occurrence_id(
    events: Iterable[Events],
) -> list[tuple[Events, str | None]]:
    """Pair each event with its synthetic ``occurrence_id`` (or ``None``)."""
    return [(e, e.__dict__.get("_occurrence_id")) for e in events]


events_crud = EventsCRUD()


class EventInvitationsCRUD:
    """CRUD operations for EventInvitations.

    Not using BaseCRUD because invitations have no Create/Update schemas —
    they're created via bulk operations keyed on (event, human) tuples and
    deleted by id.
    """

    def get(
        self, session: Session, invitation_id: uuid.UUID
    ) -> EventInvitations | None:
        return session.get(EventInvitations, invitation_id)

    def delete(self, session: Session, invitation: EventInvitations) -> None:
        session.delete(invitation)
        session.commit()

    def list_existing_human_ids(
        self, session: Session, event_id: uuid.UUID
    ) -> set[uuid.UUID]:
        """Return the set of human_ids already invited to the event."""
        rows = session.exec(
            select(EventInvitations.human_id).where(
                EventInvitations.event_id == event_id
            )
        ).all()
        return set(rows)

    def create_bulk_for_humans(
        self,
        session: Session,
        *,
        event: Events,
        humans: list[Humans],
        inviter_id: uuid.UUID,
    ) -> tuple[list[EventInvitations], set[uuid.UUID]]:
        """Create invitations for ``humans`` on ``event``, skipping dupes.

        Returns ``(created, skipped_human_ids)`` — the caller can map
        skipped ids back to emails if needed.
        """
        already_invited = self.list_existing_human_ids(session, event.id)
        created: list[EventInvitations] = []
        skipped_ids: set[uuid.UUID] = set()
        for human in humans:
            if human.id in already_invited:
                skipped_ids.add(human.id)
                continue
            inv = EventInvitations(
                tenant_id=event.tenant_id,
                event_id=event.id,
                human_id=human.id,
                invited_by=inviter_id,
            )
            session.add(inv)
            created.append(inv)
        session.commit()
        for inv in created:
            session.refresh(inv)
        return created, skipped_ids


class EventHiddenByHumanCRUD:
    """CRUD for EventHiddenByHuman markers.

    Not using BaseCRUD — hides are idempotent and keyed by (human, event)
    rather than by row id.
    """

    def get(
        self,
        session: Session,
        *,
        human_id: uuid.UUID,
        event_id: uuid.UUID,
    ) -> EventHiddenByHuman | None:
        """Return the hide marker if one exists."""
        return session.exec(
            select(EventHiddenByHuman)
            .where(EventHiddenByHuman.human_id == human_id)
            .where(EventHiddenByHuman.event_id == event_id)
        ).first()

    def hide(
        self,
        session: Session,
        *,
        tenant_id: uuid.UUID,
        human_id: uuid.UUID,
        event_id: uuid.UUID,
    ) -> EventHiddenByHuman:
        """Idempotently hide an event.

        Returns the existing marker when already hidden; otherwise creates a
        new one and returns it.
        """
        existing = self.get(session, human_id=human_id, event_id=event_id)
        if existing:
            return existing

        row = EventHiddenByHuman(
            tenant_id=tenant_id,
            human_id=human_id,
            event_id=event_id,
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row

    def unhide(
        self,
        session: Session,
        *,
        human_id: uuid.UUID,
        event_id: uuid.UUID,
    ) -> None:
        """Delete any hide marker for (human, event). No-op if none exists."""
        session.exec(
            delete(EventHiddenByHuman)
            .where(EventHiddenByHuman.human_id == human_id)
            .where(EventHiddenByHuman.event_id == event_id)
        )
        session.commit()


invitations_crud = EventInvitationsCRUD()
hidden_by_human_crud = EventHiddenByHumanCRUD()
