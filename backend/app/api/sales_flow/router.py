import uuid
from typing import NoReturn

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.api.sales_flow import crud
from app.api.sales_flow.schemas import (
    SalesFlowCreate,
    SalesFlowPublic,
    SalesFlowUpdate,
)
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import CurrentOperator, CurrentWriter, TenantSession

router = APIRouter(prefix="/sales-flows", tags=["sales-flows"])


def _raise_on_default_conflict(exc: IntegrityError) -> NoReturn:
    if "uq_sales_flows_default_per_popup" in str(getattr(exc, "orig", exc)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This popup already has a default sales flow",
        ) from exc
    raise exc


@router.get("", response_model=ListModel[SalesFlowPublic])
async def list_sales_flows(
    db: TenantSession,
    _: CurrentOperator,
    popup_id: uuid.UUID,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[SalesFlowPublic]:
    """List sales flows for a popup (BO only)."""
    flows, total = crud.sales_flows_crud.find_by_popup(
        db, popup_id=popup_id, skip=skip, limit=limit
    )
    return ListModel[SalesFlowPublic](
        results=[SalesFlowPublic.model_validate(f) for f in flows],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{flow_id}", response_model=SalesFlowPublic)
async def get_sales_flow(
    flow_id: uuid.UUID,
    db: TenantSession,
    _: CurrentOperator,
) -> SalesFlowPublic:
    """Get a single sales flow (BO only)."""
    flow = crud.sales_flows_crud.get(db, flow_id)
    if not flow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sales flow not found",
        )
    return SalesFlowPublic.model_validate(flow)


@router.post("", response_model=SalesFlowPublic, status_code=status.HTTP_201_CREATED)
async def create_sales_flow(
    flow_in: SalesFlowCreate,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> SalesFlowPublic:
    """Create a sales flow (BO only). tenant_id is derived from the popup."""
    from app.api.popup.crud import popups_crud

    popup = popups_crud.get(db, flow_in.popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    existing = crud.sales_flows_crud.get_by_slug(db, flow_in.popup_id, flow_in.slug)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A sales flow with this slug already exists for this popup",
        )

    try:
        flow = crud.sales_flows_crud.create(db, flow_in, tenant_id=popup.tenant_id)
    except IntegrityError as exc:
        db.rollback()
        _raise_on_default_conflict(exc)

    return SalesFlowPublic.model_validate(flow)


@router.patch("/{flow_id}", response_model=SalesFlowPublic)
async def update_sales_flow(
    flow_id: uuid.UUID,
    flow_in: SalesFlowUpdate,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> SalesFlowPublic:
    """Update a sales flow (BO only)."""
    flow = crud.sales_flows_crud.get(db, flow_id)
    if not flow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sales flow not found",
        )

    if flow_in.slug and flow_in.slug != flow.slug:
        existing = crud.sales_flows_crud.get_by_slug(db, flow.popup_id, flow_in.slug)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A sales flow with this slug already exists for this popup",
            )

    try:
        updated = crud.sales_flows_crud.update(db, flow, flow_in)
    except IntegrityError as exc:
        db.rollback()
        _raise_on_default_conflict(exc)

    return SalesFlowPublic.model_validate(updated)


@router.delete("/{flow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sales_flow(
    flow_id: uuid.UUID,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> None:
    """Delete a sales flow (BO only). The default flow of a popup cannot be deleted."""
    flow = crud.sales_flows_crud.get(db, flow_id)
    if not flow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sales flow not found",
        )
    if flow.is_default:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a popup's default sales flow",
        )
    crud.sales_flows_crud.delete(db, flow)
