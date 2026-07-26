import json
import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.saved_view.crud import saved_views_crud
from app.api.saved_view.models import SavedViews
from app.api.saved_view.schemas import (
    MAX_SAVED_VIEW_CONFIG_CHARS,
    MAX_SAVED_VIEW_NAME_LENGTH,
    SAVED_VIEW_ENTITIES,
    SavedViewCreate,
    SavedViewPublic,
    SavedViewUpdate,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, Paging
from app.api.user.schemas import UserPublic
from app.core.dependencies.users import CurrentOperator, CurrentUser, TenantSession

router = APIRouter(prefix="/saved-views", tags=["saved-views"])


def _validate_entity(entity: str) -> None:
    if entity not in SAVED_VIEW_ENTITIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Saved views are not available for this list.",
        )


def _clean_name(name: str) -> str:
    name = name.strip()
    if not 1 <= len(name) <= MAX_SAVED_VIEW_NAME_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="View names must be between 1 and 100 characters.",
        )
    return name


def _validate_config(config: dict) -> None:
    if len(json.dumps(config)) > MAX_SAVED_VIEW_CONFIG_CHARS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This view is too large to save.",
        )


def _ensure_can_manage(view: SavedViews, current_user: UserPublic) -> None:
    if view.created_by == current_user.id:
        return
    if current_user.role in (UserRole.SUPERADMIN, UserRole.ADMIN):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only the person who created this view or an admin can change it.",
    )


def _ensure_unique_name(
    db: TenantSession,
    popup_id: uuid.UUID,
    entity: str,
    name: str,
    exclude_id: uuid.UUID | None = None,
) -> None:
    existing = saved_views_crud.get_by_popup_entity_name(db, popup_id, entity, name)
    if existing and existing.id != exclude_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A view with that name already exists.",
        )


@router.get("", response_model=ListModel[SavedViewPublic])
async def list_saved_views(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID,
    entity: str,
) -> ListModel[SavedViewPublic]:
    """List saved views for a popup and entity, ordered by name."""
    _validate_entity(entity)
    views = saved_views_crud.find_by_popup_entity(db, popup_id, entity)
    return ListModel[SavedViewPublic](
        results=[SavedViewPublic.model_validate(v) for v in views],
        paging=Paging(offset=0, limit=len(views), total=len(views)),
    )


@router.post("", response_model=SavedViewPublic, status_code=status.HTTP_201_CREATED)
async def create_saved_view(
    view_in: SavedViewCreate,
    db: TenantSession,
    current_user: CurrentOperator,
) -> SavedViewPublic:
    """Create a saved view shared with the whole team."""
    from app.api.popup.crud import popups_crud

    _validate_entity(view_in.entity)
    name = _clean_name(view_in.name)
    _validate_config(view_in.config)

    popup = popups_crud.get(db, view_in.popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    tenant_id = current_user.tenant_id
    if current_user.role == UserRole.SUPERADMIN:
        tenant_id = popup.tenant_id
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User has no tenant assigned",
        )

    _ensure_unique_name(db, view_in.popup_id, view_in.entity, name)

    view = saved_views_crud.create_view(
        db,
        tenant_id=tenant_id,
        popup_id=view_in.popup_id,
        entity=view_in.entity,
        name=name,
        config=view_in.config,
        created_by=current_user.id,
    )
    return SavedViewPublic.model_validate(view)


@router.patch("/{view_id}", response_model=SavedViewPublic)
async def update_saved_view(
    view_id: uuid.UUID,
    view_in: SavedViewUpdate,
    db: TenantSession,
    current_user: CurrentOperator,
) -> SavedViewPublic:
    """Rename a saved view or replace its configuration."""
    view = saved_views_crud.get(db, view_id)
    if not view:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Saved view not found",
        )

    _ensure_can_manage(view, current_user)

    name = None
    if view_in.name is not None:
        name = _clean_name(view_in.name)
        _ensure_unique_name(db, view.popup_id, view.entity, name, exclude_id=view.id)
    if view_in.config is not None:
        _validate_config(view_in.config)

    updated = saved_views_crud.update_view(db, view, name=name, config=view_in.config)
    return SavedViewPublic.model_validate(updated)


@router.delete("/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved_view(
    view_id: uuid.UUID,
    db: TenantSession,
    current_user: CurrentOperator,
) -> None:
    """Delete a saved view."""
    view = saved_views_crud.get(db, view_id)
    if not view:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Saved view not found",
        )

    _ensure_can_manage(view, current_user)
    saved_views_crud.delete(db, view)
