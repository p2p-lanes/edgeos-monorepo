import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.event.schemas import EventPublic
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.track import crud
from app.api.track.schemas import TrackCreate, TrackPublic, TrackUpdate
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentUser,
    CurrentWriter,
    HumanTenantSession,
    TenantSession,
)

router = APIRouter(prefix="/tracks", tags=["tracks"])


# ---------------------------------------------------------------------------
# Backoffice
# ---------------------------------------------------------------------------


@router.get("", response_model=ListModel[TrackPublic])
async def list_tracks(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[TrackPublic]:
    if popup_id:
        tracks, total = crud.tracks_crud.find_by_popup(
            db, popup_id=popup_id, skip=skip, limit=limit, search=search,
        )
    else:
        tracks, total = crud.tracks_crud.find(
            db, skip=skip, limit=limit, search=search, search_fields=["name"],
        )
    return ListModel[TrackPublic](
        results=[TrackPublic.model_validate(t) for t in tracks],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{track_id}", response_model=TrackPublic)
async def get_track(
    track_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> TrackPublic:
    track = crud.tracks_crud.get(db, track_id)
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")
    return TrackPublic.model_validate(track)


@router.post("", response_model=TrackPublic, status_code=status.HTTP_201_CREATED)
async def create_track(
    track_in: TrackCreate,
    db: TenantSession,
    current_user: CurrentWriter,
) -> TrackPublic:
    from app.api.popup.crud import popups_crud
    from app.api.shared.enums import UserRole
    from app.api.track.models import Tracks

    popup = popups_crud.get(db, track_in.popup_id)
    if not popup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found")

    tenant_id = (
        popup.tenant_id
        if current_user.role == UserRole.SUPERADMIN
        else current_user.tenant_id
    )
    track = Tracks(
        tenant_id=tenant_id,
        popup_id=track_in.popup_id,
        name=track_in.name,
        description=track_in.description,
        topic=track_in.topic,
    )
    db.add(track)
    db.commit()
    db.refresh(track)
    return TrackPublic.model_validate(track)


@router.patch("/{track_id}", response_model=TrackPublic)
async def update_track(
    track_id: uuid.UUID,
    track_in: TrackUpdate,
    db: TenantSession,
    _: CurrentWriter,
) -> TrackPublic:
    track = crud.tracks_crud.get(db, track_id)
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")
    updated = crud.tracks_crud.update(db, track, track_in)
    return TrackPublic.model_validate(updated)


@router.delete("/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_track(
    track_id: uuid.UUID,
    db: TenantSession,
    _: CurrentWriter,
) -> None:
    track = crud.tracks_crud.get(db, track_id)
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")
    crud.tracks_crud.delete(db, track)


@router.get("/{track_id}/events", response_model=ListModel[EventPublic])
async def list_track_events(
    track_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[EventPublic]:
    from app.api.event.crud import events_crud

    track = crud.tracks_crud.get(db, track_id)
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    events, total = events_crud.find_by_popup(
        db,
        popup_id=track.popup_id,
        track_id=track_id,
        skip=skip,
        limit=limit,
    )
    return ListModel[EventPublic](
        results=[EventPublic.model_validate(e) for e in events],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


# ---------------------------------------------------------------------------
# Portal (public — anyone can see all tracks and their events)
# ---------------------------------------------------------------------------


@router.get("/portal/tracks", response_model=ListModel[TrackPublic])
async def list_portal_tracks(
    db: HumanTenantSession,
    _: CurrentHuman,
    popup_id: uuid.UUID,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[TrackPublic]:
    tracks, total = crud.tracks_crud.find_by_popup(
        db, popup_id=popup_id, skip=skip, limit=limit, search=search,
    )
    return ListModel[TrackPublic](
        results=[TrackPublic.model_validate(t) for t in tracks],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/portal/tracks/{track_id}", response_model=TrackPublic)
async def get_portal_track(
    track_id: uuid.UUID,
    db: HumanTenantSession,
    _: CurrentHuman,
) -> TrackPublic:
    track = crud.tracks_crud.get(db, track_id)
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")
    return TrackPublic.model_validate(track)


@router.get(
    "/portal/tracks/{track_id}/events",
    response_model=ListModel[EventPublic],
)
async def list_portal_track_events(
    track_id: uuid.UUID,
    db: HumanTenantSession,
    _: CurrentHuman,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[EventPublic]:
    from app.api.event.crud import events_crud
    from app.api.event.schemas import EventStatus, EventVisibility

    track = crud.tracks_crud.get(db, track_id)
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    events, total = events_crud.find_by_popup(
        db,
        popup_id=track.popup_id,
        track_id=track_id,
        event_status=EventStatus.PUBLISHED,
        skip=skip,
        limit=limit,
    )
    # Track views are public — hide private events only. Unlisted events are
    # visible in the track view because the track itself acts as a soft share.
    events = [e for e in events if e.visibility != EventVisibility.PRIVATE]
    return ListModel[EventPublic](
        results=[EventPublic.model_validate(e) for e in events],
        paging=Paging(offset=skip, limit=limit, total=len(events)),
    )
