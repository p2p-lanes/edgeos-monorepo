import uuid

import httpx
from fastapi import APIRouter, HTTPException, Query, status

from app.api.event_venue import crud
from app.api.event_venue.schemas import EventVenueCreate, EventVenuePublic, EventVenueUpdate
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentUser,
    CurrentWriter,
    HumanTenantSession,
    TenantSession,
)

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
    venue = crud.event_venues_crud.get(db, venue_id)
    if not venue:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Venue not found")
    return EventVenuePublic.model_validate(venue)


@router.post("", response_model=EventVenuePublic, status_code=status.HTTP_201_CREATED)
async def create_venue(
    venue_in: EventVenueCreate,
    db: TenantSession,
    current_user: CurrentWriter,
) -> EventVenuePublic:
    from app.api.event_venue.models import EventVenues
    from app.api.popup.crud import popups_crud
    from app.api.shared.enums import UserRole

    popup = popups_crud.get(db, venue_in.popup_id)
    if not popup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found")

    tenant_id = popup.tenant_id if current_user.role == UserRole.SUPERADMIN else current_user.tenant_id
    venue_data = venue_in.model_dump()
    venue_data["tenant_id"] = tenant_id
    venue_data["owner_id"] = current_user.id
    venue = EventVenues(**venue_data)
    db.add(venue)
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
    venue = crud.event_venues_crud.get(db, venue_id)
    if not venue:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Venue not found")
    updated = crud.event_venues_crud.update(db, venue, venue_in)
    return EventVenuePublic.model_validate(updated)


@router.delete("/{venue_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_venue(
    venue_id: uuid.UUID,
    db: TenantSession,
    _: CurrentWriter,
) -> None:
    venue = crud.event_venues_crud.get(db, venue_id)
    if not venue:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Venue not found")
    crud.event_venues_crud.delete(db, venue)



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
    return ListModel[EventVenuePublic](
        results=[EventVenuePublic.model_validate(v) for v in venues],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post("/portal/venues", response_model=EventVenuePublic, status_code=status.HTTP_201_CREATED)
async def create_portal_venue(
    venue_in: EventVenueCreate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> EventVenuePublic:
    """Create a venue as a human (portal)."""
    from app.api.event_venue.models import EventVenues

    venue_data = venue_in.model_dump()
    venue_data["tenant_id"] = current_human.tenant_id
    venue_data["owner_id"] = current_human.id
    venue = EventVenues(**venue_data)
    db.add(venue)
    db.commit()
    db.refresh(venue)
    return EventVenuePublic.model_validate(venue)
