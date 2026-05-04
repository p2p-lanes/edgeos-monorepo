import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.event_settings import crud
from app.api.event_settings.schemas import (
    EventSettingsCreate,
    EventSettingsPublic,
    EventSettingsUpdate,
)
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentWriter,
    HumanTenantSession,
    TenantSession,
)

router = APIRouter(prefix="/event-settings", tags=["event-settings"])


@router.get("/{popup_id}", response_model=EventSettingsPublic)
async def get_event_settings(
    popup_id: uuid.UUID,
    db: TenantSession,
    _: CurrentWriter,
) -> EventSettingsPublic:
    """Get event settings for a popup (backoffice)."""
    settings = crud.event_settings_crud.get_by_popup_id(db, popup_id)
    if not settings:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event settings not found"
        )
    return EventSettingsPublic.model_validate(settings)


@router.put("/{popup_id}", response_model=EventSettingsPublic)
async def upsert_event_settings(
    popup_id: uuid.UUID,
    settings_in: EventSettingsCreate,
    db: TenantSession,
    current_user: CurrentWriter,
) -> EventSettingsPublic:
    """Create or update event settings for a popup (backoffice)."""
    from app.api.event_settings.models import EventSettings
    from app.api.popup.crud import popups_crud
    from app.api.shared.enums import UserRole

    popup = popups_crud.get(db, popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found"
        )

    existing = crud.event_settings_crud.get_by_popup_id(db, popup_id)
    if existing:
        # Build the update from every ``EventSettingsUpdate`` field so any new
        # settings field (e.g. ``allowed_tags``, ``approval_notification_email``)
        # flows through without having to edit this list each time.
        update_data = settings_in.model_dump(
            include=set(EventSettingsUpdate.model_fields.keys())
        )
        update = EventSettingsUpdate(**update_data)
        updated = crud.event_settings_crud.update(db, existing, update)
        return EventSettingsPublic.model_validate(updated)

    tenant_id = (
        popup.tenant_id
        if current_user.role == UserRole.SUPERADMIN
        else current_user.tenant_id
    )
    settings_data = settings_in.model_dump()
    settings_data["tenant_id"] = tenant_id
    settings_data["popup_id"] = popup_id
    settings = EventSettings(**settings_data)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return EventSettingsPublic.model_validate(settings)


@router.patch("/{popup_id}", response_model=EventSettingsPublic)
async def update_event_settings(
    popup_id: uuid.UUID,
    settings_in: EventSettingsUpdate,
    db: TenantSession,
    _: CurrentWriter,
) -> EventSettingsPublic:
    """Partial update of event settings (backoffice)."""
    existing = crud.event_settings_crud.get_by_popup_id(db, popup_id)
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event settings not found"
        )
    updated = crud.event_settings_crud.update(db, existing, settings_in)
    return EventSettingsPublic.model_validate(updated)


# ---------------------------------------------------------------------------
# Portal endpoint (human can read settings to know permissions)
# ---------------------------------------------------------------------------


@router.get("/portal/settings/{popup_id}", response_model=EventSettingsPublic | None)
async def get_portal_event_settings(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
    _: CurrentHuman,
) -> EventSettingsPublic | None:
    """Get event settings for a popup (portal). Returns null if not configured."""
    settings = crud.event_settings_crud.get_by_popup_id(db, popup_id)
    if not settings:
        return None
    return EventSettingsPublic.model_validate(settings)
