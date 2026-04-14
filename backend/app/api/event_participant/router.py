import uuid
from datetime import datetime, timezone

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
from app.api.google_calendar import service as gcal_service
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentUser,
    CurrentWriter,
    HumanTenantSession,
    TenantSession,
)

router = APIRouter(prefix="/event-participants", tags=["event-participants"])


# ---------------------------------------------------------------------------
# Google Calendar sync helpers — best-effort. Never propagate failures to
# the HTTP response; just log.
# ---------------------------------------------------------------------------


def _safe_gcal_sync(db, event, human_id: uuid.UUID) -> None:
    try:
        gcal_service.sync_event_to_human(db, event, human_id)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "GCal sync (RSVP) failed for human {} event {}: {}",
            human_id,
            getattr(event, "id", None),
            exc,
        )


def _safe_gcal_delete(db, event, human_id: uuid.UUID) -> None:
    try:
        gcal_service.delete_event_for_human(db, event, human_id)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "GCal delete (cancel RSVP) failed for human {} event {}: {}",
            human_id,
            getattr(event, "id", None),
            exc,
        )


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
        results=[EventParticipantPublic.model_validate(p) for p in participants],
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
        _safe_gcal_sync(db, event, existing.profile_id)
        return EventParticipantPublic.model_validate(existing)

    tenant_id = event.tenant_id if current_user.role == UserRole.SUPERADMIN else current_user.tenant_id
    p_data = participant_in.model_dump()
    p_data["tenant_id"] = tenant_id
    participant = EventParticipants(**p_data)
    db.add(participant)
    db.commit()
    db.refresh(participant)
    _safe_gcal_sync(db, event, participant.profile_id)
    return EventParticipantPublic.model_validate(participant)


@router.patch("/{participant_id}", response_model=EventParticipantPublic)
async def update_participant(
    participant_id: uuid.UUID,
    participant_in: EventParticipantUpdate,
    db: TenantSession,
    _: CurrentWriter,
) -> EventParticipantPublic:
    """Update a participant (backoffice)."""
    from app.api.event.crud import events_crud

    participant = crud.event_participants_crud.get(db, participant_id)
    if not participant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")

    prior_status = participant.status
    updated = crud.event_participants_crud.update(db, participant, participant_in)

    if participant_in.status is not None and participant_in.status != prior_status:
        event = events_crud.get(db, updated.event_id)
        if event is not None:
            if participant_in.status == ParticipantStatus.CANCELLED:
                _safe_gcal_delete(db, event, updated.profile_id)
            elif prior_status == ParticipantStatus.CANCELLED:
                _safe_gcal_sync(db, event, updated.profile_id)

    return EventParticipantPublic.model_validate(updated)


@router.delete("/{participant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_participant(
    participant_id: uuid.UUID,
    db: TenantSession,
    _: CurrentWriter,
) -> None:
    """Delete a participant (backoffice)."""
    from app.api.event.crud import events_crud

    participant = crud.event_participants_crud.get(db, participant_id)
    if not participant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")

    event = events_crud.get(db, participant.event_id)
    human_id = participant.profile_id

    crud.event_participants_crud.delete(db, participant)

    if event is not None:
        _safe_gcal_delete(db, event, human_id)


# ---------------------------------------------------------------------------
# Portal endpoints (human token)
# ---------------------------------------------------------------------------


@router.get("/portal/participants", response_model=ListModel[EventParticipantPublic])
async def list_portal_participants(
    db: HumanTenantSession,
    _: CurrentHuman,
    event_id: uuid.UUID,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[EventParticipantPublic]:
    """List participants for an event (portal)."""
    participants, total = crud.event_participants_crud.find_by_event(
        db, event_id=event_id, skip=skip, limit=limit,
    )
    return ListModel[EventParticipantPublic](
        results=[EventParticipantPublic.model_validate(p) for p in participants],
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

    existing = crud.event_participants_crud.get_by_event_and_profile(db, event_id, current_human.id)
    if existing and existing.status != ParticipantStatus.CANCELLED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already registered")

    if event.max_participant:
        active_count = crud.event_participants_crud.count_active_for_event(db, event_id)
        if active_count >= event.max_participant:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Event is full")

    if existing:
        existing.status = ParticipantStatus.REGISTERED
        existing.role = body.role if body else existing.role
        existing.message = body.message if body else existing.message
        existing.registered_at = datetime.now(timezone.utc)
        db.add(existing)
        db.commit()
        db.refresh(existing)
        _safe_gcal_sync(db, event, current_human.id)
        return EventParticipantPublic.model_validate(existing)

    req = body or RegisterRequest()
    participant = EventParticipants(
        tenant_id=current_human.tenant_id,
        event_id=event_id,
        profile_id=current_human.id,
        role=req.role,
        message=req.message,
    )
    db.add(participant)
    db.commit()
    db.refresh(participant)
    _safe_gcal_sync(db, event, current_human.id)
    return EventParticipantPublic.model_validate(participant)


@router.post("/portal/cancel-registration/{event_id}", response_model=EventParticipantPublic)
async def cancel_registration(
    event_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> EventParticipantPublic:
    """Cancel current human's registration (portal)."""
    from app.api.event.crud import events_crud

    existing = crud.event_participants_crud.get_by_event_and_profile(db, event_id, current_human.id)
    if not existing or existing.status == ParticipantStatus.CANCELLED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active registration found")

    existing.status = ParticipantStatus.CANCELLED
    db.add(existing)
    db.commit()
    db.refresh(existing)

    event = events_crud.get(db, event_id)
    if event:
        _safe_gcal_delete(db, event, current_human.id)

    return EventParticipantPublic.model_validate(existing)


@router.post("/portal/check-in/{event_id}", response_model=EventParticipantPublic)
async def check_in(
    event_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> EventParticipantPublic:
    """Check in current human for an event (portal)."""
    existing = crud.event_participants_crud.get_by_event_and_profile(db, event_id, current_human.id)
    if not existing or existing.status == ParticipantStatus.CANCELLED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active registration found")
    if existing.status == ParticipantStatus.CHECKED_IN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already checked in")

    existing.status = ParticipantStatus.CHECKED_IN
    existing.check_time = datetime.now(timezone.utc)
    db.add(existing)
    db.commit()
    db.refresh(existing)
    return EventParticipantPublic.model_validate(existing)
