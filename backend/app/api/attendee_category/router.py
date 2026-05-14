import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.attendee_category.crud import attendee_categories_crud
from app.api.attendee_category.schemas import (
    AttendeeCategoryCreate,
    AttendeeCategoryPublic,
    AttendeeCategoryUpdate,
)
from app.api.shared.response import ListModel, Paging
from app.core.dependencies.users import CurrentUser, CurrentWriter, TenantSession

router = APIRouter(tags=["attendee-categories"])


@router.get(
    "/popups/{popup_id}/attendee-categories",
    response_model=ListModel[AttendeeCategoryPublic],
)
async def list_attendee_categories(
    popup_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> ListModel[AttendeeCategoryPublic]:
    """List attendee categories for a popup (VIEWER and ADMIN can read)."""
    categories = attendee_categories_crud.list_by_popup(db, popup_id)
    results = [AttendeeCategoryPublic.model_validate(c) for c in categories]
    return ListModel[AttendeeCategoryPublic](
        results=results,
        paging=Paging(offset=0, limit=len(results), total=len(results)),
    )


@router.post(
    "/attendee-categories",
    response_model=AttendeeCategoryPublic,
    status_code=status.HTTP_201_CREATED,
)
async def create_attendee_category(
    data: AttendeeCategoryCreate,
    db: TenantSession,
    current_user: CurrentWriter,
) -> AttendeeCategoryPublic:
    """Create a new attendee category (ADMIN only)."""
    from app.api.shared.enums import UserRole

    if current_user.role == UserRole.SUPERADMIN:
        from app.api.popup.models import Popups

        popup = db.get(Popups, data.popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )
        tenant_id = popup.tenant_id
    else:
        if current_user.tenant_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User has no tenant assigned",
            )
        tenant_id = current_user.tenant_id

    category = attendee_categories_crud.create_for_popup(db, data, tenant_id)
    return AttendeeCategoryPublic.model_validate(category)


@router.patch(
    "/attendee-categories/{category_id}",
    response_model=AttendeeCategoryPublic,
)
async def update_attendee_category(
    category_id: uuid.UUID,
    data: AttendeeCategoryUpdate,
    db: TenantSession,
    _: CurrentWriter,
) -> AttendeeCategoryPublic:
    """Update an attendee category (ADMIN only).

    For primary categories, only display_meta, required_fields, sort_order,
    and enabled_in_passes_flow may be updated.
    key and is_primary cannot be changed.
    """
    category = attendee_categories_crud.get(db, category_id)
    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found",
        )
    updated = attendee_categories_crud.update_category(db, category, data)
    return AttendeeCategoryPublic.model_validate(updated)


@router.delete(
    "/attendee-categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_attendee_category(
    category_id: uuid.UUID,
    db: TenantSession,
    _: CurrentWriter,
) -> None:
    """Delete an attendee category (ADMIN only).

    Raises 400 if the category is the primary (main) one.
    """
    category = attendee_categories_crud.get(db, category_id)
    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found",
        )
    attendee_categories_crud.delete_category(db, category)
