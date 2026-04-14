import uuid
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import select

from app.api.event_venue import crud
from app.api.event_venue.models import (
    EventVenues,
    VenueExceptions,
    VenuePhotos,
    VenueProperties,
    VenuePropertyTypes,
    VenueWeeklyHours,
)
from app.api.event_venue.schemas import (
    EventVenueCreate,
    EventVenuePublic,
    EventVenueUpdate,
    VenueAvailability,
    VenueBookingMode,
    VenueBusySlot,
    VenueExceptionCreate,
    VenueExceptionPublic,
    VenueExceptionUpdate,
    VenuePhotoCreate,
    VenuePhotoPublic,
    VenuePhotoUpdate,
    VenuePropertyTypeCreate,
    VenuePropertyTypePublic,
    VenuePropertyTypeUpdate,
    VenueStatus,
    VenueWeeklyHoursUpdate,
)
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentTenant,
    CurrentUser,
    CurrentWriter,
    HumanTenantSession,
    TenantSession,
)

GALLERY_MAX_PHOTOS = 10

# Public utility router (no auth required)
utils_router = APIRouter(prefix="/utils", tags=["utils"])


@utils_router.get("/resolve-url")
async def resolve_url(url: str = Query(..., description="Short URL to resolve")) -> dict:
    """Follow redirects on a short URL and return the final resolved URL."""
    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL")
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=5.0) as client:
            resp = await client.head(url)
            return {"resolved_url": str(resp.url)}
    except Exception:
        raise HTTPException(status_code=400, detail="Could not resolve URL")


router = APIRouter(prefix="/event-venues", tags=["event-venues"])
property_types_router = APIRouter(prefix="/venue-property-types", tags=["venue-property-types"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _set_property_types(
    db,
    venue: EventVenues,
    property_type_ids: list[uuid.UUID] | None,
) -> None:
    """Replace a venue's property links with the provided ids."""
    if property_type_ids is None:
        return

    existing = list(
        db.exec(
            select(VenueProperties).where(VenueProperties.venue_id == venue.id)
        ).all()
    )
    for link in existing:
        db.delete(link)

    for pt_id in property_type_ids:
        link = VenueProperties(
            tenant_id=venue.tenant_id,
            venue_id=venue.id,
            property_type_id=pt_id,
        )
        db.add(link)


def _get_venue_or_404(db, venue_id: uuid.UUID) -> EventVenues:
    venue = db.get(EventVenues, venue_id)
    if not venue:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Venue not found")
    return venue


# ---------------------------------------------------------------------------
# Backoffice endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=ListModel[EventVenuePublic])
async def list_venues(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[EventVenuePublic]:
    """List venues (backoffice)."""
    if popup_id:
        venues, total = crud.event_venues_crud.find_by_popup(
            db, popup_id=popup_id, skip=skip, limit=limit, search=search,
        )
    else:
        venues, total = crud.event_venues_crud.find(
            db, skip=skip, limit=limit, search=search, search_fields=["title", "location"],
        )
    return ListModel[EventVenuePublic](
        results=[EventVenuePublic.model_validate(v) for v in venues],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{venue_id}", response_model=EventVenuePublic)
async def get_venue(
    venue_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> EventVenuePublic:
    venue = _get_venue_or_404(db, venue_id)
    return EventVenuePublic.model_validate(venue)


@router.post("", response_model=EventVenuePublic, status_code=status.HTTP_201_CREATED)
async def create_venue(
    venue_in: EventVenueCreate,
    db: TenantSession,
    current_user: CurrentWriter,
) -> EventVenuePublic:
    from app.api.popup.crud import popups_crud
    from app.api.shared.enums import UserRole

    popup = popups_crud.get(db, venue_in.popup_id)
    if not popup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found")

    tenant_id = popup.tenant_id if current_user.role == UserRole.SUPERADMIN else current_user.tenant_id
    venue_data = venue_in.model_dump(exclude={"property_type_ids"})
    venue_data["tenant_id"] = tenant_id
    venue_data["owner_id"] = current_user.id
    venue_data["status"] = VenueStatus.ACTIVE
    venue = EventVenues(**venue_data)
    db.add(venue)
    db.flush()
    _set_property_types(db, venue, venue_in.property_type_ids)
    db.commit()
    db.refresh(venue)
    return EventVenuePublic.model_validate(venue)


@router.patch("/{venue_id}", response_model=EventVenuePublic)
async def update_venue(
    venue_id: uuid.UUID,
    venue_in: EventVenueUpdate,
    db: TenantSession,
    _: CurrentWriter,
) -> EventVenuePublic:
    venue = _get_venue_or_404(db, venue_id)
    update_data = venue_in.model_dump(exclude_unset=True, exclude={"property_type_ids"})
    for k, v in update_data.items():
        setattr(venue, k, v)
    venue.updated_at = datetime.utcnow()
    _set_property_types(db, venue, venue_in.property_type_ids)
    db.commit()
    db.refresh(venue)
    return EventVenuePublic.model_validate(venue)


@router.delete("/{venue_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_venue(
    venue_id: uuid.UUID,
    db: TenantSession,
    _: CurrentWriter,
) -> None:
    venue = _get_venue_or_404(db, venue_id)
    crud.event_venues_crud.delete(db, venue)


# ---------------------------------------------------------------------------
# Weekly hours
# ---------------------------------------------------------------------------


@router.put("/{venue_id}/weekly-hours", status_code=status.HTTP_200_OK)
async def set_weekly_hours(
    venue_id: uuid.UUID,
    payload: VenueWeeklyHoursUpdate,
    db: TenantSession,
    _: CurrentWriter,
) -> dict:
    venue = _get_venue_or_404(db, venue_id)
    existing = list(
        db.exec(
            select(VenueWeeklyHours).where(VenueWeeklyHours.venue_id == venue_id)
        ).all()
    )
    for row in existing:
        db.delete(row)
    for h in payload.hours:
        db.add(
            VenueWeeklyHours(
                tenant_id=venue.tenant_id,
                venue_id=venue.id,
                day_of_week=h.day_of_week,
                open_time=h.open_time,
                close_time=h.close_time,
                is_closed=h.is_closed,
            )
        )
    db.commit()
    return {"count": len(payload.hours)}


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


@router.get("/{venue_id}/exceptions", response_model=list[VenueExceptionPublic])
async def list_exceptions(
    venue_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> list[VenueExceptionPublic]:
    rows = list(
        db.exec(
            select(VenueExceptions)
            .where(VenueExceptions.venue_id == venue_id)
            .order_by(VenueExceptions.start_datetime)
        ).all()
    )
    return [VenueExceptionPublic.model_validate(r) for r in rows]


@router.post(
    "/{venue_id}/exceptions",
    response_model=VenueExceptionPublic,
    status_code=status.HTTP_201_CREATED,
)
async def create_exception(
    venue_id: uuid.UUID,
    payload: VenueExceptionCreate,
    db: TenantSession,
    _: CurrentWriter,
) -> VenueExceptionPublic:
    venue = _get_venue_or_404(db, venue_id)
    if payload.start_datetime >= payload.end_datetime:
        raise HTTPException(status_code=400, detail="start_datetime must be before end_datetime")
    exc = VenueExceptions(
        tenant_id=venue.tenant_id,
        venue_id=venue.id,
        start_datetime=payload.start_datetime,
        end_datetime=payload.end_datetime,
        reason=payload.reason,
        is_closed=payload.is_closed,
    )
    db.add(exc)
    db.commit()
    db.refresh(exc)
    return VenueExceptionPublic.model_validate(exc)


@router.patch(
    "/{venue_id}/exceptions/{exception_id}",
    response_model=VenueExceptionPublic,
)
async def update_exception(
    venue_id: uuid.UUID,
    exception_id: uuid.UUID,
    payload: VenueExceptionUpdate,
    db: TenantSession,
    _: CurrentWriter,
) -> VenueExceptionPublic:
    exc = db.get(VenueExceptions, exception_id)
    if not exc or exc.venue_id != venue_id:
        raise HTTPException(status_code=404, detail="Exception not found")
    update_data = payload.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(exc, k, v)
    db.commit()
    db.refresh(exc)
    return VenueExceptionPublic.model_validate(exc)


@router.delete(
    "/{venue_id}/exceptions/{exception_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_exception(
    venue_id: uuid.UUID,
    exception_id: uuid.UUID,
    db: TenantSession,
    _: CurrentWriter,
) -> None:
    exc = db.get(VenueExceptions, exception_id)
    if not exc or exc.venue_id != venue_id:
        raise HTTPException(status_code=404, detail="Exception not found")
    db.delete(exc)
    db.commit()


# ---------------------------------------------------------------------------
# Photos (gallery)
# ---------------------------------------------------------------------------


@router.get("/{venue_id}/photos", response_model=list[VenuePhotoPublic])
async def list_photos(
    venue_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> list[VenuePhotoPublic]:
    rows = list(
        db.exec(
            select(VenuePhotos)
            .where(VenuePhotos.venue_id == venue_id)
            .order_by(VenuePhotos.position)
        ).all()
    )
    return [VenuePhotoPublic.model_validate(r) for r in rows]


@router.post(
    "/{venue_id}/photos",
    response_model=VenuePhotoPublic,
    status_code=status.HTTP_201_CREATED,
)
async def add_photo(
    venue_id: uuid.UUID,
    payload: VenuePhotoCreate,
    db: TenantSession,
    _: CurrentWriter,
) -> VenuePhotoPublic:
    venue = _get_venue_or_404(db, venue_id)
    current_count = len(
        list(db.exec(select(VenuePhotos).where(VenuePhotos.venue_id == venue_id)).all())
    )
    if current_count >= GALLERY_MAX_PHOTOS:
        raise HTTPException(
            status_code=400,
            detail=f"Gallery limit of {GALLERY_MAX_PHOTOS} photos reached",
        )
    photo = VenuePhotos(
        tenant_id=venue.tenant_id,
        venue_id=venue.id,
        image_url=payload.image_url,
        position=payload.position,
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)
    return VenuePhotoPublic.model_validate(photo)


@router.patch("/{venue_id}/photos/{photo_id}", response_model=VenuePhotoPublic)
async def update_photo(
    venue_id: uuid.UUID,
    photo_id: uuid.UUID,
    payload: VenuePhotoUpdate,
    db: TenantSession,
    _: CurrentWriter,
) -> VenuePhotoPublic:
    photo = db.get(VenuePhotos, photo_id)
    if not photo or photo.venue_id != venue_id:
        raise HTTPException(status_code=404, detail="Photo not found")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(photo, k, v)
    db.commit()
    db.refresh(photo)
    return VenuePhotoPublic.model_validate(photo)


@router.delete("/{venue_id}/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_photo(
    venue_id: uuid.UUID,
    photo_id: uuid.UUID,
    db: TenantSession,
    _: CurrentWriter,
) -> None:
    photo = db.get(VenuePhotos, photo_id)
    if not photo or photo.venue_id != venue_id:
        raise HTTPException(status_code=404, detail="Photo not found")
    db.delete(photo)
    db.commit()


# ---------------------------------------------------------------------------
# Availability query
# ---------------------------------------------------------------------------


@router.get("/{venue_id}/availability", response_model=VenueAvailability)
async def get_availability(
    venue_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
    start: datetime = Query(...),
    end: datetime = Query(...),
) -> VenueAvailability:
    """Return busy slots for a venue in a given window (from existing events
    and exceptions). The caller can cross-reference against weekly hours.
    """
    from app.api.event.models import Events
    from app.api.event.schemas import EventStatus

    venue = _get_venue_or_404(db, venue_id)

    if end <= start:
        raise HTTPException(status_code=400, detail="end must be after start")

    events = list(
        db.exec(
            select(Events)
            .where(Events.venue_id == venue_id)
            .where(Events.status != EventStatus.CANCELLED)
            .where(Events.start_time < end)
            .where(Events.end_time > start)
        ).all()
    )

    exceptions = list(
        db.exec(
            select(VenueExceptions)
            .where(VenueExceptions.venue_id == venue_id)
            .where(VenueExceptions.is_closed == True)  # noqa: E712
            .where(VenueExceptions.start_datetime < end)
            .where(VenueExceptions.end_datetime > start)
        ).all()
    )

    busy: list[VenueBusySlot] = []
    for e in events:
        busy_start = e.start_time - timedelta(minutes=venue.setup_time_minutes)
        busy_end = e.end_time + timedelta(minutes=venue.teardown_time_minutes)
        busy.append(
            VenueBusySlot(
                start=busy_start,
                end=busy_end,
                source="event",
                label=e.title,
            )
        )
    for exc in exceptions:
        busy.append(
            VenueBusySlot(
                start=exc.start_datetime,
                end=exc.end_datetime,
                source="exception",
                label=exc.reason,
            )
        )

    return VenueAvailability(venue_id=venue.id, open_ranges=[], busy=busy)


# ---------------------------------------------------------------------------
# Portal endpoints
# ---------------------------------------------------------------------------


@router.get("/portal/venues", response_model=ListModel[EventVenuePublic])
async def list_portal_venues(
    db: HumanTenantSession,
    _: CurrentHuman,
    popup_id: uuid.UUID,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[EventVenuePublic]:
    venues, total = crud.event_venues_crud.find_by_popup(
        db, popup_id=popup_id, skip=skip, limit=limit, search=search,
    )
    # Hide pending venues from portal listings.
    venues = [v for v in venues if v.status == VenueStatus.ACTIVE]
    return ListModel[EventVenuePublic](
        results=[EventVenuePublic.model_validate(v) for v in venues],
        paging=Paging(offset=skip, limit=limit, total=len(venues)),
    )


@router.post(
    "/portal/venues",
    response_model=EventVenuePublic,
    status_code=status.HTTP_201_CREATED,
)
async def create_portal_venue(
    venue_in: EventVenueCreate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> EventVenuePublic:
    """Create a venue as a human (portal). Respects popup event settings."""
    from app.api.event_settings.crud import event_settings_crud

    settings = event_settings_crud.get_by_popup_id(db, venue_in.popup_id)
    if not settings or not settings.humans_can_create_venues:
        raise HTTPException(
            status_code=403,
            detail="Venue creation by humans is disabled for this popup",
        )

    venue_data = venue_in.model_dump(exclude={"property_type_ids"})
    venue_data["tenant_id"] = current_human.tenant_id
    venue_data["owner_id"] = current_human.id
    venue_data["status"] = (
        VenueStatus.PENDING if settings.venues_require_approval else VenueStatus.ACTIVE
    )
    venue = EventVenues(**venue_data)
    db.add(venue)
    db.flush()
    _set_property_types(db, venue, venue_in.property_type_ids)
    db.commit()
    db.refresh(venue)
    return EventVenuePublic.model_validate(venue)


# ---------------------------------------------------------------------------
# Tenant-wide property types catalog
# ---------------------------------------------------------------------------


@property_types_router.get("", response_model=list[VenuePropertyTypePublic])
async def list_property_types(
    db: TenantSession,
    _: CurrentUser,
) -> list[VenuePropertyTypePublic]:
    rows = list(
        db.exec(select(VenuePropertyTypes).order_by(VenuePropertyTypes.name)).all()
    )
    return [VenuePropertyTypePublic.model_validate(r) for r in rows]


@property_types_router.post(
    "",
    response_model=VenuePropertyTypePublic,
    status_code=status.HTTP_201_CREATED,
)
async def create_property_type(
    payload: VenuePropertyTypeCreate,
    db: TenantSession,
    current_tenant: CurrentTenant,
    _: CurrentWriter,
) -> VenuePropertyTypePublic:
    # Always write to the tenant in the request's workspace context so
    # superadmins (no user.tenant_id) work too.
    pt = VenuePropertyTypes(
        tenant_id=current_tenant.id,
        name=payload.name,
        icon=payload.icon,
    )
    db.add(pt)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=409, detail="Property type name already exists")
    db.refresh(pt)
    return VenuePropertyTypePublic.model_validate(pt)


@property_types_router.patch("/{property_type_id}", response_model=VenuePropertyTypePublic)
async def update_property_type(
    property_type_id: uuid.UUID,
    payload: VenuePropertyTypeUpdate,
    db: TenantSession,
    _: CurrentWriter,
) -> VenuePropertyTypePublic:
    pt = db.get(VenuePropertyTypes, property_type_id)
    if not pt:
        raise HTTPException(status_code=404, detail="Property type not found")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(pt, k, v)
    db.commit()
    db.refresh(pt)
    return VenuePropertyTypePublic.model_validate(pt)


@property_types_router.delete(
    "/{property_type_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_property_type(
    property_type_id: uuid.UUID,
    db: TenantSession,
    _: CurrentWriter,
) -> None:
    pt = db.get(VenuePropertyTypes, property_type_id)
    if not pt:
        raise HTTPException(status_code=404, detail="Property type not found")
    db.delete(pt)
    db.commit()


# ---------------------------------------------------------------------------
# Portal property types (read-only list)
# ---------------------------------------------------------------------------


@property_types_router.get("/portal", response_model=list[VenuePropertyTypePublic])
async def list_property_types_portal(
    db: HumanTenantSession,
    _: CurrentHuman,
) -> list[VenuePropertyTypePublic]:
    rows = list(
        db.exec(select(VenuePropertyTypes).order_by(VenuePropertyTypes.name)).all()
    )
    return [VenuePropertyTypePublic.model_validate(r) for r in rows]
