import uuid
from datetime import datetime
from typing import Iterable

from fastapi import APIRouter, HTTPException, Response, status
from loguru import logger

from app.api.event import crud
from app.api.event.recurrence import (
    DEFAULT_MAX_OCCURRENCES,
    expand,
    format_rrule,
    parse_rrule,
)
from app.api.event.schemas import (
    EventAvailabilityCheck,
    EventAvailabilityResult,
    EventCreate,
    EventInvitationBulkCreate,
    EventInvitationBulkResult,
    EventInvitationPublic,
    EventPublic,
    EventStatus,
    EventUpdate,
    EventVisibility,
    OccurrenceRef,
    RecurrenceUpdate,
)
from app.api.google_calendar import service as gcal_service
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentUser,
    CurrentWriter,
    HumanTenantSession,
    TenantSession,
)

router = APIRouter(prefix="/events", tags=["events"])


def _safe_gcal_sync_all(db, event) -> None:
    """Propagate an event change to every registered participant's GCal."""
    try:
        gcal_service.sync_event_to_all_participants(db, event)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "GCal propagation failed for event {}: {}", getattr(event, "id", None), exc
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _check_venue_availability(
    db,
    venue_id: uuid.UUID,
    start_time: datetime,
    end_time: datetime,
    exclude_event_id: uuid.UUID | None = None,
) -> None:
    """Raise 409 if the window collides with an existing booking."""
    from app.api.event_venue.models import EventVenues
    from app.api.event_venue.schemas import VenueBookingMode

    venue = db.get(EventVenues, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")
    if venue.booking_mode == VenueBookingMode.UNBOOKABLE.value:
        raise HTTPException(status_code=409, detail="Venue is not bookable")

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
        raise HTTPException(
            status_code=409,
            detail=f"Venue already booked (conflicts: {titles})",
        )


def _to_public(event) -> EventPublic:
    """Convert an Events row (or expanded pseudo-row) to EventPublic.

    Propagates the synthetic ``occurrence_id`` set by
    :func:`app.api.event.crud._clone_as_occurrence`.
    """
    data = EventPublic.model_validate(event)
    occ = event.__dict__.get("_occurrence_id") if hasattr(event, "__dict__") else None
    if occ:
        data = data.model_copy(update={"occurrence_id": occ})
    return data


def _check_recurrence_conflicts(
    db,
    *,
    venue_id: uuid.UUID | None,
    start_time: datetime,
    end_time: datetime,
    rrule_str: str | None,
    exdates: list | None,
    exclude_event_id: uuid.UUID | None = None,
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
        )
        return

    duration = end_time - start_time
    occurrences = expand(
        dtstart=start_time,
        rule=rule,
        exdates=list(exdates or []),
        max_occurrences=DEFAULT_MAX_OCCURRENCES,
    )
    if not occurrences:
        raise HTTPException(
            status_code=400,
            detail="Recurrence expands to zero occurrences",
        )
    for occ_start in occurrences:
        _check_venue_availability(
            db,
            venue_id=venue_id,
            start_time=occ_start,
            end_time=occ_start + duration,
            exclude_event_id=exclude_event_id,
        )


def _render_ics(event) -> str:
    """Render a minimal, RFC-5545-compliant VCALENDAR string for one event."""
    dtstamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    dtstart = event.start_time.strftime("%Y%m%dT%H%M%SZ")
    dtend = event.end_time.strftime("%Y%m%dT%H%M%SZ")
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


def _invitation_visible_to_human(event, human_id: uuid.UUID, invitation_human_ids: Iterable[uuid.UUID]) -> bool:
    """A private event is only visible to owner + explicitly invited humans."""
    if event.owner_id == human_id:
        return True
    return human_id in invitation_human_ids


# ---------------------------------------------------------------------------
# Backoffice endpoints (user token)
# ---------------------------------------------------------------------------


@router.get("", response_model=ListModel[EventPublic])
async def list_events(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    event_status: EventStatus | None = None,
    kind: str | None = None,
    venue_id: uuid.UUID | None = None,
    track_id: uuid.UUID | None = None,
    start_after: datetime | None = None,
    start_before: datetime | None = None,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[EventPublic]:
    """List events with optional filters (backoffice)."""
    if popup_id:
        events, total = crud.events_crud.find_by_popup(
            db,
            popup_id=popup_id,
            skip=skip,
            limit=limit,
            event_status=event_status,
            kind=kind,
            venue_id=venue_id,
            track_id=track_id,
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

    return ListModel[EventPublic](
        results=[_to_public(e) for e in events],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{event_id}", response_model=EventPublic)
async def get_event(
    event_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> EventPublic:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return _to_public(event)


@router.post("", response_model=EventPublic, status_code=status.HTTP_201_CREATED)
async def create_event(
    event_in: EventCreate,
    db: TenantSession,
    current_user: CurrentWriter,
) -> EventPublic:
    from app.api.event.models import Events
    from app.api.popup.crud import popups_crud
    from app.api.shared.enums import UserRole

    popup = popups_crud.get(db, event_in.popup_id)
    if not popup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found")

    rrule_str = format_rrule(event_in.recurrence) if event_in.recurrence else None

    if event_in.venue_id is not None:
        _check_recurrence_conflicts(
            db,
            venue_id=event_in.venue_id,
            start_time=event_in.start_time,
            end_time=event_in.end_time,
            rrule_str=rrule_str,
            exdates=None,
        )

    tenant_id = popup.tenant_id if current_user.role == UserRole.SUPERADMIN else current_user.tenant_id

    event_data = event_in.model_dump()
    event_data.pop("recurrence", None)
    event_data["rrule"] = rrule_str
    event_data["tenant_id"] = tenant_id
    event_data["owner_id"] = current_user.id
    event = Events(**event_data)

    db.add(event)
    db.commit()
    db.refresh(event)
    return _to_public(event)


@router.patch("/{event_id}", response_model=EventPublic)
async def update_event(
    event_id: uuid.UUID,
    event_in: EventUpdate,
    db: TenantSession,
    _: CurrentWriter,
) -> EventPublic:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    new_venue_id = event_in.venue_id if event_in.venue_id is not None else event.venue_id
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
        )

    updated = crud.events_crud.update(db, event, event_in)
    _safe_gcal_sync_all(db, updated)
    return _to_public(updated)


@router.post("/{event_id}/cancel", response_model=EventPublic)
async def cancel_event(
    event_id: uuid.UUID,
    db: TenantSession,
    _: CurrentWriter,
) -> EventPublic:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if event.status == EventStatus.CANCELLED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Event is already cancelled")

    cancel_update = EventUpdate(status=EventStatus.CANCELLED)
    updated = crud.events_crud.update(db, event, cancel_update)
    _safe_gcal_sync_all(db, updated)
    return _to_public(updated)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: uuid.UUID,
    db: TenantSession,
    _: CurrentWriter,
) -> None:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    # Best-effort: delete mirrors in every connected participant's GCal.
    try:
        _delete_gcal_for_all(db, event)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("GCal cleanup on event delete {} failed: {}", event_id, exc)
    crud.events_crud.delete(db, event)


def _delete_gcal_for_all(db, event) -> None:
    """Remove gcal mirrors for every non-cancelled participant."""
    from sqlmodel import select

    from app.api.event_participant.models import EventParticipants
    from app.api.event_participant.schemas import ParticipantStatus

    participants = list(
        db.exec(
            select(EventParticipants)
            .where(EventParticipants.event_id == event.id)
            .where(EventParticipants.status != ParticipantStatus.CANCELLED)
        ).all()
    )
    for p in participants:
        try:
            gcal_service.delete_event_for_human(db, event, p.profile_id)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "GCal delete failed for human {} event {}: {}",
                p.profile_id,
                event.id,
                exc,
            )


# ---------------------------------------------------------------------------
# Recurrence
# ---------------------------------------------------------------------------


@router.patch("/{event_id}/recurrence", response_model=EventPublic)
async def set_recurrence(
    event_id: uuid.UUID,
    payload: RecurrenceUpdate,
    db: TenantSession,
    _: CurrentWriter,
) -> EventPublic:
    """Set/replace/clear the RRULE on a series master.

    Sending ``{"recurrence": null}`` clears the rule (the event becomes a
    one-off). Sending a ``RecurrenceRule`` sets/replaces it. EXDATEs are
    cleared when the rule changes to avoid stale skips.
    """
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if event.recurrence_master_id is not None:
        raise HTTPException(
            status_code=400,
            detail="Cannot set a recurrence rule on a detached occurrence",
        )

    new_rrule = format_rrule(payload.recurrence) if payload.recurrence else None

    if event.venue_id is not None:
        _check_recurrence_conflicts(
            db,
            venue_id=event.venue_id,
            start_time=event.start_time,
            end_time=event.end_time,
            rrule_str=new_rrule,
            exdates=None,
            exclude_event_id=event.id,
        )

    event.rrule = new_rrule
    event.recurrence_exdates = []
    db.add(event)
    db.commit()
    db.refresh(event)
    return _to_public(event)


@router.post("/{event_id}/detach-occurrence", response_model=EventPublic)
async def detach_occurrence(
    event_id: uuid.UUID,
    payload: OccurrenceRef,
    db: TenantSession,
    _: CurrentWriter,
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
    return _to_public(child)


@router.delete("/{event_id}/occurrence", status_code=status.HTTP_204_NO_CONTENT)
async def delete_occurrence(
    event_id: uuid.UUID,
    payload: OccurrenceRef,
    db: TenantSession,
    _: CurrentWriter,
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


# ---------------------------------------------------------------------------
# Availability check
# ---------------------------------------------------------------------------


@router.post("/check-availability", response_model=EventAvailabilityResult)
async def check_availability(
    payload: EventAvailabilityCheck,
    db: TenantSession,
    _: CurrentUser,
) -> EventAvailabilityResult:
    """Check whether a venue is free for a candidate time window."""
    from app.api.event_venue.models import EventVenues
    from app.api.event_venue.schemas import VenueBookingMode

    venue = db.get(EventVenues, payload.venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")
    if venue.booking_mode == VenueBookingMode.UNBOOKABLE.value:
        return EventAvailabilityResult(
            available=False,
            conflicts=[],
            reason="Venue is not bookable",
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
    )


# ---------------------------------------------------------------------------
# Invitations (bulk paste)
# ---------------------------------------------------------------------------


@router.get("/{event_id}/invitations", response_model=list[EventInvitationPublic])
async def list_invitations(
    event_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
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

    from app.api.event.models import EventInvitations
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

    existing = list(
        db.exec(
            select(EventInvitations).where(EventInvitations.event_id == event.id)
        ).all()
    )
    already_invited = {inv.human_id for inv in existing}

    created: list[EventInvitations] = []
    skipped_existing: list[str] = []
    for email, human in found_by_email.items():
        if human.id in already_invited:
            skipped_existing.append(email)
            continue
        inv = EventInvitations(
            tenant_id=event.tenant_id,
            event_id=event.id,
            human_id=human.id,
            invited_by=inviter_id,
        )
        db.add(inv)
        created.append(inv)

    db.commit()
    for inv in created:
        db.refresh(inv)

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
    db: TenantSession,
    current_user: CurrentUser,
) -> EventInvitationBulkResult:
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return _run_bulk_invite(db, event, payload.emails, current_user.id)


@router.delete("/{event_id}/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_invitation(
    event_id: uuid.UUID,
    invitation_id: uuid.UUID,
    db: TenantSession,
    _: CurrentWriter,
) -> None:
    from app.api.event.models import EventInvitations

    inv = db.get(EventInvitations, invitation_id)
    if not inv or inv.event_id != event_id:
        raise HTTPException(status_code=404, detail="Invitation not found")
    db.delete(inv)
    db.commit()


# ---------------------------------------------------------------------------
# Portal invitations — event owner only
# ---------------------------------------------------------------------------


def _ensure_portal_event_owner(
    db, event_id: uuid.UUID, current_human
):
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
    return _run_bulk_invite(db, event, payload.emails, current_human.id)


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
    from app.api.event.models import EventInvitations

    _ensure_portal_event_owner(db, event_id, current_human)
    inv = db.get(EventInvitations, invitation_id)
    if not inv or inv.event_id != event_id:
        raise HTTPException(status_code=404, detail="Invitation not found")
    db.delete(inv)
    db.commit()


# ---------------------------------------------------------------------------
# iCal export
# ---------------------------------------------------------------------------


@router.get("/{event_id}/ics")
async def export_event_ics(
    event_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
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
    - unlisted: visible to all humans (hidden from list, but respected here so
      that the same helper covers both list and detail calls).
    """
    from sqlmodel import select

    from app.api.event.models import EventInvitations

    private_event_ids = [e.id for e in events if e.visibility == EventVisibility.PRIVATE]
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
            # Hide from listings; detail is reachable via direct link check.
            continue
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
    track_id: uuid.UUID | None = None,
    start_after: datetime | None = None,
    start_before: datetime | None = None,
    search: str | None = None,
    rsvped_only: bool = False,
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
            track_id=track_id,
            start_after=start_after,
            start_before=start_before,
            search=search,
        )
    else:
        events, total = crud.events_crud.find(
            db, skip=skip, limit=limit, search=search, search_fields=["title"],
        )

    visible = _portal_visibility_filter(db, events, current_human.id)

    if rsvped_only:
        from sqlmodel import select

        from app.api.event_participant.models import EventParticipants
        from app.api.event_participant.schemas import ParticipantStatus

        event_ids = [e.id for e in visible]
        if event_ids:
            active = list(
                db.exec(
                    select(EventParticipants.event_id)
                    .where(EventParticipants.profile_id == current_human.id)
                    .where(EventParticipants.event_id.in_(event_ids))
                    .where(EventParticipants.status != ParticipantStatus.CANCELLED)
                ).all()
            )
            active_set = {eid for eid in active}
            visible = [e for e in visible if e.id in active_set]
        else:
            visible = []

    return ListModel[EventPublic](
        results=[_to_public(e) for e in visible],
        paging=Paging(offset=skip, limit=limit, total=len(visible)),
    )


@router.get("/portal/events/{event_id}", response_model=EventPublic)
async def get_portal_event(
    event_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> EventPublic:
    from sqlmodel import select

    from app.api.event.models import EventInvitations

    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    if event.visibility == EventVisibility.PRIVATE:
        invited = db.exec(
            select(EventInvitations)
            .where(EventInvitations.event_id == event_id)
            .where(EventInvitations.human_id == current_human.id)
        ).first()
        if not invited and event.owner_id != current_human.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    # Public + unlisted are accessible via direct ID.

    return _to_public(event)


@router.post("/portal/events", response_model=EventPublic, status_code=status.HTTP_201_CREATED)
async def create_portal_event(
    event_in: EventCreate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> EventPublic:
    from app.api.event.models import Events
    from app.api.event_settings.crud import event_settings_crud

    settings = event_settings_crud.get_by_popup_id(db, event_in.popup_id)
    if settings and not settings.event_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Event creation is disabled for this popup")
    if settings and settings.can_publish_event == "admin_only" and event_in.status == EventStatus.PUBLISHED:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can publish events")

    rrule_str = format_rrule(event_in.recurrence) if event_in.recurrence else None

    if event_in.venue_id is not None:
        _check_recurrence_conflicts(
            db,
            venue_id=event_in.venue_id,
            start_time=event_in.start_time,
            end_time=event_in.end_time,
            rrule_str=rrule_str,
            exdates=None,
        )

    event_data = event_in.model_dump()
    event_data.pop("recurrence", None)
    event_data["rrule"] = rrule_str
    event_data["tenant_id"] = current_human.tenant_id
    event_data["owner_id"] = current_human.id
    event = Events(**event_data)

    db.add(event)
    db.commit()
    db.refresh(event)
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if event.owner_id != current_human.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the event owner can edit")

    new_venue_id = event_in.venue_id if event_in.venue_id is not None else event.venue_id
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
        )

    updated = crud.events_crud.update(db, event, event_in)
    _safe_gcal_sync_all(db, updated)
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
    if event.visibility == EventVisibility.PRIVATE and event.owner_id != current_human.id:
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
