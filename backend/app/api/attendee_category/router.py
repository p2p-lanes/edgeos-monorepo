import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.attendee_category.crud import attendee_categories_crud
from app.api.attendee_category.schemas import (
    AttendeeCategoryCreate,
    AttendeeCategoryPublic,
    AttendeeCategoryUpdate,
)
from app.api.shared.response import ListModel, Paging
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentUser,
    CurrentWriter,
    HumanTenantSession,
    TenantSession,
)

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


@router.get(
    "/portal/popups/{popup_id}/attendee-categories",
    response_model=ListModel[AttendeeCategoryPublic],
    tags=["portal"],
)
async def list_attendee_categories_portal(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
    _: CurrentHuman,
    sales_flow_id: uuid.UUID | None = None,
) -> ListModel[AttendeeCategoryPublic]:
    """Portal counterpart of list_attendee_categories — accepts Human tokens.

    When sales_flow_id is supplied, returns categories owned by that flow.
    Popup-only callers receive all active flow-owned rows for compatibility.
    """
    if sales_flow_id is not None:
        from app.api.sales_flow.crud import sales_flows_crud

        flow = sales_flows_crud.get(db, sales_flow_id)
        if flow is None or flow.popup_id != popup_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sales flow not found for this popup",
            )
        categories = attendee_categories_crud.list_by_flow(db, flow.id)
    else:
        categories = attendee_categories_crud.list_by_popup(db, popup_id)
    results = [AttendeeCategoryPublic.model_validate(c) for c in categories]
    return ListModel[AttendeeCategoryPublic](
        results=results,
        paging=Paging(offset=0, limit=len(results), total=len(results)),
    )


@router.get(
    "/sales-flows/{flow_id}/attendee-categories",
    response_model=ListModel[AttendeeCategoryPublic],
)
async def list_sales_flow_attendee_categories(
    flow_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> ListModel[AttendeeCategoryPublic]:
    """List the active attendee categories owned by one sales flow."""
    from app.api.sales_flow.crud import sales_flows_crud

    flow = sales_flows_crud.get(db, flow_id)
    if flow is None:
        raise HTTPException(status_code=404, detail="Sales flow not found")
    categories = attendee_categories_crud.list_by_flow(db, flow.id)
    results = [AttendeeCategoryPublic.model_validate(c) for c in categories]
    return ListModel[AttendeeCategoryPublic](
        results=results,
        paging=Paging(offset=0, limit=len(results), total=len(results)),
    )


@router.post(
    "/sales-flows/{flow_id}/attendee-categories",
    response_model=AttendeeCategoryPublic,
    status_code=status.HTTP_201_CREATED,
)
async def create_sales_flow_attendee_category(
    flow_id: uuid.UUID,
    data: AttendeeCategoryCreate,
    db: TenantSession,
    _: CurrentWriter,
) -> AttendeeCategoryPublic:
    """Create or restore a category owned by this flow."""
    from app.api.sales_flow.crud import sales_flows_crud

    flow = sales_flows_crud.get(db, flow_id)
    if flow is None:
        raise HTTPException(status_code=404, detail="Sales flow not found")
    category = attendee_categories_crud.create_for_flow(db, data, flow)
    return AttendeeCategoryPublic.model_validate(category)


@router.get(
    "/attendee-categories/{category_id}",
    response_model=AttendeeCategoryPublic,
)
async def get_attendee_category(
    category_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> AttendeeCategoryPublic:
    """Get one attendee category in the current organization."""
    category = attendee_categories_crud.get(db, category_id)
    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Category not found",
        )
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

    For primary categories, only display_meta, required_fields, and sort_order
    may be updated.
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
