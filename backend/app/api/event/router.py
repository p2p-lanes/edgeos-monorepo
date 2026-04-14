import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, status

from app.api.event import crud
from app.api.event.schemas import EventCreate, EventPublic, EventStatus, EventUpdate
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentUser,
    CurrentWriter,
    HumanTenantSession,
    TenantSession,
)

router = APIRouter(prefix="/events", tags=["events"])


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
        results=[EventPublic.model_validate(e) for e in events],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{event_id}", response_model=EventPublic)
async def get_event(
    event_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> EventPublic:
    """Get a single event by ID (backoffice)."""
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return EventPublic.model_validate(event)


@router.post("", response_model=EventPublic, status_code=status.HTTP_201_CREATED)
async def create_event(
    event_in: EventCreate,
    db: TenantSession,
    current_user: CurrentWriter,
) -> EventPublic:
    """Create a new event (backoffice)."""
    from app.api.event.models import Events
    from app.api.popup.crud import popups_crud
    from app.api.shared.enums import UserRole

    popup = popups_crud.get(db, event_in.popup_id)
    if not popup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found")

    tenant_id = popup.tenant_id if current_user.role == UserRole.SUPERADMIN else current_user.tenant_id

    event_data = event_in.model_dump()
    event_data["tenant_id"] = tenant_id
    event_data["owner_id"] = current_user.id
    event = Events(**event_data)

    db.add(event)
    db.commit()
    db.refresh(event)
    return EventPublic.model_validate(event)


@router.patch("/{event_id}", response_model=EventPublic)
async def update_event(
    event_id: uuid.UUID,
    event_in: EventUpdate,
    db: TenantSession,
    _: CurrentWriter,
) -> EventPublic:
    """Update an event (backoffice)."""
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    updated = crud.events_crud.update(db, event, event_in)
    return EventPublic.model_validate(updated)


@router.post("/{event_id}/cancel", response_model=EventPublic)
async def cancel_event(
    event_id: uuid.UUID,
    db: TenantSession,
    _: CurrentWriter,
) -> EventPublic:
    """Cancel an event (backoffice)."""
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if event.status == EventStatus.CANCELLED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Event is already cancelled")

    cancel_update = EventUpdate(status=EventStatus.CANCELLED)
    updated = crud.events_crud.update(db, event, cancel_update)
    return EventPublic.model_validate(updated)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: uuid.UUID,
    db: TenantSession,
    _: CurrentWriter,
) -> None:
    """Delete an event (backoffice)."""
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    crud.events_crud.delete(db, event)


# ---------------------------------------------------------------------------
# Portal endpoints (human token)
# ---------------------------------------------------------------------------


@router.get("/portal/events", response_model=ListModel[EventPublic])
async def list_portal_events(
    db: HumanTenantSession,
    _: CurrentHuman,
    popup_id: uuid.UUID | None = None,
    event_status: EventStatus | None = None,
    kind: str | None = None,
    start_after: datetime | None = None,
    start_before: datetime | None = None,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[EventPublic]:
    """List events visible to the current human (portal)."""
    if popup_id:
        events, total = crud.events_crud.find_by_popup(
            db,
            popup_id=popup_id,
            skip=skip,
            limit=limit,
            event_status=event_status,
            kind=kind,
            start_after=start_after,
            start_before=start_before,
            search=search,
        )
    else:
        events, total = crud.events_crud.find(
            db, skip=skip, limit=limit, search=search, search_fields=["title"],
        )

    return ListModel[EventPublic](
        results=[EventPublic.model_validate(e) for e in events],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/portal/events/{event_id}", response_model=EventPublic)
async def get_portal_event(
    event_id: uuid.UUID,
    db: HumanTenantSession,
    _: CurrentHuman,
) -> EventPublic:
    """Get a single event (portal)."""
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return EventPublic.model_validate(event)


@router.post("/portal/events", response_model=EventPublic, status_code=status.HTTP_201_CREATED)
async def create_portal_event(
    event_in: EventCreate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> EventPublic:
    """Create an event as a human (portal). Respects popup event settings."""
    from app.api.event.models import Events
    from app.api.event_settings.crud import event_settings_crud

    settings = event_settings_crud.get_by_popup_id(db, event_in.popup_id)
    if settings and not settings.event_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Event creation is disabled for this popup")
    if settings and settings.can_publish_event == "admin_only" and event_in.status == EventStatus.PUBLISHED:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can publish events")

    event_data = event_in.model_dump()
    event_data["tenant_id"] = current_human.tenant_id
    event_data["owner_id"] = current_human.id
    event = Events(**event_data)

    db.add(event)
    db.commit()
    db.refresh(event)
    return EventPublic.model_validate(event)


@router.patch("/portal/events/{event_id}", response_model=EventPublic)
async def update_portal_event(
    event_id: uuid.UUID,
    event_in: EventUpdate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> EventPublic:
    """Update an event as a human (portal). Only owner can edit."""
    event = crud.events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if event.owner_id != current_human.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the event owner can edit")

    updated = crud.events_crud.update(db, event, event_in)
    return EventPublic.model_validate(updated)
