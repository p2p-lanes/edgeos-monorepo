import uuid

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.coupon import crud
from app.api.coupon.schemas import (
    CouponCreate,
    CouponPublic,
    CouponUpdate,
    CouponValidate,
    CouponValidatePublicRequest,
    CouponValidatePublicResponse,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.tenants import PublicTenant
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentUser,
    CurrentWriter,
    SessionDep,
    TenantSession,
)
from app.core.rate_limit import RateLimit

router = APIRouter(prefix="/coupons", tags=["coupons"])


@router.post(
    "/validate-public",
    response_model=CouponValidatePublicResponse,
    tags=["coupons"],
    dependencies=[
        Depends(RateLimit(limit=30, window_sec=60, key_prefix="rl:coupon-public")),
    ],
)
async def validate_coupon_public(
    request_in: CouponValidatePublicRequest,
    db: SessionDep,
    tenant: PublicTenant,
) -> CouponValidatePublicResponse:
    """Validate a coupon code for an anonymous open-ticketing checkout (no JWT required).

    Returns coupon details on success. Returns 400 with uniform message for
    any invalid/expired/unknown state. Returns 403 if popup is not direct-sale.
    Rate-limited 30/min/IP.
    """
    return crud.coupons_crud.validate_public(
        db,
        popup_slug=request_in.popup_slug,
        code=request_in.code,
        tenant_id=tenant.id,
    )


@router.get("", response_model=ListModel[CouponPublic])
async def list_coupons(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    is_active: bool | None = None,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[CouponPublic]:
    """List all coupons with optional filters (BO only)."""
    if popup_id:
        coupons, total = crud.coupons_crud.find_by_popup(
            db,
            popup_id=popup_id,
            skip=skip,
            limit=limit,
            is_active=is_active,
            search=search,
        )
    else:
        coupons, total = crud.coupons_crud.find(
            db, skip=skip, limit=limit, search=search, search_fields=["code"]
        )

    return ListModel[CouponPublic](
        results=[CouponPublic.model_validate(c) for c in coupons],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{coupon_id}", response_model=CouponPublic)
async def get_coupon(
    coupon_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> CouponPublic:
    """Get a single coupon by ID (BO only)."""
    coupon = crud.coupons_crud.get(db, coupon_id)

    if not coupon:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Coupon not found",
        )

    return CouponPublic.model_validate(coupon)


@router.post("/validate", response_model=CouponPublic)
async def validate_coupon(
    coupon_in: CouponValidate,
    db: SessionDep,
    _: CurrentHuman,
) -> CouponPublic:
    """
    Validate a coupon code (Portal - Human only).

    This endpoint is used by the ticketing portal to check if a coupon is valid
    before applying it to a payment.
    """
    coupon = crud.coupons_crud.validate_coupon(db, coupon_in.code, coupon_in.popup_id)
    return CouponPublic.model_validate(coupon)


@router.post("", response_model=CouponPublic, status_code=status.HTTP_201_CREATED)
async def create_coupon(
    coupon_in: CouponCreate,
    db: TenantSession,
    current_user: CurrentWriter,
) -> CouponPublic:
    """Create a new coupon (BO only)."""

    # Check for existing coupon with same code in popup
    existing = crud.coupons_crud.get_by_code(db, coupon_in.code, coupon_in.popup_id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A coupon with this code already exists in this popup",
        )

    # Set tenant_id based on user role
    if current_user.role == UserRole.SUPERADMIN:
        from app.api.popup.crud import popups_crud

        popup = popups_crud.get(db, coupon_in.popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )
        tenant_id = popup.tenant_id
    else:
        tenant_id = current_user.tenant_id

    # Create coupon with tenant_id
    from app.api.coupon.models import Coupons

    coupon_data = coupon_in.model_dump()
    coupon_data["tenant_id"] = tenant_id
    coupon = Coupons(**coupon_data)

    db.add(coupon)
    db.commit()
    db.refresh(coupon)

    return CouponPublic.model_validate(coupon)


@router.patch("/{coupon_id}", response_model=CouponPublic)
async def update_coupon(
    coupon_id: uuid.UUID,
    coupon_in: CouponUpdate,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> CouponPublic:
    """Update a coupon (BO only)."""

    coupon = crud.coupons_crud.get(db, coupon_id)

    if not coupon:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Coupon not found",
        )

    # Check code uniqueness if being updated
    if coupon_in.code and coupon_in.code.upper() != coupon.code:
        existing = crud.coupons_crud.get_by_code(db, coupon_in.code, coupon.popup_id)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A coupon with this code already exists in this popup",
            )

    updated = crud.coupons_crud.update(db, coupon, coupon_in)
    return CouponPublic.model_validate(updated)


@router.delete("/{coupon_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_coupon(
    coupon_id: uuid.UUID,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> None:
    """Delete a coupon (BO only)."""

    coupon = crud.coupons_crud.get(db, coupon_id)

    if not coupon:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Coupon not found",
        )

    crud.coupons_crud.delete(db, coupon)
