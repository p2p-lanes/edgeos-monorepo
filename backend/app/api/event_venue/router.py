import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

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
    VenueBusySlot,
    VenueExceptionCreate,
    VenueExceptionPublic,
    VenueExceptionUpdate,
    VenueOpenRange,
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
async def resolve_url(
    url: str = Query(..., description="Short URL to resolve"),
) -> dict:
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
property_types_router = APIRouter(
    prefix="/venue-property-types", tags=["venue-property-types"]
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _set_property_types(
    db,
    venue: EventVenues,
    property_type_ids: list[uuid.UUID] | None,
) -> None:
    """Replace a venue's property links with the provided ids.

    Dedupes the input (the UI prevents duplicates but a malformed payload
    shouldn't 500), and flushes the deletes before issuing the new inserts
    so the unique(venue_id, property_type_id) constraint doesn't see the
    old rows transiently.
    """
    if property_type_ids is None:
        return

    # Preserve order while removing duplicates.
    unique_ids: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for pt_id in property_type_ids:
        if pt_id in seen:
            continue
        seen.add(pt_id)
        unique_ids.append(pt_id)

    existing = list(
        db.exec(
            select(VenueProperties).where(VenueProperties.venue_id == venue.id)
        ).all()
    )
    existing_ids = {link.property_type_id: link for link in existing}

    # Remove links that shouldn't stay.
    to_delete = [link for pt_id, link in existing_ids.items() if pt_id not in seen]
    for link in to_delete:
        db.delete(link)
    if to_delete:
        db.flush()

    # Add links that don't exist yet.
    for pt_id in unique_ids:
        if pt_id in existing_ids and existing_ids[pt_id] not in to_delete:
            continue
        db.add(
            VenueProperties(
                tenant_id=venue.tenant_id,
                venue_id=venue.id,
                property_type_id=pt_id,
            )
        )


def _get_venue_or_404(db, venue_id: uuid.UUID) -> EventVenues:
    venue = db.get(EventVenues, venue_id)
    if not venue:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Venue not found"
        )
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
            db,
            popup_id=popup_id,
            skip=skip,
            limit=limit,
            search=search,
        )
    else:
        venues, total = crud.event_venues_crud.find(
            db,
            skip=skip,
            limit=limit,
            search=search,
            search_fields=["title", "location"],
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found"
        )

    tenant_id = (
        popup.tenant_id
        if current_user.role == UserRole.SUPERADMIN
        else current_user.tenant_id
    )
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
    # Flush deletes before inserting fresh rows so we never collide with the
    # previous ids (harmless since the unique constraint was dropped in
    # 0037, but keeping the pattern keeps the SQL predictable).
    db.flush()
    # Multiple rows per (venue, day_of_week) are allowed so venues can have
    # split schedules (e.g. 09-11 AND 17-21 the same day). We only dedupe
    # exact duplicates to keep the client idempotent.
    seen: set[tuple[int, object, object, bool]] = set()
    inserted = 0
    for h in payload.hours:
        key = (h.day_of_week, h.open_time, h.close_time, h.is_closed)
        if key in seen:
            continue
        seen.add(key)
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
        inserted += 1
    db.commit()
    return {"count": inserted}


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
        raise HTTPException(
            status_code=400, detail="start_datetime must be before end_datetime"
        )
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


def _resolve_popup_timezone(db, popup_id: uuid.UUID) -> str:
    """Read the configured timezone from event_settings, falling back to UTC."""
    from app.api.event_settings.crud import event_settings_crud

    settings = event_settings_crud.get_by_popup_id(db, popup_id)
    if settings and settings.timezone:
        try:
            ZoneInfo(settings.timezone)
            return settings.timezone
        except ZoneInfoNotFoundError:
            return "UTC"
    return "UTC"


def _compute_availability(
    db,
    venue,
    start: datetime,
    end: datetime,
    exclude_event_id: uuid.UUID | None = None,
) -> VenueAvailability:
    """Return open ranges (derived from weekly_hours + open exceptions) and
    busy slots (existing events with setup/teardown + closed exceptions).

    Times in weekly_hours are interpreted in the popup's configured TZ so
    that 'opens at 09:00' means 09:00 local in that TZ.

    ``exclude_event_id`` drops one event from the busy list — used by edit
    forms so the event being edited doesn't appear to overlap itself.
    """
    from app.api.event.models import Events
    from app.api.event.schemas import EventStatus

    if end <= start:
        raise HTTPException(status_code=400, detail="end must be after start")

    tz_name = _resolve_popup_timezone(db, venue.popup_id)
    tz = ZoneInfo(tz_name)

    # --- Busy from events (+ setup/teardown) and closed exceptions --------
    # Cancelled and rejected events no longer hold their slot; treat them
    # as freed availability so calendars don't show ghost blocks.
    events_query = (
        select(Events)
        .where(Events.venue_id == venue.id)
        .where(Events.status.notin_([EventStatus.CANCELLED, EventStatus.REJECTED]))
        .where(Events.start_time < end)
        .where(Events.end_time > start)
    )
    if exclude_event_id is not None:
        events_query = events_query.where(Events.id != exclude_event_id)
    events = list(db.exec(events_query).all())

    closed_exceptions = list(
        db.exec(
            select(VenueExceptions)
            .where(VenueExceptions.venue_id == venue.id)
            .where(VenueExceptions.is_closed == True)  # noqa: E712
            .where(VenueExceptions.start_datetime < end)
            .where(VenueExceptions.end_datetime > start)
        ).all()
    )
    open_exceptions = list(
        db.exec(
            select(VenueExceptions)
            .where(VenueExceptions.venue_id == venue.id)
            .where(VenueExceptions.is_closed == False)  # noqa: E712
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
                event_id=e.id,
                event_start=e.start_time,
                event_end=e.end_time,
            )
        )
    for exc in closed_exceptions:
        busy.append(
            VenueBusySlot(
                start=exc.start_datetime,
                end=exc.end_datetime,
                source="exception",
                label=exc.reason,
            )
        )

    # --- Open ranges from weekly_hours + open exceptions ------------------
    # A venue can have multiple open/close rows per weekday (split schedule),
    # so bucket by day into a list.
    weekly_by_day: dict[int, list] = {}
    for row in db.exec(
        select(VenueWeeklyHours).where(VenueWeeklyHours.venue_id == venue.id)
    ).all():
        weekly_by_day.setdefault(row.day_of_week, []).append(row)

    raw_ranges: list[tuple[datetime, datetime]] = []
    start_local = start.astimezone(tz)
    end_local = end.astimezone(tz)
    # If the venue has no weekly hours AND no open exceptions configured,
    # treat it as always-open across the query window. Users that never
    # set hours generally mean "the venue is permanently available";
    # surfacing that as an empty schedule (fully closed) is counter-
    # intuitive. Closed exceptions still carve out busy slots. If the
    # user opted into open exceptions without weekly hours, they've
    # expressed intent that only those windows are open — respect it.
    if not weekly_by_day and not open_exceptions:
        raw_ranges.append((start, end))
    else:
        day_cursor: date = start_local.date()
        last_day: date = end_local.date()
        while day_cursor <= last_day:
            dow = day_cursor.weekday()  # Mon=0 … Sun=6 (matches our schema)
            for hours in weekly_by_day.get(dow, []):
                if (
                    hours.is_closed
                    or hours.open_time is None
                    or hours.close_time is None
                ):
                    continue
                open_local = datetime.combine(day_cursor, hours.open_time, tzinfo=tz)
                close_local = datetime.combine(day_cursor, hours.close_time, tzinfo=tz)
                # Handle overnight (close < open).
                if close_local <= open_local:
                    close_local = close_local + timedelta(days=1)
                clamped_start = max(open_local, start)
                clamped_end = min(close_local, end)
                if clamped_start < clamped_end:
                    raw_ranges.append((clamped_start, clamped_end))
            day_cursor = day_cursor + timedelta(days=1)

    # Open exceptions add windows even when weekly_hours is closed.
    for exc in open_exceptions:
        s = max(exc.start_datetime, start)
        e_ = min(exc.end_datetime, end)
        if s < e_:
            raw_ranges.append((s, e_))

    # Merge overlapping/adjacent ranges.
    raw_ranges.sort(key=lambda r: r[0])
    merged: list[tuple[datetime, datetime]] = []
    for s, e_ in raw_ranges:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e_))
        else:
            merged.append((s, e_))

    open_ranges = [VenueOpenRange(start=s, end=e_) for s, e_ in merged]

    return VenueAvailability(
        venue_id=venue.id,
        timezone=tz_name,
        open_ranges=open_ranges,
        busy=busy,
    )


@router.get("/{venue_id}/availability", response_model=VenueAvailability)
async def get_availability(
    venue_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
    start: datetime = Query(...),
    end: datetime = Query(...),
    exclude_event_id: uuid.UUID | None = Query(default=None),
) -> VenueAvailability:
    """Return open windows and busy slots for a venue in the given range."""
    venue = _get_venue_or_404(db, venue_id)
    return _compute_availability(db, venue, start, end, exclude_event_id)


# ---------------------------------------------------------------------------
# Portal endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/portal/venues/{venue_id}/availability",
    response_model=VenueAvailability,
)
async def get_portal_availability(
    venue_id: uuid.UUID,
    db: HumanTenantSession,
    _: CurrentHuman,
    start: datetime = Query(...),
    end: datetime = Query(...),
    exclude_event_id: uuid.UUID | None = Query(default=None),
) -> VenueAvailability:
    """Portal-side availability query — same shape as the backoffice one,
    used by the event-creation form to show open/busy slots per day.
    """
    venue = _get_venue_or_404(db, venue_id)
    return _compute_availability(db, venue, start, end, exclude_event_id)


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
        db,
        popup_id=popup_id,
        skip=skip,
        limit=limit,
        search=search,
    )
    # Hide pending venues from portal listings.
    venues = [v for v in venues if v.status == VenueStatus.ACTIVE]
    return ListModel[EventVenuePublic](
        results=[EventVenuePublic.model_validate(v) for v in venues],
        paging=Paging(offset=skip, limit=limit, total=len(venues)),
    )


@router.patch("/portal/venues/{venue_id}", response_model=EventVenuePublic)
async def update_portal_venue(
    venue_id: uuid.UUID,
    venue_in: EventVenueUpdate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> EventVenuePublic:
    """Let a human edit a venue they created from the portal. Admin-only
    fields (``status``) are ignored on this endpoint — re-approval lives in
    the backoffice.
    """
    venue = _get_venue_or_404(db, venue_id)
    if venue.owner_id != current_human.id:
        raise HTTPException(
            status_code=403,
            detail="Only the venue's owner can edit it from the portal",
        )

    update_data = venue_in.model_dump(
        exclude_unset=True, exclude={"property_type_ids", "status"}
    )
    for k, v in update_data.items():
        setattr(venue, k, v)
    venue.updated_at = datetime.utcnow()
    if venue_in.property_type_ids is not None:
        _set_property_types(db, venue, venue_in.property_type_ids)
    db.commit()
    db.refresh(venue)
    return EventVenuePublic.model_validate(venue)


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
    pending = settings.venues_require_approval
    venue_data["status"] = VenueStatus.PENDING if pending else VenueStatus.ACTIVE
    venue = EventVenues(**venue_data)
    db.add(venue)
    db.flush()
    _set_property_types(db, venue, venue_in.property_type_ids)
    db.commit()
    db.refresh(venue)

    if pending:
        from app.api.popup.crud import popups_crud
        from app.services.approval_notify import notify_venue_pending_approval

        popup = popups_crud.get(db, venue.popup_id)
        await notify_venue_pending_approval(venue, popup, settings)

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


@property_types_router.patch(
    "/{property_type_id}", response_model=VenuePropertyTypePublic
)
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
