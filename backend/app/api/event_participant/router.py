import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from loguru import logger

from app.api.event_participant import crud
from app.api.event_participant.schemas import (
    EventParticipantCreate,
    EventParticipantPublic,
    EventParticipantUpdate,
    ParticipantStatus,
    RegisterRequest,
)
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentUser,
    CurrentWriter,
    HumanTenantSession,
    TenantSession,
)

router = APIRouter(prefix="/event-participants", tags=["event-participants"])


def _participants_with_names(
    db, participants: list
) -> list[EventParticipantPublic]:
    """Serialize participants, joining Humans to fill in first/last names.

    Runs a single ``profile_id IN (...)`` query so the list endpoints remain
    O(1) in DB round-trips regardless of how many participants an event has.
    """
    from sqlmodel import select

    from app.api.human.models import Humans

    if not participants:
        return []
    profile_ids = {p.profile_id for p in participants}
    rows = db.exec(select(Humans).where(Humans.id.in_(profile_ids))).all()
    names = {h.id: (h.first_name, h.last_name) for h in rows}
    out: list[EventParticipantPublic] = []
    for p in participants:
        public = EventParticipantPublic.model_validate(p)
        first, last = names.get(p.profile_id, (None, None))
        public.first_name = first
        public.last_name = last
        out.append(public)
    return out


# ---------------------------------------------------------------------------
# Backoffice endpoints (user token)
# ---------------------------------------------------------------------------


@router.get("", response_model=ListModel[EventParticipantPublic])
async def list_participants(
    db: TenantSession,
    _: CurrentUser,
    event_id: uuid.UUID | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[EventParticipantPublic]:
    """List participants with optional event filter (backoffice)."""
    if event_id:
        participants, total = crud.event_participants_crud.find_by_event(
            db, event_id=event_id, skip=skip, limit=limit,
        )
    else:
        participants, total = crud.event_participants_crud.find(db, skip=skip, limit=limit)

    return ListModel[EventParticipantPublic](
        results=_participants_with_names(db, participants),
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post("", response_model=EventParticipantPublic, status_code=status.HTTP_201_CREATED)
async def admin_add_participant(
    participant_in: EventParticipantCreate,
    db: TenantSession,
    current_user: CurrentWriter,
) -> EventParticipantPublic:
    """Admin adds a participant to an event (backoffice)."""
    from app.api.event.crud import events_crud
    from app.api.event_participant.models import EventParticipants
    from app.api.shared.enums import UserRole

    event = events_crud.get(db, participant_in.event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    existing = crud.event_participants_crud.get_by_event_and_profile(
        db, participant_in.event_id, participant_in.profile_id
    )
    if existing and existing.status != ParticipantStatus.CANCELLED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already registered")
    if existing:
        existing.status = ParticipantStatus.REGISTERED
        existing.role = participant_in.role
        existing.message = participant_in.message
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return EventParticipantPublic.model_validate(existing)

    tenant_id = event.tenant_id if current_user.role == UserRole.SUPERADMIN else current_user.tenant_id
    p_data = participant_in.model_dump()
    p_data["tenant_id"] = tenant_id
    participant = EventParticipants(**p_data)
    db.add(participant)
    db.commit()
    db.refresh(participant)
    return EventParticipantPublic.model_validate(participant)


@router.patch("/{participant_id}", response_model=EventParticipantPublic)
async def update_participant(
    participant_id: uuid.UUID,
    participant_in: EventParticipantUpdate,
    db: TenantSession,
    _: CurrentWriter,
) -> EventParticipantPublic:
    """Update a participant (backoffice)."""

    participant = crud.event_participants_crud.get(db, participant_id)
    if not participant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")

    updated = crud.event_participants_crud.update(db, participant, participant_in)

    return EventParticipantPublic.model_validate(updated)


@router.delete("/{participant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_participant(
    participant_id: uuid.UUID,
    db: TenantSession,
    _: CurrentWriter,
) -> None:
    """Delete a participant (backoffice)."""

    participant = crud.event_participants_crud.get(db, participant_id)
    if not participant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")

    crud.event_participants_crud.delete(db, participant)


# ---------------------------------------------------------------------------
# Portal endpoints (human token)
# ---------------------------------------------------------------------------


def _resolve_occurrence_start(
    event, occurrence_start: datetime | None
) -> datetime | None:
    """Validate the (event, occurrence_start) pair for portal RSVP endpoints.

    Recurring events require ``occurrence_start`` so each registration
    targets a single instance. One-off events ignore it (and reject it,
    to avoid fragmented data).
    """
    is_recurring = bool(event.rrule)
    if is_recurring and occurrence_start is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="occurrence_start is required for recurring events",
        )
    if not is_recurring and occurrence_start is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="occurrence_start is not allowed for non-recurring events",
        )
    return occurrence_start


@router.get("/portal/participants", response_model=ListModel[EventParticipantPublic])
async def list_portal_participants(
    db: HumanTenantSession,
    _: CurrentHuman,
    event_id: uuid.UUID,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
    occurrence_start: datetime | None = None,
) -> ListModel[EventParticipantPublic]:
    """List participants for an event (portal).

    When ``occurrence_start`` is provided, scope the result to that single
    occurrence; otherwise return every participant row of the event (used
    by the admin/owner participants section that wants the full picture).
    """
    participants, total = crud.event_participants_crud.find_by_event(
        db,
        event_id=event_id,
        skip=skip,
        limit=limit,
        occurrence_start=occurrence_start,
        scope_to_occurrence=occurrence_start is not None,
    )
    return ListModel[EventParticipantPublic](
        results=_participants_with_names(db, participants),
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post("/portal/register/{event_id}", response_model=EventParticipantPublic)
async def register_for_event(
    event_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    body: RegisterRequest | None = None,
) -> EventParticipantPublic:
    """Register current human for an event (portal)."""
    from app.api.event.crud import events_crud
    from app.api.event.schemas import EventStatus
    from app.api.event_participant.models import EventParticipants

    event = events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if event.status != EventStatus.PUBLISHED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Event is not published")

    occ_start = _resolve_occurrence_start(
        event, body.occurrence_start if body else None
    )

    existing = crud.event_participants_crud.get_by_event_and_profile(
        db, event_id, current_human.id, occurrence_start=occ_start
    )
    if existing and existing.status != ParticipantStatus.CANCELLED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already registered")

    if event.max_participant:
        active_count = crud.event_participants_crud.count_active_for_event(
            db, event_id, occurrence_start=occ_start
        )
        if active_count >= event.max_participant:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Event is full")

    if existing:
        existing.status = ParticipantStatus.REGISTERED
        existing.role = body.role if body else existing.role
        existing.message = body.message if body else existing.message
        existing.registered_at = datetime.now(UTC)
        db.add(existing)
        db.commit()
        db.refresh(existing)
        await _notify_rsvp(
            db, event, current_human, method="REQUEST", occurrence_start=occ_start
        )
        return EventParticipantPublic.model_validate(existing)

    req = body or RegisterRequest()
    participant = EventParticipants(
        tenant_id=current_human.tenant_id,
        event_id=event_id,
        profile_id=current_human.id,
        role=req.role,
        message=req.message,
        occurrence_start=occ_start,
    )
    db.add(participant)
    db.commit()
    db.refresh(participant)
    await _notify_rsvp(
        db, event, current_human, method="REQUEST", occurrence_start=occ_start
    )
    return EventParticipantPublic.model_validate(participant)


async def _notify_rsvp(
    db,
    event,
    human,
    *,
    method: str,
    occurrence_start: datetime | None = None,
) -> None:
    """Send a single iTIP message to the human who just RSVPed/cancelled.

    For recurring events, ``occurrence_start`` shifts the calendar entry to
    the specific instance the user RSVPed to, so the message imports as a
    one-off appointment on that day instead of as the whole series.

    Uses the current event ``ical_sequence`` so the recipient's calendar
    client correlates this email with any existing entry from a prior
    invitation. No SEQUENCE bump — this is one-to-one delivery, not an
    organiser-driven update.
    """
    from app.services.event_itip import send_itip_to_single_recipient

    if not human.email:
        return
    try:
        await send_itip_to_single_recipient(
            db,
            event,
            email=human.email,
            first_name=human.first_name or "",
            human_id=human.id,
            method=method,
            occurrence_start=occurrence_start,
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "iTIP {} delivery to {} failed: {}", method, human.email, exc
        )


@router.post("/portal/cancel-registration/{event_id}", response_model=EventParticipantPublic)
async def cancel_registration(
    event_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    body: RegisterRequest | None = None,
) -> EventParticipantPublic:
    """Cancel current human's registration (portal).

    Body is reused from RegisterRequest for the optional ``occurrence_start``
    field; ``role``/``message`` are ignored on cancel.
    """
    from app.api.event.crud import events_crud

    event = events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    occ_start = _resolve_occurrence_start(
        event, body.occurrence_start if body else None
    )

    existing = crud.event_participants_crud.get_by_event_and_profile(
        db, event_id, current_human.id, occurrence_start=occ_start
    )
    if not existing or existing.status == ParticipantStatus.CANCELLED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active registration found")

    existing.status = ParticipantStatus.CANCELLED
    db.add(existing)
    db.commit()
    db.refresh(existing)

    await _notify_rsvp(
        db, event, current_human, method="CANCEL", occurrence_start=occ_start
    )

    return EventParticipantPublic.model_validate(existing)


@router.post("/portal/check-in/{event_id}", response_model=EventParticipantPublic)
async def check_in(
    event_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    body: RegisterRequest | None = None,
) -> EventParticipantPublic:
    """Check in current human for an event (portal)."""
    from app.api.event.crud import events_crud

    event = events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    occ_start = _resolve_occurrence_start(
        event, body.occurrence_start if body else None
    )

    existing = crud.event_participants_crud.get_by_event_and_profile(
        db, event_id, current_human.id, occurrence_start=occ_start
    )
    if not existing or existing.status == ParticipantStatus.CANCELLED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active registration found")
    if existing.status == ParticipantStatus.CHECKED_IN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already checked in")

    existing.status = ParticipantStatus.CHECKED_IN
    existing.check_time = datetime.now(UTC)
    db.add(existing)
    db.commit()
    db.refresh(existing)
    return EventParticipantPublic.model_validate(existing)
