import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status

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
    AdminOrApiKey_CouponsRead,
    AdminOrApiKey_CouponsWrite,
    AdminOrApiKeySession_CouponsRead,
    AdminOrApiKeySession_CouponsWrite,
    CurrentHuman,
    SessionDep,
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

    Resolves the requested sales flow, or the popup's primary flow when
    `flow_slug` is omitted, and
    gates on `direct`/`upsale` flow types. Returns coupon details on
    success. Returns 400 with the uniform "Invalid or expired coupon"
    message for every failure state — unknown popup, unknown flow slug,
    inactive popup/flow, wrong flow type, or any invalid/expired/unknown
    coupon state — so an anonymous caller can never distinguish them.
    Rate-limited 30/min/IP.
    """
    return crud.coupons_crud.validate_public(
        db,
        popup_slug=request_in.popup_slug,
        code=request_in.code,
        tenant_id=tenant.id,
        flow_slug=request_in.flow_slug,
    )


@router.get("", response_model=ListModel[CouponPublic])
async def list_coupons(
    db: AdminOrApiKeySession_CouponsRead,
    _: AdminOrApiKey_CouponsRead,
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
    db: AdminOrApiKeySession_CouponsRead,
    _: AdminOrApiKey_CouponsRead,
) -> CouponPublic:
    """Get a single coupon by ID (BO only)."""
    coupon = crud.coupons_crud.get(db, coupon_id)

    if not coupon:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Coupon not found",
        )

    return CouponPublic.model_validate(coupon)


def _resolve_coupon_flow_id(
    db: SessionDep,
    popup_id: uuid.UUID,
    explicit_flow_id: uuid.UUID | None,
) -> uuid.UUID:
    """The flow a coupon discounts.

    Omitted means the popup's default flow, which is the only flow a
    coupon's `allows_coupons` check was ever read from
    (sdd/sales-flows-rediseno).

    Any flow type may own one. Unlike an invite or a group, redeeming a
    coupon creates nothing — it discounts a sale, and every flow sells.
    """
    from app.api.sales_flow.crud import sales_flows_crud

    if explicit_flow_id is None:
        default_flow = sales_flows_crud.get_default_flow(db, popup_id)
        if default_flow is None:
            from app.api.popup.crud import popups_crud

            if popups_crud.get(db, popup_id) is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Popup not found",
                )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sales flow not found",
            )
        return default_flow.id

    flow = sales_flows_crud.get(db, explicit_flow_id)
    if flow is None or flow.popup_id != popup_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sales flow not found for this popup",
        )
    return flow.id


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
    flow_id = _resolve_coupon_flow_id(db, coupon_in.popup_id, coupon_in.sales_flow_id)
    coupon = crud.coupons_crud.validate_coupon(
        db, coupon_in.code, coupon_in.popup_id, flow_id
    )
    return CouponPublic.model_validate(coupon)


@router.post("", response_model=CouponPublic, status_code=status.HTTP_201_CREATED)
async def create_coupon(
    coupon_in: CouponCreate,
    db: AdminOrApiKeySession_CouponsWrite,
    current_user: AdminOrApiKey_CouponsWrite,
    x_ai_tool_call_id: Annotated[
        str | None, Header(alias="X-EdgeOS-AI-Tool-Call-Id")
    ] = None,
) -> CouponPublic:
    """Create a new coupon (BO only)."""

    coupon_in.sales_flow_id = _resolve_coupon_flow_id(
        db, coupon_in.popup_id, coupon_in.sales_flow_id
    )

    # A code is unique per flow, so the same word may exist in another one.
    existing = crud.coupons_crud.get_by_code(
        db, coupon_in.code, coupon_in.sales_flow_id
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A coupon with this code already exists in this sales flow",
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

    # Stage the audit row in the same transaction as the coupon. The optional
    # tool-call id is supplied by the internal AI service; regular backoffice
    # creates are audited too, without AI metadata.
    from app.api.audit_log.actor import actor_from_user
    from app.api.audit_log.constants import AuditAction, AuditEntityType
    from app.api.audit_log.crud import audit_logs_crud

    audit_logs_crud.record(
        db,
        tenant_id=tenant_id,
        actor=actor_from_user(current_user),
        action=AuditAction.COUPON_CREATED,
        entity_type=AuditEntityType.COUPON,
        entity_id=coupon.id,
        entity_label=coupon.code,
        popup_id=coupon.popup_id,
        details={
            "via_ai": x_ai_tool_call_id is not None,
            "ai_tool_call_id": x_ai_tool_call_id,
            "snapshot": {
                "code": coupon.code,
                "discount_value": coupon.discount_value,
                "max_uses": coupon.max_uses,
                "is_active": coupon.is_active,
            },
        },
    )
    db.commit()
    db.refresh(coupon)

    return CouponPublic.model_validate(coupon)


@router.patch("/{coupon_id}", response_model=CouponPublic)
async def update_coupon(
    coupon_id: uuid.UUID,
    coupon_in: CouponUpdate,
    db: AdminOrApiKeySession_CouponsWrite,
    current_user: AdminOrApiKey_CouponsWrite,
    x_ai_tool_call_id: Annotated[
        str | None, Header(alias="X-EdgeOS-AI-Tool-Call-Id")
    ] = None,
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
        existing = crud.coupons_crud.get_by_code(
            db, coupon_in.code, coupon.sales_flow_id
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A coupon with this code already exists in this sales flow",
            )

    before = CouponPublic.model_validate(coupon).model_dump(mode="json")
    update_data = coupon_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(coupon, field, value)
    db.add(coupon)

    from app.api.audit_log.actor import actor_from_user
    from app.api.audit_log.constants import AuditAction, AuditEntityType
    from app.api.audit_log.crud import audit_logs_crud

    after = CouponPublic.model_validate(coupon).model_dump(mode="json")
    changed_fields = {
        field: {"from": before[field], "to": after[field]} for field in update_data
    }
    audit_logs_crud.record(
        db,
        tenant_id=coupon.tenant_id,
        actor=actor_from_user(current_user),
        action=AuditAction.COUPON_UPDATED,
        entity_type=AuditEntityType.COUPON,
        entity_id=coupon.id,
        entity_label=coupon.code,
        popup_id=coupon.popup_id,
        details={
            "via_ai": x_ai_tool_call_id is not None,
            "ai_tool_call_id": x_ai_tool_call_id,
            "changes": changed_fields,
            "snapshot": after,
        },
    )
    db.commit()
    db.refresh(coupon)
    return CouponPublic.model_validate(coupon)


@router.delete("/{coupon_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_coupon(
    coupon_id: uuid.UUID,
    db: AdminOrApiKeySession_CouponsWrite,
    _current_user: AdminOrApiKey_CouponsWrite,
) -> None:
    """Delete a coupon (BO only)."""

    coupon = crud.coupons_crud.get(db, coupon_id)

    if not coupon:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Coupon not found",
        )

    crud.coupons_crud.delete(db, coupon)
