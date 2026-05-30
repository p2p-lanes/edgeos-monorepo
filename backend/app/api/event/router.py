import uuid
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from loguru import logger
from pydantic import BaseModel
from sqlmodel import Session

from app.api.event import crud
from app.api.event.recurrence import (
    DEFAULT_MAX_OCCURRENCES,
    expand,
    format_rrule,
    parse_rrule,
)
from app.api.event.schemas import (
    EventAdminNotes,
    EventAvailabilityCheck,
    EventAvailabilityResult,
    EventCalendarMeta,
    EventCalendarTrack,
    EventCreate,
    EventHostOption,
    EventInvitationBulkCreate,
    EventInvitationBulkResult,
    EventInvitationPublic,
    EventPublic,
    EventPublicCalendarItem,
    EventPublicCalendarResponse,
    EventRecurringAvailabilityCheck,
    EventRecurringAvailabilityResult,
    EventStatus,
    EventUpdate,
    EventVisibility,
    OccurrenceConflict,
    OccurrenceRef,
    RecurrenceUpdate,
)
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.tenants import PublicTenant
from app.core.dependencies.users import (
    AdminOrApiKey_EventsRead,
    AdminOrApiKey_EventsWrite,
    AdminOrApiKeySession_EventsRead,
    AdminOrApiKeySession_EventsWrite,
    CurrentHuman,
    CurrentPortalStaff,
    CurrentUser,
    HumanTenantSession,
    SessionDep,
    TenantSession,
)
from app.core.rate_limit import RateLimit
from app.services.event_datetime import format_event_when
from app.services.event_itip import (
    bump_and_dispatch_cancel as _bump_and_dispatch_itip_cancel,
)
from app.services.event_itip import (
    bump_and_dispatch_update as _bump_and_dispatch_itip_update,
)
from app.services.event_itip import (
    calendar_fields_changed as _event_calendar_fields_changed,
)
from app.services.event_itip import (
    gather_event_recipients as _gather_event_recipients,
)
from app.services.event_itip import send_event_itip as _send_event_itip

router = APIRouter(prefix="/events", tags=["events"])


async def _send_event_invitation_emails(
    db,
    event,
    invited: list[EventInvitationPublic],
) -> None:
    """Dispatch iTIP REQUEST to the given freshly-created invitees."""
    recipients = [
        {
            "human_id": inv.human_id,
            "email": inv.email,
            "first_name": inv.first_name or "",
        }
        for inv in invited
        if inv.email
    ]
    await _send_event_itip(db, event, recipients, method="REQUEST")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _find_venue_open_hours_issue(
    db,
    venue,
    start_time: datetime,
    end_time: datetime,
) -> tuple[int, str] | None:
    """Return ``(400, message)`` if [start_time, end_time] falls outside
    the venue's open hours in the popup's timezone, else ``None``.

    Mirrors ``_compute_availability``'s "no weekly_hours = always open"
    convention so venues without a configured schedule keep working as
    they did before. The non-raising variant of
    :func:`_check_venue_open_hours`; recurring callers need to attach the
    occurrence label before raising.
    """
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    from sqlmodel import select

    from app.api.event_venue.models import VenueExceptions, VenueWeeklyHours
    from app.api.event_venue.router import _resolve_popup_timezone

    weekly_rows = list(
        db.exec(
            select(VenueWeeklyHours).where(VenueWeeklyHours.venue_id == venue.id)
        ).all()
    )
    open_exceptions = list(
        db.exec(
            select(VenueExceptions)
            .where(VenueExceptions.venue_id == venue.id)
            .where(VenueExceptions.is_closed == False)  # noqa: E712
            .where(VenueExceptions.start_datetime < end_time)
            .where(VenueExceptions.end_datetime > start_time)
        ).all()
    )
    if not weekly_rows and not open_exceptions:
        return None  # no schedule configured = always open

    tz_name = _resolve_popup_timezone(db, venue.popup_id)
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")

    def _aware(dt: datetime) -> datetime:
        if dt.tzinfo is None:
            return dt.replace(tzinfo=UTC)
        return dt

    s = _aware(start_time)
    e = _aware(end_time)

    expanded = _expand_weekly_slots(weekly_rows, tz, s, e)
    candidate_ranges: list[tuple[datetime, datetime]] = [
        (r_s, r_e) for r_s, r_e, _row in expanded
    ]
    for exc in open_exceptions:
        candidate_ranges.append((_aware(exc.start_datetime), _aware(exc.end_datetime)))

    if any(r_s <= s and e <= r_e for r_s, r_e in candidate_ranges):
        return None

    return (400, "Selected time falls outside the venue's open hours.")


def _check_venue_open_hours(
    db,
    venue,
    start_time: datetime,
    end_time: datetime,
) -> None:
    """Raise 400 if [start_time, end_time] falls outside the venue's open
    hours. Thin wrapper around :func:`_find_venue_open_hours_issue`."""
    issue = _find_venue_open_hours_issue(db, venue, start_time, end_time)
    if issue is not None:
        raise HTTPException(status_code=issue[0], detail=issue[1])


def _expand_weekly_slots(weekly_rows, tz, aware_start, aware_end):
    """Expand weekly_hours rows into concrete ``(open, close, row)`` ranges
    covering the days that [aware_start, aware_end] crosses, in ``tz``.

    Used by both the open-hours check and the per-slot booking-mode
    resolver. Returns ranges where ``row`` is the source ``VenueWeeklyHours``
    so callers can read its ``booking_mode``.
    """
    s_local = aware_start.astimezone(tz)
    e_local = aware_end.astimezone(tz)
    day_cursor = s_local.date()
    last_day = e_local.date()
    ranges: list[tuple[datetime, datetime, object]] = []
    while day_cursor <= last_day + timedelta(days=1):
        dow = day_cursor.weekday()
        for row in weekly_rows:
            if (
                row.day_of_week != dow
                or row.is_closed
                or row.open_time is None
                or row.close_time is None
            ):
                continue
            open_local = datetime.combine(day_cursor, row.open_time, tzinfo=tz)
            close_local = datetime.combine(day_cursor, row.close_time, tzinfo=tz)
            if close_local <= open_local:
                close_local = close_local + timedelta(days=1)
            ranges.append((open_local, close_local, row))
        day_cursor = day_cursor + timedelta(days=1)
    return ranges


def _resolve_effective_booking_mode(
    db,
    venue,
    start_time: datetime,
    end_time: datetime,
) -> str:
    """Return the most restrictive booking_mode that applies to
    [start_time, end_time]. Considers every venue_weekly_hours slot that
    overlaps the window (in the popup's timezone); slots with NULL
    booking_mode contribute ``venue.booking_mode``. If no slot overlaps,
    returns ``venue.booking_mode``.

    Precedence: ``unbookable`` > ``approval_required`` > ``free``.
    """
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    from sqlmodel import select

    from app.api.event_venue.models import VenueWeeklyHours
    from app.api.event_venue.router import _resolve_popup_timezone
    from app.api.event_venue.schemas import VenueBookingMode

    venue_default = venue.booking_mode
    if isinstance(venue_default, VenueBookingMode):
        venue_default = venue_default.value

    weekly_rows = list(
        db.exec(
            select(VenueWeeklyHours).where(VenueWeeklyHours.venue_id == venue.id)
        ).all()
    )
    if not weekly_rows:
        return venue_default

    tz_name = _resolve_popup_timezone(db, venue.popup_id)
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")

    def _aware(dt: datetime) -> datetime:
        if dt.tzinfo is None:
            return dt.replace(tzinfo=UTC)
        return dt

    s = _aware(start_time)
    e = _aware(end_time)

    expanded = _expand_weekly_slots(weekly_rows, tz, s, e)
    precedence = {
        VenueBookingMode.UNBOOKABLE.value: 3,
        VenueBookingMode.APPROVAL_REQUIRED.value: 2,
        VenueBookingMode.FREE.value: 1,
    }

    overlapping_modes: list[str] = []
    for r_s, r_e, row in expanded:
        if r_s < e and r_e > s:
            row_mode = row.booking_mode
            if isinstance(row_mode, VenueBookingMode):
                row_mode = row_mode.value
            overlapping_modes.append(row_mode or venue_default)

    if not overlapping_modes:
        return venue_default

    return max(overlapping_modes, key=lambda m: precedence.get(m, 0))


def _find_venue_availability_issue(
    db,
    venue_id: uuid.UUID,
    start_time: datetime,
    end_time: datetime,
    exclude_event_id: uuid.UUID | None = None,
    allow_unbookable: bool = False,
) -> tuple[int, str] | None:
    """Same gates as :func:`_check_venue_availability`, but returns
    ``(status_code, detail)`` instead of raising.

    Callers compose the ``HTTPException`` (or projection into a result
    schema) — the recurring caller in particular prefixes the detail with
    the offending occurrence's local label so a 409 says *which* day in
    the series clashed instead of just "Venue already booked". Returns
    ``None`` when the window is clean.

    ``allow_unbookable`` lets backoffice (admin) callers bypass the
    UNBOOKABLE check — the flag is a portal-facing restriction only. The
    open-hours and conflict gates still apply.
    """
    from app.api.event_venue.models import EventVenues
    from app.api.event_venue.schemas import VenueBookingMode

    venue = db.get(EventVenues, venue_id)
    if not venue:
        return (404, "Venue not found")
    effective_mode = _resolve_effective_booking_mode(db, venue, start_time, end_time)
    if not allow_unbookable and effective_mode == VenueBookingMode.UNBOOKABLE.value:
        return (409, "Venue is not bookable at the selected time")

    open_hours_issue = _find_venue_open_hours_issue(db, venue, start_time, end_time)
    if open_hours_issue is not None:
        return open_hours_issue

    window_start, window_end = crud.compute_booking_window(
        start_time,
        end_time,
        venue.setup_time_minutes,
        venue.teardown_time_minutes,
    )
    conflicts = crud.events_crud.find_venue_conflicts(
        db,
        venue_id=venue_id,
        window_start=window_start,
        window_end=window_end,
        exclude_event_id=exclude_event_id,
    )
    if conflicts:
        titles = ", ".join(e.title for e in conflicts[:3])
        return (409, f"Venue already booked (conflicts: {titles})")
    return None


def _check_venue_availability(
    db,
    venue_id: uuid.UUID,
    start_time: datetime,
    end_time: datetime,
    exclude_event_id: uuid.UUID | None = None,
    allow_unbookable: bool = False,
) -> None:
    """Raise 400/409 if the window is outside open hours or collides with
    an existing booking."""
    issue = _find_venue_availability_issue(
        db,
        venue_id=venue_id,
        start_time=start_time,
        end_time=end_time,
        exclude_event_id=exclude_event_id,
        allow_unbookable=allow_unbookable,
    )
    if issue is not None:
        raise HTTPException(status_code=issue[0], detail=issue[1])


VenueInfo = tuple[str | None, str | None, str | None]  # (title, location, image)


def _to_public(
    event,
    venue_map: dict[uuid.UUID, VenueInfo] | None = None,
    track_map: dict[uuid.UUID, str] | None = None,
) -> EventPublic:
    """Convert an Events row (or expanded pseudo-row) to EventPublic.

    Propagates the synthetic ``occurrence_id`` set by
    :func:`app.api.event.crud._clone_as_occurrence`.

    ``venue_map``/``track_map`` let callers pre-fetch venues/tracks in a
    single query and avoid N+1 when serializing a list.
    """
    # ``custom_location_name``/``custom_location_url`` live on EventBase and
    # are picked up automatically by ``model_validate`` — no extra plumbing.
    data = EventPublic.model_validate(event)
    occ = event.__dict__.get("_occurrence_id") if hasattr(event, "__dict__") else None
    updates: dict = {}
    if occ:
        updates["occurrence_id"] = occ
    if event.venue_id:
        if venue_map is not None and event.venue_id in venue_map:
            title, location, image = venue_map[event.venue_id]
            updates["venue_title"] = title
            updates["venue_location"] = location
            updates["venue_image_url"] = image
        elif venue_map is None and event.venue is not None:
            updates["venue_title"] = event.venue.title
            updates["venue_location"] = event.venue.location
            updates["venue_image_url"] = event.venue.image_url
    if event.track_id:
        if track_map is not None and event.track_id in track_map:
            updates["track_title"] = track_map[event.track_id]
        elif track_map is None and getattr(event, "track", None) is not None:
            updates["track_title"] = event.track.name
    if updates:
        data = data.model_copy(update=updates)
    return data


def _venue_map_for_events(db, events: list) -> dict[uuid.UUID, VenueInfo]:
    """Fetch ``(title, location, image_url)`` for all venue_ids referenced."""
    from sqlmodel import select

    from app.api.event_venue.models import EventVenues

    venue_ids = {e.venue_id for e in events if e.venue_id}
    if not venue_ids:
        return {}
    rows = db.exec(select(EventVenues).where(EventVenues.id.in_(venue_ids))).all()
    return {v.id: (v.title, v.location, v.image_url) for v in rows}


def _track_map_for_events(db, events: list) -> dict[uuid.UUID, str]:
    """Fetch track names for all track_ids referenced."""
    from sqlmodel import select

    from app.api.track.models import Tracks

    track_ids = {e.track_id for e in events if e.track_id}
    if not track_ids:
        return {}
    rows = db.exec(select(Tracks).where(Tracks.id.in_(track_ids))).all()
    return {t.id: t.name for t in rows}


def _check_event_within_popup_window(
    popup,
    *,
    start_time: datetime,
    end_time: datetime,
) -> None:
    """Reject events that fall outside the popup's [start_date, end_date].

    Both popup bounds are optional — only enforced when set. Comparisons
    are timezone-aware: bounds without tzinfo are treated as UTC.

    `end_date` is treated as an inclusive calendar day (the popup form is a
    date-picker that stores midnight UTC of the chosen day), so events ending
    anywhere on that day are accepted — i.e. the effective upper bound is
    `end_date + 1 day`. Used by portal-facing endpoints; backoffice/admin
    paths are not restricted.
    """
    if popup is None:
        return
    start_bound = getattr(popup, "start_date", None)
    end_bound = getattr(popup, "end_date", None)

    def _aware(dt: datetime) -> datetime:
        if dt.tzinfo is None:
            return dt.replace(tzinfo=UTC)
        return dt

    if start_bound is not None and _aware(start_time) < _aware(start_bound):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Event must start on or after the popup's start date "
                f"({start_bound.isoformat()})."
            ),
        )
    if end_bound is not None and _aware(end_time) > _aware(end_bound) + timedelta(
        days=1
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Event must end on or before the popup's end date "
                f"({end_bound.isoformat()})."
            ),
        )


def _format_occurrence_label(occ_start: datetime, timezone: str) -> str:
    """Render an occurrence start as ``"Mon Jun 8 09:00 PDT"`` in the
    event's local tz.

    Avoids ``%a``/``%b`` ``strftime`` (locale-dependent on Windows) so the
    output is stable across hosts. Naive datetimes are treated as UTC;
    unknown IANA names fall back to UTC.
    """
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    if occ_start.tzinfo is None:
        occ_start = occ_start.replace(tzinfo=UTC)
    try:
        tz = ZoneInfo(timezone or "UTC")
    except ZoneInfoNotFoundError:
        tz = UTC
    local = occ_start.astimezone(tz)
    weekday = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")[local.weekday()]
    month = (
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    )[local.month - 1]
    abbr = local.tzname() or ""
    return f"{weekday} {month} {local.day} {local.strftime('%H:%M')} {abbr}".rstrip()


def _decorate_recurrence_detail(code: int, detail: str, label: str) -> str:
    """Prefix a per-occurrence error detail with its local label.

    For the common 409 booking-conflict case we splice the label *inside*
    the existing message so it reads
    ``"Venue already booked on <label> (conflicts: …)"`` rather than
    burying the date in a leading sentence. Other 4xx variants get a
    leading ``"On <label>: …"`` (with lowercase first letter).
    """
    if not detail:
        return detail
    if code == 409 and detail.startswith("Venue already booked ("):
        return detail.replace(
            "Venue already booked",
            f"Venue already booked on {label}",
            1,
        )
    return f"On {label}: " + detail[0].lower() + detail[1:]


def _check_recurrence_conflicts(
    db,
    *,
    venue_id: uuid.UUID | None,
    start_time: datetime,
    end_time: datetime,
    rrule_str: str | None,
    exdates: list | None,
    exclude_event_id: uuid.UUID | None = None,
    timezone: str = "UTC",
    allow_unbookable: bool = False,
) -> None:
    """For recurring events, expand each instance and run the anti-overlap
    venue check. Bails out on first conflict with 409.

    ``exdates`` may be ``None`` / empty. For one-offs (``rrule_str`` falsy)
    only the base window is checked via :func:`_check_venue_availability`.
    """
    if venue_id is None:
        return
    if not rrule_str:
        _check_venue_availability(
            db,
            venue_id=venue_id,
            start_time=start_time,
            end_time=end_time,
            exclude_event_id=exclude_event_id,
            allow_unbookable=allow_unbookable,
        )
        return

    try:
        rule = parse_rrule(rrule_str)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid RRULE: {exc}")
    if rule is None:
        _check_venue_availability(
            db,
            venue_id=venue_id,
            start_time=start_time,
            end_time=end_time,
            exclude_event_id=exclude_event_id,
            allow_unbookable=allow_unbookable,
        )
        return

    duration = end_time - start_time
    occurrences = expand(
        dtstart=start_time,
        rule=rule,
        exdates=list(exdates or []),
        max_occurrences=DEFAULT_MAX_OCCURRENCES,
        timezone=timezone,
    )
    if not occurrences:
        raise HTTPException(
            status_code=400,
            detail="Recurrence expands to zero occurrences",
        )
    for occ_start in occurrences:
        issue = _find_venue_availability_issue(
            db,
            venue_id=venue_id,
            start_time=occ_start,
            end_time=occ_start + duration,
            exclude_event_id=exclude_event_id,
            allow_unbookable=allow_unbookable,
        )
        if issue is None:
            continue
        code, detail = issue
        label = _format_occurrence_label(occ_start, timezone)
        raise HTTPException(
            status_code=code,
            detail=_decorate_recurrence_detail(code, detail, label),
        )


def _ics_utc_stamp(dt: datetime) -> str:
    """Format a datetime as an RFC-5545 UTC stamp ('...Z').

    Treats naive values as already-UTC for defense-in-depth, but the schema
    validator now rejects naive inputs so this branch should only trigger for
    legacy rows.
    """
    if dt.tzinfo is None:
        return dt.strftime("%Y%m%dT%H%M%SZ")
    return dt.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def _render_ics(event) -> str:
    """Render a minimal, RFC-5545-compliant VCALENDAR string for one event."""
    dtstamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    dtstart = _ics_utc_stamp(event.start_time)
    dtend = _ics_utc_stamp(event.end_time)
    summary = (event.title or "").replace("\n", " ").replace(",", r"\,")
    description = (event.content or "").replace("\n", r"\n").replace(",", r"\,")
    location = event.meeting_url or ""

    lines: list[str] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//EdgeOS//Events//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:event-{event.id}@edgeos",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART:{dtstart}",
        f"DTEND:{dtend}",
        f"SUMMARY:{summary}",
    ]
    if description:
        lines.append(f"DESCRIPTION:{description}")
    if location:
        lines.append(f"LOCATION:{location}")
    if event.status == EventStatus.CANCELLED:
        lines.append("STATUS:CANCELLED")
    else:
        lines.append("STATUS:CONFIRMED")
    lines.extend(["END:VEVENT", "END:VCALENDAR"])
    return "\r\n".join(lines) + "\r\n"


def _invitation_visible_to_human(
    event, human_id: uuid.UUID, invitation_human_ids: Iterable[uuid.UUID]
) -> bool:
    """A private event is only visible to owner + explicitly invited humans."""
    if event.owner_id == human_id:
        return True
    return human_id in invitation_human_ids


# ---------------------------------------------------------------------------
# Public calendar (anonymous)
# ---------------------------------------------------------------------------


def _calendar_publicize(
    event,
    venue_map: dict[uuid.UUID, VenueInfo] | None,
    track_map: dict[uuid.UUID, str] | None,
) -> EventPublicCalendarItem:
    """Project an Events row (or expanded pseudo-row) into the narrow
    public calendar schema.

    Never reads / forwards sensitive fields (``meeting_url``, ``content``,
    ``owner_id``, ``tenant_id``) regardless of what ``EventPublic`` would
    have exposed — the public schema simply does not have those fields.
    """
    venue_title = None
    venue_location = None
    venue_image_url = None
    if event.venue_id:
        if venue_map is not None and event.venue_id in venue_map:
            venue_title, venue_location, venue_image_url = venue_map[event.venue_id]
        elif venue_map is None and getattr(event, "venue", None) is not None:
            venue_title = event.venue.title
            venue_location = event.venue.location
            venue_image_url = event.venue.image_url

    track_title = None
    if event.track_id:
        if track_map is not None and event.track_id in track_map:
            track_title = track_map[event.track_id]
        elif track_map is None and getattr(event, "track", None) is not None:
            track_title = event.track.name

    occurrence_id = (
        event.__dict__.get("_occurrence_id") if hasattr(event, "__dict__") else None
    )

    return EventPublicCalendarItem(
        id=event.id,
        title=event.title,
        start_time=event.start_time,
        end_time=event.end_time,
        timezone=event.timezone,
        kind=event.kind,
        cover_url=event.cover_url,
        max_participant=event.max_participant,
        tags=list(event.tags or []),
        highlighted=bool(event.highlighted),
        host_display_name=event.host_display_name,
        rrule=event.rrule,
        recurrence_master_id=event.recurrence_master_id,
        occurrence_id=occurrence_id,
        venue_id=event.venue_id,
        venue_title=venue_title,
        venue_location=venue_location,
        venue_image_url=venue_image_url,
        custom_location_name=event.custom_location_name,
        track_id=event.track_id,
        track_title=track_title,
    )


@router.get(
    "/public/calendar",
    response_model=EventPublicCalendarResponse,
    dependencies=[
        Depends(
            RateLimit(limit=120, window_sec=60, key_prefix="rl:events-public-calendar")
        ),
    ],
)
async def list_public_calendar(
    db: SessionDep,
    tenant: PublicTenant,
    popup_slug: str,
    start_after: datetime | None = None,
    start_before: datetime | None = None,
    search: str | None = None,
    tags: list[str] | None = Query(default=None),
    track_ids: list[uuid.UUID] | None = Query(default=None),
    limit: PaginationLimit = 200,
) -> EventPublicCalendarResponse:
    """Anonymous calendar feed for a popup.

    Tenant is resolved from Origin/Referer (or X-Tenant-Id as last
    resort). The popup is looked up by ``popup_slug`` and validated
    against the resolved tenant so a slug from a sibling tenant can't
    leak events here.

    Returned events are restricted server-side to ``status=published``
    and ``visibility=public`` — cancelled, draft, pending-approval,
    rejected, private and unlisted events are filtered out. The
    response shape is intentionally narrower than ``EventPublic`` so
    sensitive fields (``meeting_url``, ``content``, owner/tenant ids)
    cannot be returned even by accident.
    """
    from sqlmodel import select

    from app.api.event_settings.crud import event_settings_crud
    from app.api.popup.crud import popups_crud
    from app.api.popup.schemas import PopupStatus
    from app.api.track.models import Tracks

    popup = popups_crud.get_by_slug(db, popup_slug)
    if not popup or popup.tenant_id != tenant.id or popup.status != PopupStatus.active:
        # Opaque 404 — never confirm sibling-tenant popups exist.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found"
        )

    events, _ = crud.events_crud.find_by_popup(
        db,
        popup_id=popup.id,
        skip=0,
        limit=limit,
        event_status=EventStatus.PUBLISHED,
        visibility=EventVisibility.PUBLIC,
        exclude_statuses=[EventStatus.CANCELLED],
        start_after=start_after,
        start_before=start_before,
        search=search,
        tags=tags,
        track_ids=track_ids,
    )

    venue_map = _venue_map_for_events(db, events)
    track_map = _track_map_for_events(db, events)

    settings = event_settings_crud.get_by_popup_id(db, popup.id)
    timezone = settings.timezone if settings else "UTC"
    # Distinct tags actually present on the popup's published+public events,
    # not the curated ``event_settings.allowed_tags`` list — creators can use
    # tags outside that list, and the filter must surface them.
    allowed_tags = crud.events_crud.list_distinct_tags(
        db, popup_id=popup.id, only_published_public=True
    )

    track_rows = list(db.exec(select(Tracks).where(Tracks.popup_id == popup.id)).all())
    allowed_tracks = [EventCalendarTrack(id=t.id, name=t.name) for t in track_rows]

    return EventPublicCalendarResponse(
        results=[_calendar_publicize(e, venue_map, track_map) for e in events],
        meta=EventCalendarMeta(
            allowed_tags=allowed_tags,
            allowed_tracks=allowed_tracks,
            timezone=timezone,
            popup_id=popup.id,
            popup_slug=popup.slug,
            popup_name=popup.name,
        ),
    )


# ---------------------------------------------------------------------------
# Backoffice endpoints (user token)
# ---------------------------------------------------------------------------


@router.get("", response_model=ListModel[EventPublic])
async def list_events(
    db: AdminOrApiKeySession_EventsRead,
    _: AdminOrApiKey_EventsRead,
    popup_id: uuid.UUID | None = None,
    event_status: EventStatus | None = None,
    kind: str | None = None,
    venue_id: uuid.UUID | None = None,
    location_kind: str | None = None,
    track_ids: list[uuid.UUID] | None = Query(default=None),
    owner_id: uuid.UUID | None = None,
    start_after: datetime | None = None,
    start_before: datetime | None = None,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[EventPublic]:
    """List events with optional filters (backoffice).

    ``location_kind`` narrows results to events without a ``venue_id``:
    - ``"custom"``  → events with a ``custom_location_name`` set.
    - ``"meeting"`` → online-only events (no venue, no custom location).

    ``owner_id`` filters to events created by a specific host (the Human
    referenced by ``Events.owner_id``).
    """
    if popup_id:
        events, total = crud.events_crud.find_by_popup(
            db,
            popup_id=popup_id,
            skip=skip,
            limit=limit,
            event_status=event_status,
            kind=kind,
            venue_id=venue_id,
            location_kind=location_kind,
            track_ids=track_ids,
            owner_id=owner_id,
            start_after=start_after,
            start_before=start_before,
            search=search,
        )
    else:
        events, total = crud.events_crud.find(
            db,
            skip=skip,
            limit=limit,
            search=search,
            search_fields=["title"],
        )

    venue_map = _venue_map_for_events(db, events)
    track_map = _track_map_for_events(db, events)
    return ListModel[EventPublic](
        results=[_to_public(e, venue_map, track_map) for e in events],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/hosts", response_model=list[EventHostOption])
async def list_event_hosts(
    db: AdminOrApiKeySession_EventsRead,
    _: AdminOrApiKey_EventsRead,
    popup_id: uuid.UUID,
) -> list[EventHostOption]:
    """List distinct event hosts for a popup (backoffice creator filter).

    Returns the Humans referenced by ``Events.owner_id`` so the events list can
    offer a "filter by creator" picker. Events whose owner is not a human are
    omitted (they have no host to filter by).
    """
    hosts = crud.events_crud.list_distinct_hosts(db, popup_id=popup_id)
    return [
        EventHostOption(id=h.id, name=h.full_name, email=h.email) for h in hosts
    ]


@router.get("/{event_id}", response_model=EventPublic)
async def get_event(
    event_id: uuid.UUID,
    db: AdminOrApiKeySession_EventsRead,
    _: AdminOrApiKey_EventsRead,
) -> EventPublic:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )
    return _to_public(event)


# ---------------------------------------------------------------------------
# Admin notes — staff-only free-text notes, isolated from the event payload so
# they never leak to portal humans or the public calendar. Open to ANY
# backoffice user (all roles), unlike the admin-gated event write endpoints.
# ---------------------------------------------------------------------------


@router.get("/{event_id}/admin-notes", response_model=EventAdminNotes)
async def get_event_admin_notes(
    event_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> EventAdminNotes:
    """Read an event's staff-only notes (any backoffice user)."""
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )
    return EventAdminNotes(notes=event.admin_notes)


@router.put("/{event_id}/admin-notes", response_model=EventAdminNotes)
async def update_event_admin_notes(
    event_id: uuid.UUID,
    payload: EventAdminNotes,
    db: TenantSession,
    _: CurrentUser,
) -> EventAdminNotes:
    """Set an event's staff-only notes (any backoffice user)."""
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )
    event.admin_notes = payload.notes
    db.add(event)
    db.commit()
    db.refresh(event)
    return EventAdminNotes(notes=event.admin_notes)


@router.post("", response_model=EventPublic, status_code=status.HTTP_201_CREATED)
async def create_event(
    event_in: EventCreate,
    db: AdminOrApiKeySession_EventsWrite,
    current_user: AdminOrApiKey_EventsWrite,
) -> EventPublic:
    from app.api.event.models import Events
    from app.api.popup.crud import popups_crud
    from app.api.shared.enums import UserRole

    popup = popups_crud.get(db, event_in.popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found"
        )

    rrule_str = format_rrule(event_in.recurrence) if event_in.recurrence else None

    if event_in.venue_id is not None:
        _check_recurrence_conflicts(
            db,
            venue_id=event_in.venue_id,
            start_time=event_in.start_time,
            end_time=event_in.end_time,
            rrule_str=rrule_str,
            exdates=None,
            timezone=event_in.timezone,
            allow_unbookable=True,
        )

    tenant_id = (
        popup.tenant_id
        if current_user.role == UserRole.SUPERADMIN
        else current_user.tenant_id
    )

    event_data = event_in.model_dump()
    event_data.pop("recurrence", None)
    # Defense-in-depth: the schema validator already rejects venue+custom
    # collisions, but if either side is set we still null out the other so
    # downstream code never sees both populated.
    if event_data.get("custom_location_name"):
        event_data["venue_id"] = None
    elif event_data.get("venue_id") is not None:
        event_data["custom_location_name"] = None
        event_data["custom_location_url"] = None
    event_data["rrule"] = rrule_str
    event_data["tenant_id"] = tenant_id
    event_data["owner_id"] = current_user.id

    # Admin-created events trust the requested status — picking "published"
    # in the backoffice publishes immediately, even when the venue is
    # ``approval_required`` or the requested capacity exceeds the venue's.
    # The portal create endpoint still enforces its own approval gate for
    # non-admin submissions.

    event = Events(**event_data)

    db.add(event)
    db.commit()
    db.refresh(event)

    return _to_public(event)


@router.patch("/{event_id}", response_model=EventPublic)
async def update_event(
    event_id: uuid.UUID,
    event_in: EventUpdate,
    db: AdminOrApiKeySession_EventsWrite,
    _: AdminOrApiKey_EventsWrite,
) -> EventPublic:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )

    new_venue_id = (
        event_in.venue_id if event_in.venue_id is not None else event.venue_id
    )
    new_start = event_in.start_time or event.start_time
    new_end = event_in.end_time or event.end_time
    timing_or_venue_changed = (
        event_in.venue_id is not None
        or event_in.start_time is not None
        or event_in.end_time is not None
    )
    if new_venue_id is not None and timing_or_venue_changed:
        _check_recurrence_conflicts(
            db,
            venue_id=new_venue_id,
            start_time=new_start,
            end_time=new_end,
            rrule_str=event.rrule,
            exdates=list(event.recurrence_exdates or []),
            exclude_event_id=event.id,
            timezone=event_in.timezone or event.timezone,
            allow_unbookable=True,
        )

    # Transition: switching to a venue clears any prior custom location, and
    # switching to a custom location clears the prior venue. Rebuild via the
    # dump dict so the cleared fields are tracked as set (CRUD.update relies
    # on ``exclude_unset=True``).
    patch_dict = event_in.model_dump(exclude_unset=True)
    if patch_dict.get("venue_id") is not None:
        patch_dict["custom_location_name"] = None
        patch_dict["custom_location_url"] = None
    elif patch_dict.get("custom_location_name") is not None:
        patch_dict["venue_id"] = None
    event_in = EventUpdate(**patch_dict)

    before = {
        "title": event.title,
        "start_time": event.start_time,
        "end_time": event.end_time,
        "venue_id": event.venue_id,
        "content": event.content,
        "custom_location_name": event.custom_location_name,
        "custom_location_url": event.custom_location_url,
    }
    updated = crud.events_crud.update(db, event, event_in)

    if _event_calendar_fields_changed(before, updated):
        await _bump_and_dispatch_itip_update(db, updated, before=before)

    return _to_public(updated)


@router.post("/{event_id}/cancel", response_model=EventPublic)
async def cancel_event(
    event_id: uuid.UUID,
    db: AdminOrApiKeySession_EventsWrite,
    _: AdminOrApiKey_EventsWrite,
) -> EventPublic:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )
    if event.status == EventStatus.CANCELLED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Event is already cancelled"
        )

    cancel_update = EventUpdate(status=EventStatus.CANCELLED)
    updated = crud.events_crud.update(db, event, cancel_update)
    await _bump_and_dispatch_itip_cancel(db, updated)
    return _to_public(updated)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: uuid.UUID,
    db: AdminOrApiKeySession_EventsWrite,
    _: AdminOrApiKey_EventsWrite,
) -> None:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )
    # Send CANCEL to every attendee *before* we drop the row so they get a
    # clean tombstone in their calendar.
    try:
        await _bump_and_dispatch_itip_cancel(db, event)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("iTIP CANCEL on event delete {} failed: {}", event_id, exc)
    crud.events_crud.delete(db, event)


# ---------------------------------------------------------------------------
# Recurrence
# ---------------------------------------------------------------------------


@router.patch("/{event_id}/recurrence", response_model=EventPublic)
async def set_recurrence(
    event_id: uuid.UUID,
    payload: RecurrenceUpdate,
    db: AdminOrApiKeySession_EventsWrite,
    _: AdminOrApiKey_EventsWrite,
) -> EventPublic:
    """Set/replace/clear the RRULE on a series master.

    Sending ``{"recurrence": null}`` clears the rule (the event becomes a
    one-off). Sending a ``RecurrenceRule`` sets/replaces it. EXDATEs are
    cleared when the rule changes to avoid stale skips.
    """
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )
    if event.recurrence_master_id is not None:
        raise HTTPException(
            status_code=400,
            detail="Cannot set a recurrence rule on a detached occurrence",
        )

    new_rrule = format_rrule(payload.recurrence) if payload.recurrence else None
    old_rrule = event.rrule

    if event.venue_id is not None:
        _check_recurrence_conflicts(
            db,
            venue_id=event.venue_id,
            start_time=event.start_time,
            end_time=event.end_time,
            rrule_str=new_rrule,
            exdates=None,
            exclude_event_id=event.id,
            timezone=event.timezone,
        )

    event.rrule = new_rrule
    event.recurrence_exdates = []
    db.add(event)
    db.commit()
    db.refresh(event)

    # Series schedule changed → re-broadcast the master REQUEST so each
    # attendee's calendar refreshes. Per-occurrence RSVPers' instance
    # entries stay intact (master UID + their RECURRENCE-ID); the master
    # SEQUENCE bump is what nudges Google/Apple/Outlook to re-render the
    # series.
    if old_rrule != new_rrule:
        await _bump_and_dispatch_itip_update(db, event)
    return _to_public(event)


@router.get("/{event_id}/overrides", response_model=list[EventPublic])
async def list_overrides(
    event_id: uuid.UUID,
    db: AdminOrApiKeySession_EventsRead,
    _: AdminOrApiKey_EventsRead,
) -> list[EventPublic]:
    """Detached override children of a recurring series master.

    Returns rows that point at ``event_id`` via ``recurrence_master_id``.
    Surfaces instances that were edited/moved in isolation so users can
    discover them in the UI without hitting opaque "Venue already booked"
    conflicts on overlapping master schedules.
    """
    master = crud.events_crud.get(db, event_id)
    if not master:
        raise HTTPException(status_code=404, detail="Event not found")
    children, _total = crud.events_crud.find(
        db,
        recurrence_master_id=event_id,
        sort_by="start_time",
        sort_order="asc",
        limit=500,
    )
    venue_map = _venue_map_for_events(db, children)
    track_map = _track_map_for_events(db, children)
    return [_to_public(c, venue_map, track_map) for c in children]


@router.post("/{event_id}/detach-occurrence", response_model=EventPublic)
async def detach_occurrence(
    event_id: uuid.UUID,
    payload: OccurrenceRef,
    db: AdminOrApiKeySession_EventsWrite,
    _: AdminOrApiKey_EventsWrite,
) -> EventPublic:
    """Materialize a single occurrence of a recurring series as its own row.

    Adds ``occurrence_start`` to the master's ``recurrence_exdates`` so the
    expander stops emitting it, and creates a child event row with
    ``recurrence_master_id = event_id`` copying fields from the master but
    with its ``start_time``/``end_time`` set to the chosen occurrence window.
    The child has NO ``rrule`` — it's a standalone override.
    """
    from app.api.event.models import Events

    master = crud.events_crud.get(db, event_id)
    if not master:
        raise HTTPException(status_code=404, detail="Event not found")
    if not master.rrule:
        raise HTTPException(
            status_code=400,
            detail="Event is not a recurring series",
        )

    duration = master.end_time - master.start_time
    occ_start = payload.occurrence_start
    occ_end = occ_start + duration

    exdate_iso = occ_start.isoformat()
    existing = list(master.recurrence_exdates or [])
    if exdate_iso not in existing:
        existing.append(exdate_iso)
    master.recurrence_exdates = existing

    child = Events(
        tenant_id=master.tenant_id,
        popup_id=master.popup_id,
        owner_id=master.owner_id,
        title=master.title,
        content=master.content,
        start_time=occ_start,
        end_time=occ_end,
        timezone=master.timezone,
        cover_url=master.cover_url,
        meeting_url=master.meeting_url,
        max_participant=master.max_participant,
        tags=list(master.tags or []),
        venue_id=master.venue_id,
        track_id=master.track_id,
        visibility=master.visibility,
        require_approval=master.require_approval,
        kind=master.kind,
        status=master.status,
        rrule=None,
        recurrence_master_id=master.id,
        recurrence_exdates=[],
    )
    db.add(master)
    db.add(child)
    db.commit()
    db.refresh(child)

    # The detached instance has its own row now → tell anyone who RSVPd
    # to that occurrence to drop the master+RECURRENCE-ID entry, then
    # send a fresh REQUEST under the child's UID so the entry re-imports
    # against the override row. Best-effort; SMTP failures don't roll back
    # the detach.
    try:
        await _bump_and_dispatch_itip_cancel(db, master, occurrence_start=occ_start)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "iTIP CANCEL on detach for {} occ={} failed: {}",
            master.id,
            occ_start,
            exc,
        )
    try:
        master_recipients = _gather_event_recipients(
            db, master, occurrence_start=occ_start
        )
        # Re-target recipients at the new child row; UID will be
        # ``{child.id}@edgeos`` because we strip per-recipient
        # ``occurrence_start`` (the child is standalone, no RECURRENCE-ID).
        child_recipients = [{**r, "occurrence_start": None} for r in master_recipients]
        if child_recipients:
            await _send_event_itip(db, child, child_recipients, method="REQUEST")
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "iTIP REQUEST for detached child {} failed: {}",
            child.id,
            exc,
        )
    return _to_public(child)


@router.delete("/{event_id}/occurrence", status_code=status.HTTP_204_NO_CONTENT)
async def delete_occurrence(
    event_id: uuid.UUID,
    payload: OccurrenceRef,
    db: AdminOrApiKeySession_EventsWrite,
    _: AdminOrApiKey_EventsWrite,
) -> None:
    """Skip a single occurrence by appending it to the master's EXDATEs.

    Does NOT delete the master series. If you want to delete the whole
    series, call DELETE /events/{id}.
    """
    master = crud.events_crud.get(db, event_id)
    if not master:
        raise HTTPException(status_code=404, detail="Event not found")
    if not master.rrule:
        raise HTTPException(
            status_code=400,
            detail="Event is not a recurring series",
        )
    exdate_iso = payload.occurrence_start.isoformat()
    existing = list(master.recurrence_exdates or [])
    if exdate_iso not in existing:
        existing.append(exdate_iso)
    master.recurrence_exdates = existing
    db.add(master)
    db.commit()
    # Tell anyone RSVPd to this single instance to drop it; the rest of
    # the series is unaffected because the per-recipient ICS carries the
    # matching RECURRENCE-ID.
    try:
        await _bump_and_dispatch_itip_cancel(
            db, master, occurrence_start=payload.occurrence_start
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "iTIP CANCEL on skip for {} occ={} failed: {}",
            master.id,
            payload.occurrence_start,
            exc,
        )


# ---------------------------------------------------------------------------
# Availability check
# ---------------------------------------------------------------------------


def _run_availability_check(
    db: Session,
    payload: EventAvailabilityCheck,
    *,
    allow_unbookable: bool = False,
) -> EventAvailabilityResult:
    """Shared implementation for the user- and portal-facing availability checks.

    ``allow_unbookable`` lets backoffice (admin) callers continue past the
    UNBOOKABLE check — it's a portal-facing restriction only. The remaining
    conflict scan still runs so admins still see overlapping bookings.
    """
    from app.api.event_venue.models import EventVenues
    from app.api.event_venue.schemas import VenueBookingMode

    venue = db.get(EventVenues, payload.venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")
    effective_mode = _resolve_effective_booking_mode(
        db, venue, payload.start_time, payload.end_time
    )
    if not allow_unbookable and effective_mode == VenueBookingMode.UNBOOKABLE.value:
        return EventAvailabilityResult(
            available=False,
            conflicts=[],
            reason="Venue is not bookable at the selected time",
            effective_booking_mode=effective_mode,
        )

    window_start, window_end = crud.compute_booking_window(
        payload.start_time,
        payload.end_time,
        venue.setup_time_minutes,
        venue.teardown_time_minutes,
    )
    conflicts = crud.events_crud.find_venue_conflicts(
        db,
        venue_id=payload.venue_id,
        window_start=window_start,
        window_end=window_end,
        exclude_event_id=payload.exclude_event_id,
    )
    return EventAvailabilityResult(
        available=len(conflicts) == 0,
        conflicts=[c.id for c in conflicts],
        reason=None if not conflicts else "Conflicts with existing events",
        effective_booking_mode=effective_mode,
    )


@router.post("/check-availability", response_model=EventAvailabilityResult)
async def check_availability(
    payload: EventAvailabilityCheck,
    db: AdminOrApiKeySession_EventsRead,
    _: AdminOrApiKey_EventsRead,
) -> EventAvailabilityResult:
    """Check whether a venue is free for a candidate time window."""
    return _run_availability_check(db, payload, allow_unbookable=True)


@router.post(
    "/portal/events/check-availability",
    response_model=EventAvailabilityResult,
    tags=["events"],
)
async def check_availability_portal(
    payload: EventAvailabilityCheck,
    db: HumanTenantSession,
    _: CurrentHuman,
) -> EventAvailabilityResult:
    """Portal-facing variant of /check-availability authenticated as a human."""
    return _run_availability_check(db, payload)


# Cap on how many conflicting occurrences we report up-front to the
# frontend. Most series are short and this is enough to surface the first
# few problems without unbounded payloads on pathological inputs.
_MAX_REPORTED_OCCURRENCE_CONFLICTS = 20


def _conflicting_event_summary(
    db,
    venue_id: uuid.UUID,
    start_time: datetime,
    end_time: datetime,
    exclude_event_id: uuid.UUID | None = None,
) -> tuple[list[uuid.UUID], list[str]]:
    """Return the ids + first three titles of events colliding with the
    given window on ``venue_id``. Used to populate ``OccurrenceConflict``
    without re-running the full open-hours / booking-mode gates."""
    from app.api.event_venue.models import EventVenues

    venue = db.get(EventVenues, venue_id)
    if not venue:
        return [], []
    window_start, window_end = crud.compute_booking_window(
        start_time,
        end_time,
        venue.setup_time_minutes,
        venue.teardown_time_minutes,
    )
    conflicts = crud.events_crud.find_venue_conflicts(
        db,
        venue_id=venue_id,
        window_start=window_start,
        window_end=window_end,
        exclude_event_id=exclude_event_id,
    )
    return [c.id for c in conflicts], [c.title for c in conflicts[:3]]


@router.post(
    "/check-recurring-availability",
    response_model=EventRecurringAvailabilityResult,
)
async def check_recurring_availability(
    payload: EventRecurringAvailabilityCheck,
    db: AdminOrApiKeySession_EventsRead,
    _: AdminOrApiKey_EventsRead,
) -> EventRecurringAvailabilityResult:
    """Server-side preflight for a (possibly recurring) event.

    Mirrors what ``POST /events`` runs via ``_check_recurrence_conflicts``,
    but returns a structured per-occurrence list instead of raising on the
    first clash — so the form indicator can show every conflict up front
    instead of revealing them one 409 at a time.

    Non-recurring inputs fall back to the single-window check and project
    the result into the same ``OccurrenceConflict`` shape so the frontend
    only has one branch to handle.
    """
    from app.api.event_venue.models import EventVenues

    # No venue → nothing to check. Treat as available so the indicator
    # doesn't fire on online-only / custom-location events.
    if payload.venue_id is None:
        return EventRecurringAvailabilityResult(
            available=True, total_occurrences=0, checked_occurrences=0
        )

    venue = db.get(EventVenues, payload.venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    # Compose the rrule string up front so a malformed rule fails fast
    # with the same 400 the create path would raise.
    rrule_str = format_rrule(payload.recurrence) if payload.recurrence else None

    duration = payload.end_time - payload.start_time

    # Non-recurring fast-path: reuse the single-window result and project
    # it into the recurring result schema.
    if not rrule_str:
        single = _run_availability_check(
            db,
            EventAvailabilityCheck(
                venue_id=payload.venue_id,
                start_time=payload.start_time,
                end_time=payload.end_time,
                exclude_event_id=payload.exclude_event_id,
            ),
            allow_unbookable=True,
        )
        if single.available:
            return EventRecurringAvailabilityResult(
                available=True,
                total_occurrences=1,
                checked_occurrences=1,
            )
        _ids, titles = _conflicting_event_summary(
            db,
            venue_id=payload.venue_id,
            start_time=payload.start_time,
            end_time=payload.end_time,
            exclude_event_id=payload.exclude_event_id,
        )
        return EventRecurringAvailabilityResult(
            available=False,
            total_occurrences=1,
            checked_occurrences=1,
            conflicts=[
                OccurrenceConflict(
                    occurrence_start=payload.start_time,
                    local_label=_format_occurrence_label(
                        payload.start_time, payload.timezone
                    ),
                    reason=single.reason or "Slot unavailable",
                    conflicting_event_ids=single.conflicts,
                    conflicting_titles=titles,
                    effective_booking_mode=single.effective_booking_mode,
                )
            ],
        )

    try:
        rule = parse_rrule(rrule_str)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid RRULE: {exc}")
    if rule is None:
        # Defensive — format_rrule -> parse_rrule should always round-trip.
        return EventRecurringAvailabilityResult(
            available=True, total_occurrences=0, checked_occurrences=0
        )

    occurrences = expand(
        dtstart=payload.start_time,
        rule=rule,
        exdates=list(payload.exdates or []),
        max_occurrences=DEFAULT_MAX_OCCURRENCES,
        timezone=payload.timezone,
    )
    total = len(occurrences)
    conflicts: list[OccurrenceConflict] = []
    truncated = False
    checked = 0

    for occ_start in occurrences:
        checked += 1
        issue = _find_venue_availability_issue(
            db,
            venue_id=payload.venue_id,
            start_time=occ_start,
            end_time=occ_start + duration,
            exclude_event_id=payload.exclude_event_id,
            allow_unbookable=True,
        )
        if issue is None:
            continue
        code, detail = issue
        # For 409 booking clashes also surface the conflicting titles/ids
        # so the indicator can name the offending event without an extra
        # round-trip.
        ids: list[uuid.UUID] = []
        titles: list[str] = []
        if code == 409 and detail.startswith("Venue already booked ("):
            ids, titles = _conflicting_event_summary(
                db,
                venue_id=payload.venue_id,
                start_time=occ_start,
                end_time=occ_start + duration,
                exclude_event_id=payload.exclude_event_id,
            )
        conflicts.append(
            OccurrenceConflict(
                occurrence_start=occ_start,
                local_label=_format_occurrence_label(occ_start, payload.timezone),
                reason=detail,
                conflicting_event_ids=ids,
                conflicting_titles=titles,
            )
        )
        if len(conflicts) >= _MAX_REPORTED_OCCURRENCE_CONFLICTS:
            truncated = True
            break

    return EventRecurringAvailabilityResult(
        available=len(conflicts) == 0,
        total_occurrences=total,
        checked_occurrences=checked,
        conflicts=conflicts,
        truncated=truncated,
    )


# ---------------------------------------------------------------------------
# Invitations (bulk paste)
# ---------------------------------------------------------------------------


@router.get("/{event_id}/invitations", response_model=list[EventInvitationPublic])
async def list_invitations(
    event_id: uuid.UUID,
    db: AdminOrApiKeySession_EventsRead,
    _: AdminOrApiKey_EventsRead,
) -> list[EventInvitationPublic]:
    from sqlmodel import select

    from app.api.event.models import EventInvitations
    from app.api.human.models import Humans

    rows = db.exec(
        select(EventInvitations, Humans)
        .where(EventInvitations.event_id == event_id)
        .where(Humans.id == EventInvitations.human_id)
    ).all()
    return [
        EventInvitationPublic(
            id=inv.id,
            event_id=inv.event_id,
            human_id=inv.human_id,
            email=human.email,
            first_name=human.first_name,
            last_name=human.last_name,
            created_at=inv.created_at,
        )
        for inv, human in rows
    ]


def _run_bulk_invite(
    db,
    event,
    emails: Iterable[str],
    inviter_id: uuid.UUID,
) -> EventInvitationBulkResult:
    """Create invitations for the given emails (skipping unknowns and dupes).

    Shared by the staff-side and portal bulk-invite endpoints. Caller is
    responsible for resolving the event and authorising the inviter.
    """
    from sqlmodel import select

    from app.api.human.models import Humans

    cleaned = {e.strip().lower() for e in emails if e.strip()}
    if not cleaned:
        raise HTTPException(status_code=400, detail="No valid emails provided")

    humans = list(
        db.exec(
            select(Humans)
            .where(Humans.tenant_id == event.tenant_id)
            .where(Humans.email.in_(cleaned))
        ).all()
    )
    found_by_email = {h.email.lower(): h for h in humans}
    not_found = sorted(e for e in cleaned if e not in found_by_email)

    created, skipped_ids = crud.invitations_crud.create_bulk_for_humans(
        db,
        event=event,
        humans=list(found_by_email.values()),
        inviter_id=inviter_id,
    )
    id_to_email = {h.id: email for email, h in found_by_email.items()}
    skipped_existing = sorted(id_to_email[hid] for hid in skipped_ids)

    by_id = {h.id: h for h in found_by_email.values()}
    invited_public = [
        EventInvitationPublic(
            id=inv.id,
            event_id=inv.event_id,
            human_id=inv.human_id,
            email=by_id[inv.human_id].email,
            first_name=by_id[inv.human_id].first_name,
            last_name=by_id[inv.human_id].last_name,
            created_at=inv.created_at,
        )
        for inv in created
    ]

    return EventInvitationBulkResult(
        invited=invited_public,
        skipped_existing=skipped_existing,
        not_found=not_found,
    )


@router.post(
    "/{event_id}/invitations",
    response_model=EventInvitationBulkResult,
    status_code=status.HTTP_201_CREATED,
)
async def bulk_invite(
    event_id: uuid.UUID,
    payload: EventInvitationBulkCreate,
    db: AdminOrApiKeySession_EventsWrite,
    current_user: AdminOrApiKey_EventsWrite,
) -> EventInvitationBulkResult:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    result = _run_bulk_invite(db, event, payload.emails, current_user.id)
    await _send_event_invitation_emails(db, event, result.invited)
    return result


@router.delete(
    "/{event_id}/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_invitation(
    event_id: uuid.UUID,
    invitation_id: uuid.UUID,
    db: AdminOrApiKeySession_EventsWrite,
    _: AdminOrApiKey_EventsWrite,
) -> None:
    inv = crud.invitations_crud.get(db, invitation_id)
    if not inv or inv.event_id != event_id:
        raise HTTPException(status_code=404, detail="Invitation not found")
    crud.invitations_crud.delete(db, inv)


# ---------------------------------------------------------------------------
# Portal invitations — event owner only
# ---------------------------------------------------------------------------


def _ensure_portal_event_owner(db, event_id: uuid.UUID, current_human):
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_human.id:
        raise HTTPException(
            status_code=403,
            detail="Only the event owner can manage invitations",
        )
    return event


@router.get(
    "/portal/events/{event_id}/invitations",
    response_model=list[EventInvitationPublic],
)
async def list_portal_invitations(
    event_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> list[EventInvitationPublic]:
    from sqlmodel import select

    from app.api.event.models import EventInvitations
    from app.api.human.models import Humans

    _ensure_portal_event_owner(db, event_id, current_human)
    rows = db.exec(
        select(EventInvitations, Humans)
        .where(EventInvitations.event_id == event_id)
        .where(Humans.id == EventInvitations.human_id)
    ).all()
    return [
        EventInvitationPublic(
            id=inv.id,
            event_id=inv.event_id,
            human_id=inv.human_id,
            email=human.email,
            first_name=human.first_name,
            last_name=human.last_name,
            created_at=inv.created_at,
        )
        for inv, human in rows
    ]


class EventApprovalPayload(BaseModel):
    reason: str | None = None


async def _send_event_approval_email(
    db,
    event,
    *,
    approved: bool,
    reason: str | None,
) -> None:
    """Best-effort email to the event creator after an approval decision."""
    from app.api.human.models import Humans
    from app.core.config import settings
    from app.services.email import (
        EventApprovalApprovedContext,
        EventApprovalRejectedContext,
        get_email_service,
    )

    if not settings.emails_enabled:
        return

    human = db.get(Humans, event.owner_id)
    if not human or not human.email:
        return

    popup = getattr(event, "popup", None)
    popup_name = popup.name if popup else ""
    popup_slug = getattr(popup, "slug", None) if popup else None
    venue_title = getattr(getattr(event, "venue", None), "title", "") or ""

    event_url = ""
    if popup_slug and popup and popup.tenant:
        from app.api.tenant.utils import get_portal_url

        portal_base = get_portal_url(popup.tenant)
        event_url = f"{portal_base.rstrip('/')}/portal/{popup_slug}/events/{event.id}"

    when = (
        format_event_when(event.start_time, event.timezone) if event.start_time else ""
    )

    service = get_email_service()
    from_address = popup.tenant.sender_email if popup and popup.tenant else None
    from_name = popup.tenant.sender_name if popup and popup.tenant else None

    try:
        if approved:
            await service.send_event_approval_approved(
                to=human.email,
                subject=f'Your event "{event.title}" was approved',
                context=EventApprovalApprovedContext(
                    first_name=human.first_name or "",
                    event_title=event.title or "",
                    popup_name=popup_name,
                    event_when=when,
                    venue_title=venue_title,
                    event_url=event_url,
                    reason=reason or "",
                ),
                from_address=from_address,
                from_name=from_name,
                popup_id=event.popup_id,
                db_session=db,
            )
        else:
            await service.send_event_approval_rejected(
                to=human.email,
                subject=f'Your event "{event.title}" was not approved',
                context=EventApprovalRejectedContext(
                    first_name=human.first_name or "",
                    event_title=event.title or "",
                    popup_name=popup_name,
                    event_when=when,
                    venue_title=venue_title,
                    reason=reason or "",
                ),
                from_address=from_address,
                from_name=from_name,
                popup_id=event.popup_id,
                db_session=db,
            )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to send event approval email for {}: {}", event.id, exc)


@router.post("/{event_id}/approve", response_model=EventPublic)
async def approve_event(
    event_id: uuid.UUID,
    payload: EventApprovalPayload,
    db: AdminOrApiKeySession_EventsWrite,
    _: AdminOrApiKey_EventsWrite,
) -> EventPublic:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.status != EventStatus.PENDING_APPROVAL:
        raise HTTPException(
            status_code=400,
            detail=f"Event is not pending approval (status={event.status})",
        )
    event.status = EventStatus.PUBLISHED
    event.visibility = EventVisibility.PUBLIC
    db.add(event)
    db.commit()
    db.refresh(event)
    await _send_event_approval_email(db, event, approved=True, reason=payload.reason)

    # Now that the event is live, push the calendar invite to anyone who
    # had been invited or RSVPd while it was pending. Both paths go to
    # ``send_event_itip`` so the per-recipient occurrence_start (for any
    # recurring-instance RSVPers) and stable master UID land correctly.
    try:
        recipients = _gather_event_recipients(db, event)
        if recipients:
            await _send_event_itip(db, event, recipients, method="REQUEST")
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "Failed to dispatch iTIP REQUEST on approve for {}: {}",
            event.id,
            exc,
        )

    return _to_public(event)


@router.post("/{event_id}/reject", response_model=EventPublic)
async def reject_event(
    event_id: uuid.UUID,
    payload: EventApprovalPayload,
    db: AdminOrApiKeySession_EventsWrite,
    _: AdminOrApiKey_EventsWrite,
) -> EventPublic:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.status != EventStatus.PENDING_APPROVAL:
        raise HTTPException(
            status_code=400,
            detail=f"Event is not pending approval (status={event.status})",
        )
    event.status = EventStatus.REJECTED
    event.rejection_reason = payload.reason
    db.add(event)
    db.commit()
    db.refresh(event)
    await _send_event_approval_email(db, event, approved=False, reason=payload.reason)
    return _to_public(event)


@router.post(
    "/portal/events/{event_id}/invitations",
    response_model=EventInvitationBulkResult,
    status_code=status.HTTP_201_CREATED,
)
async def bulk_invite_portal(
    event_id: uuid.UUID,
    payload: EventInvitationBulkCreate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> EventInvitationBulkResult:
    event = _ensure_portal_event_owner(db, event_id, current_human)
    result = _run_bulk_invite(db, event, payload.emails, current_human.id)
    await _send_event_invitation_emails(db, event, result.invited)
    return result


@router.delete(
    "/portal/events/{event_id}/invitations/{invitation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_portal_invitation(
    event_id: uuid.UUID,
    invitation_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> None:
    _ensure_portal_event_owner(db, event_id, current_human)
    inv = crud.invitations_crud.get(db, invitation_id)
    if not inv or inv.event_id != event_id:
        raise HTTPException(status_code=404, detail="Invitation not found")
    crud.invitations_crud.delete(db, inv)


# ---------------------------------------------------------------------------
# iCal export
# ---------------------------------------------------------------------------


@router.get("/{event_id}/ics")
async def export_event_ics(
    event_id: uuid.UUID,
    db: AdminOrApiKeySession_EventsRead,
    _: AdminOrApiKey_EventsRead,
) -> Response:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    body = _render_ics(event)
    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="event-{event.id}.ics"'},
    )


# ---------------------------------------------------------------------------
# Portal endpoints (human token)
# ---------------------------------------------------------------------------


def _portal_visibility_filter(db, events: list, human_id: uuid.UUID) -> list:
    """Apply visibility rules to a portal event list.

    Rules:
    - public: visible to all.
    - private: only owner + invited humans.
    - unlisted: hidden from public listings, but the owner still sees their
      own unlisted events (e.g. pending_approval requests they created).
      Detail is reachable via direct link for non-owners.
    """
    from sqlmodel import select

    from app.api.event.models import EventInvitations

    private_event_ids = [
        e.id for e in events if e.visibility == EventVisibility.PRIVATE
    ]
    invited_map: dict[uuid.UUID, set[uuid.UUID]] = {}
    if private_event_ids:
        invs = list(
            db.exec(
                select(EventInvitations).where(
                    EventInvitations.event_id.in_(private_event_ids)
                )
            ).all()
        )
        for inv in invs:
            invited_map.setdefault(inv.event_id, set()).add(inv.human_id)

    visible = []
    for e in events:
        if e.visibility == EventVisibility.PUBLIC:
            visible.append(e)
        elif e.visibility == EventVisibility.UNLISTED:
            if e.owner_id == human_id:
                visible.append(e)
        elif e.visibility == EventVisibility.PRIVATE:
            if _invitation_visible_to_human(e, human_id, invited_map.get(e.id, set())):
                visible.append(e)
    return visible


@router.get("/portal/events", response_model=ListModel[EventPublic])
async def list_portal_events(
    db: HumanTenantSession,
    current_human: CurrentHuman,
    popup_id: uuid.UUID | None = None,
    event_status: EventStatus | None = None,
    kind: str | None = None,
    venue_id: uuid.UUID | None = None,
    track_ids: list[uuid.UUID] | None = Query(default=None),
    tags: list[str] | None = Query(default=None),
    start_after: datetime | None = None,
    start_before: datetime | None = None,
    search: str | None = None,
    rsvped_only: bool = False,
    include_hidden: bool = False,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[EventPublic]:
    if popup_id:
        events, total = crud.events_crud.find_by_popup(
            db,
            popup_id=popup_id,
            skip=skip,
            limit=limit,
            event_status=event_status,
            kind=kind,
            venue_id=venue_id,
            track_ids=track_ids,
            tags=tags,
            start_after=start_after,
            start_before=start_before,
            search=search,
        )
    else:
        events, total = crud.events_crud.find(
            db,
            skip=skip,
            limit=limit,
            search=search,
            search_fields=["title"],
        )

    visible = _portal_visibility_filter(db, events, current_human.id)
    # Cancelled events are removed from every portal listing — owners who want
    # to see them after the fact can still hit the detail URL directly. The
    # ``event_status`` query param can't express "exclude cancelled" alongside
    # ``None`` (which the "mine" channel uses to include drafts/pending), so we
    # filter here unconditionally.
    visible = [e for e in visible if e.status != EventStatus.CANCELLED]

    def _rsvp_lookup_key(e) -> tuple[uuid.UUID, datetime | None]:
        """Build the ``(event_id, occurrence_start)`` key used to find this
        user's RSVP row. RSVPs for recurring events are per-occurrence, so
        every recurring row — expanded pseudo-rows, detached override
        children, and the master itself — maps to its own occurrence's
        ``start_time``. The master's ``start_time`` IS the first
        occurrence's dtstart, so it shares the same key as its expanded
        siblings.
        """
        is_expanded = e.__dict__.get("_occurrence_id") is not None
        if is_expanded:
            return (e.id, e.start_time)
        if getattr(e, "recurrence_master_id", None):
            return (e.recurrence_master_id, e.start_time)
        if getattr(e, "rrule", None):
            return (e.id, e.start_time)
        return (e.id, None)

    if rsvped_only:
        from sqlmodel import select

        from app.api.event_participant.models import EventParticipants
        from app.api.event_participant.schemas import ParticipantStatus

        keys: list[tuple[uuid.UUID, datetime | None]] = []
        for e in visible:
            k = _rsvp_lookup_key(e)
            if k is not None:
                keys.append(k)
        if keys:
            event_ids = list({k[0] for k in keys})
            rows = db.exec(
                select(
                    EventParticipants.event_id,
                    EventParticipants.occurrence_start,
                )
                .where(EventParticipants.profile_id == current_human.id)
                .where(EventParticipants.event_id.in_(event_ids))
                .where(EventParticipants.status != ParticipantStatus.CANCELLED)
            ).all()
            active_set = {(row[0], row[1]) for row in rows}
            visible = [
                e
                for e in visible
                if (k := _rsvp_lookup_key(e)) is not None and k in active_set
            ]
        else:
            visible = []

    # Hide events the human previously dismissed. We hide the series as a
    # whole: an event is filtered if its own id OR its recurrence_master_id
    # sits in the hidden set.
    from sqlmodel import select

    from app.api.event.models import EventHiddenByHuman

    hidden_ids = set(
        db.exec(
            select(EventHiddenByHuman.event_id).where(
                EventHiddenByHuman.human_id == current_human.id
            )
        ).all()
    )
    if hidden_ids and not include_hidden:
        visible = [
            e
            for e in visible
            if e.id not in hidden_ids
            and (e.recurrence_master_id or e.id) not in hidden_ids
        ]

    venue_map = _venue_map_for_events(db, visible)
    track_map = _track_map_for_events(db, visible)

    # RSVP status of current human per event, so cards can render the right
    # inline button without an extra batch call from the client.
    from app.api.event_participant.models import EventParticipants

    rsvp_status_map: dict[tuple[uuid.UUID, datetime | None], str] = {}
    if visible:
        keys = [_rsvp_lookup_key(e) for e in visible]
        event_ids = list({k[0] for k in keys if k is not None})
        if event_ids:
            rows = db.exec(
                select(
                    EventParticipants.event_id,
                    EventParticipants.occurrence_start,
                    EventParticipants.status,
                )
                .where(EventParticipants.profile_id == current_human.id)
                .where(EventParticipants.event_id.in_(event_ids))
            ).all()
            rsvp_status_map = {(row[0], row[1]): row[2] for row in rows}

    def _publicize(e) -> EventPublic:
        pub = _to_public(e, venue_map, track_map)
        updates: dict = {}
        if hidden_ids and (
            e.id in hidden_ids
            or (e.recurrence_master_id and e.recurrence_master_id in hidden_ids)
        ):
            updates["hidden"] = True
        # RSVP rows are scoped to a specific occurrence for recurring events
        # so the user can be "Going" to one instance without flipping the
        # state of every sibling instance.
        rsvp_key = _rsvp_lookup_key(e)
        if rsvp_key is not None and rsvp_key in rsvp_status_map:
            updates["my_rsvp_status"] = rsvp_status_map[rsvp_key]
        if updates:
            pub = pub.model_copy(update=updates)
        return pub

    return ListModel[EventPublic](
        results=[_publicize(e) for e in visible],
        paging=Paging(offset=skip, limit=limit, total=len(visible)),
    )


@router.get("/portal/popup-tags/{popup_id}", response_model=list[str])
async def list_portal_popup_tags(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
    _: CurrentHuman,
) -> list[str]:
    """Distinct event tags for the popup — used by the portal events
    toolbar to populate the tag filter."""
    return crud.events_crud.list_distinct_tags(
        db, popup_id=popup_id, only_published_public=False
    )


@router.get("/portal/events/hidden-count")
async def portal_hidden_events_count(
    db: HumanTenantSession,
    current_human: CurrentHuman,
    popup_id: uuid.UUID | None = None,
) -> dict[str, int]:
    """Return how many events the human has hidden (optionally for a popup).

    Used by the portal toolbar to render ``Hidden (n)`` without having to
    fetch the full list twice.
    """
    from sqlalchemy import distinct, func
    from sqlmodel import select

    from app.api.event.models import EventHiddenByHuman, Events

    # We count by distinct hide targets: each hide row is already unique per
    # (human, event), so a plain count of matching events = number of
    # currently-hidden "series or one-off" events. If ``popup_id`` is given,
    # restrict to hides that point at events in that popup.
    stmt = select(func.count(distinct(EventHiddenByHuman.event_id))).where(
        EventHiddenByHuman.human_id == current_human.id
    )
    if popup_id is not None:
        stmt = stmt.select_from(
            EventHiddenByHuman.__table__.join(
                Events.__table__,
                EventHiddenByHuman.event_id == Events.id,
            )
        ).where(Events.popup_id == popup_id)
    count = db.exec(stmt).one()
    return {"count": int(count or 0)}


@router.get("/portal/events/{event_id}", response_model=EventPublic)
async def get_portal_event(
    event_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    occurrence_start: datetime | None = None,
) -> EventPublic:
    """Fetch a single event for the portal.

    ``occurrence_start`` scopes the user's RSVP lookup to a specific
    instance of a recurring event so the detail page reflects the
    occurrence's status (not the series' first instance).
    """
    from sqlmodel import select

    from app.api.event.models import EventInvitations

    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )

    if event.visibility == EventVisibility.PRIVATE:
        invited = db.exec(
            select(EventInvitations)
            .where(EventInvitations.event_id == event_id)
            .where(EventInvitations.human_id == current_human.id)
        ).first()
        if not invited and event.owner_id != current_human.id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
            )
    # Public + unlisted are accessible via direct ID.

    from app.api.event_participant.models import EventParticipants

    rsvp_event_id = event.recurrence_master_id or event.id
    # RSVPs for recurring events are per-occurrence. When the detail page
    # lands on a series master without ?occ=, treat it as the first
    # occurrence (the master's own start_time IS the first occurrence's
    # dtstart) so we find the RSVP row the portal just created.
    if occurrence_start is None and event.rrule:
        occurrence_start = event.start_time
    rsvp_q = (
        select(EventParticipants.status)
        .where(EventParticipants.profile_id == current_human.id)
        .where(EventParticipants.event_id == rsvp_event_id)
    )
    if occurrence_start is None:
        rsvp_q = rsvp_q.where(
            EventParticipants.occurrence_start.is_(None)  # type: ignore[union-attr]
        )
    else:
        rsvp_q = rsvp_q.where(EventParticipants.occurrence_start == occurrence_start)
    rsvp = db.exec(rsvp_q).first()

    pub = _to_public(event)
    if rsvp:
        pub = pub.model_copy(update={"my_rsvp_status": rsvp})
    return pub


# ---------------------------------------------------------------------------
# Portal admin notes — same staff-only notes as the backoffice endpoints,
# reachable from the portal. Gated by CurrentPortalStaff (the logged-in human's
# email must match a backoffice User in the tenant), so regular hosts/community
# members get 403 and never see the notes. Not ownership-scoped: staff may
# annotate any event in the popup.
# ---------------------------------------------------------------------------


@router.get(
    "/portal/events/{event_id}/admin-notes", response_model=EventAdminNotes
)
async def get_portal_event_admin_notes(
    event_id: uuid.UUID,
    db: HumanTenantSession,
    _: CurrentPortalStaff,
) -> EventAdminNotes:
    """Read an event's staff-only notes from the portal (staff humans only)."""
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )
    return EventAdminNotes(notes=event.admin_notes)


@router.put(
    "/portal/events/{event_id}/admin-notes", response_model=EventAdminNotes
)
async def update_portal_event_admin_notes(
    event_id: uuid.UUID,
    payload: EventAdminNotes,
    db: HumanTenantSession,
    _: CurrentPortalStaff,
) -> EventAdminNotes:
    """Set an event's staff-only notes from the portal (staff humans only)."""
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )
    event.admin_notes = payload.notes
    db.add(event)
    db.commit()
    db.refresh(event)
    return EventAdminNotes(notes=event.admin_notes)


@router.post("/portal/events/{event_id}/hide", status_code=status.HTTP_204_NO_CONTENT)
async def hide_portal_event(
    event_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> None:
    """Hide an event from the current human's portal.

    If the event is an expanded recurrence occurrence (virtual id like
    ``{master}_{ts}``), we can't persist it directly — hide the master
    instead. If it's a real exception override with a master, hide the
    master so all siblings disappear together.
    """
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )

    target_id = event.recurrence_master_id or event.id
    crud.hidden_by_human_crud.hide(
        db,
        tenant_id=current_human.tenant_id,
        human_id=current_human.id,
        event_id=target_id,
    )


@router.delete("/portal/events/{event_id}/hide", status_code=status.HTTP_204_NO_CONTENT)
async def unhide_portal_event(
    event_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> None:
    """Undo a prior hide."""
    event = crud.events_crud.get(db, event_id)
    target_id = event.recurrence_master_id or event.id if event else event_id
    crud.hidden_by_human_crud.unhide(
        db,
        human_id=current_human.id,
        event_id=target_id,
    )


@router.post(
    "/portal/events", response_model=EventPublic, status_code=status.HTTP_201_CREATED
)
async def create_portal_event(
    event_in: EventCreate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> EventPublic:
    from app.api.event.models import Events
    from app.api.event_settings.crud import event_settings_crud

    settings = event_settings_crud.get_by_popup_id(db, event_in.popup_id)
    if settings and not settings.event_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Event creation is disabled for this popup",
        )
    if settings and settings.can_publish_event == "admin_only":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can create events for this popup",
        )

    from app.api.popup.crud import popups_crud

    popup = popups_crud.get(db, event_in.popup_id)
    _check_event_within_popup_window(
        popup, start_time=event_in.start_time, end_time=event_in.end_time
    )

    rrule_str = format_rrule(event_in.recurrence) if event_in.recurrence else None

    if event_in.venue_id is not None:
        _check_recurrence_conflicts(
            db,
            venue_id=event_in.venue_id,
            start_time=event_in.start_time,
            end_time=event_in.end_time,
            rrule_str=rrule_str,
            exdates=None,
            timezone=event_in.timezone,
        )

    event_data = event_in.model_dump()
    event_data.pop("recurrence", None)
    # Defense-in-depth: the schema validator already rejects venue+custom
    # collisions, but if either side is set we still null out the other so
    # downstream code never sees both populated.
    if event_data.get("custom_location_name"):
        event_data["venue_id"] = None
    elif event_data.get("venue_id") is not None:
        event_data["custom_location_name"] = None
        event_data["custom_location_url"] = None
    event_data["rrule"] = rrule_str
    event_data["tenant_id"] = current_human.tenant_id
    event_data["owner_id"] = current_human.id

    # Reasons the event might need approval:
    #  1. Popup-level setting requires admin approval for human-created events.
    #  2. Venue is bookable only with admin approval (booking_mode).
    #  3. User requested ``max_participant`` larger than the venue capacity.
    # Custom-location events skip (2) and (3) (no venue), but (1) still
    # applies so admins keep moderation control over off-site portal events.
    requires_approval = False
    approval_reason = ""
    if settings and settings.events_require_approval:
        requires_approval = True
        approval_reason = "Event submissions require admin approval."
    venue = None
    if event_in.venue_id is not None:
        from app.api.event_venue import crud as venue_crud

        venue = venue_crud.event_venues_crud.get(db, event_in.venue_id)
        if venue:
            effective_mode = _resolve_effective_booking_mode(
                db, venue, event_in.start_time, event_in.end_time
            )
            if effective_mode == "approval_required":
                requires_approval = True
                approval_reason = "Venue requires admin approval at the selected time."
        if (
            venue
            and venue.capacity
            and event_in.max_participant
            and event_in.max_participant > venue.capacity
        ):
            requires_approval = True
            approval_reason = (
                f"Requested max_participant ({event_in.max_participant}) "
                f"exceeds venue capacity ({venue.capacity})."
            )

    if requires_approval:
        event_data["status"] = EventStatus.PENDING_APPROVAL
        event_data["visibility"] = EventVisibility.UNLISTED

    event = Events(**event_data)

    db.add(event)
    db.commit()
    db.refresh(event)

    if requires_approval:
        from app.api.popup.crud import popups_crud
        from app.services.approval_notify import notify_event_pending_approval

        popup = popups_crud.get(db, event.popup_id)
        await notify_event_pending_approval(
            event, popup, settings, reason=approval_reason
        )

    return _to_public(event)


@router.patch("/portal/events/{event_id}", response_model=EventPublic)
async def update_portal_event(
    event_id: uuid.UUID,
    event_in: EventUpdate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> EventPublic:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )
    if event.owner_id != current_human.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the event owner can edit",
        )

    new_venue_id = (
        event_in.venue_id if event_in.venue_id is not None else event.venue_id
    )
    new_start = event_in.start_time or event.start_time
    new_end = event_in.end_time or event.end_time
    timing_or_venue_changed = (
        event_in.venue_id is not None
        or event_in.start_time is not None
        or event_in.end_time is not None
    )
    if event_in.start_time is not None or event_in.end_time is not None:
        from app.api.popup.crud import popups_crud

        popup = popups_crud.get(db, event.popup_id)
        _check_event_within_popup_window(popup, start_time=new_start, end_time=new_end)
    if new_venue_id is not None and timing_or_venue_changed:
        _check_recurrence_conflicts(
            db,
            venue_id=new_venue_id,
            start_time=new_start,
            end_time=new_end,
            rrule_str=event.rrule,
            exdates=list(event.recurrence_exdates or []),
            exclude_event_id=event.id,
            timezone=event_in.timezone or event.timezone,
        )

    # Transition: switching to a venue clears any prior custom location, and
    # switching to a custom location clears the prior venue. Rebuild via the
    # dump dict so the cleared fields are tracked as set.
    patch_dict = event_in.model_dump(exclude_unset=True)
    if patch_dict.get("venue_id") is not None:
        patch_dict["custom_location_name"] = None
        patch_dict["custom_location_url"] = None
    elif patch_dict.get("custom_location_name") is not None:
        patch_dict["venue_id"] = None
    event_in = EventUpdate(**patch_dict)

    before = {
        "title": event.title,
        "start_time": event.start_time,
        "end_time": event.end_time,
        "venue_id": event.venue_id,
        "content": event.content,
        "custom_location_name": event.custom_location_name,
        "custom_location_url": event.custom_location_url,
    }
    updated = crud.events_crud.update(db, event, event_in)
    if _event_calendar_fields_changed(before, updated):
        await _bump_and_dispatch_itip_update(db, updated, before=before)
    return _to_public(updated)


@router.post("/portal/events/{event_id}/cancel", response_model=EventPublic)
async def cancel_portal_event(
    event_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> EventPublic:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )
    if event.owner_id != current_human.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the event owner can cancel",
        )
    if event.status == EventStatus.CANCELLED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Event is already cancelled",
        )

    cancel_update = EventUpdate(status=EventStatus.CANCELLED)
    updated = crud.events_crud.update(db, event, cancel_update)
    await _bump_and_dispatch_itip_cancel(db, updated)
    return _to_public(updated)


@router.get("/portal/events/{event_id}/ics")
async def export_portal_event_ics(
    event_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> Response:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    # Re-use the same visibility gate as the detail endpoint.
    if (
        event.visibility == EventVisibility.PRIVATE
        and event.owner_id != current_human.id
    ):
        from sqlmodel import select

        from app.api.event.models import EventInvitations

        invited = db.exec(
            select(EventInvitations)
            .where(EventInvitations.event_id == event_id)
            .where(EventInvitations.human_id == current_human.id)
        ).first()
        if not invited:
            raise HTTPException(status_code=404, detail="Event not found")

    body = _render_ics(event)
    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="event-{event.id}.ics"'},
    )
