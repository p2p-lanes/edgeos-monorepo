import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.cart.crud import carts_crud
from app.api.cart.schemas import (
    AbandonedCartPublic,
    CartHumanInfo,
    CartPaymentInfo,
    CartPopupInfo,
    CartPublic,
    CartState,
    CartUpdate,
)
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentUser,
    HumanTenantSession,
    TenantSession,
)

router = APIRouter(prefix="/carts", tags=["carts"])


def _resolve_cart_flow_id(
    db: HumanTenantSession, popup_id: uuid.UUID, sales_flow_id: uuid.UUID | None
) -> uuid.UUID:
    from app.api.sales_flow.crud import sales_flows_crud

    flow = (
        sales_flows_crud.get(db, sales_flow_id)
        if sales_flow_id is not None
        else sales_flows_crud.get_default_flow(db, popup_id)
    )
    if flow is None or flow.popup_id != popup_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return flow.id


@router.get("", response_model=ListModel[AbandonedCartPublic])
async def list_abandoned_carts(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[AbandonedCartPublic]:
    """List all abandoned carts with human, popup and payment info (BO only)."""
    from sqlalchemy import text
    from sqlmodel import select

    from app.api.application.models import Applications
    from app.api.payment.models import Payments
    from app.api.payment.schemas import PaymentStatus

    carts, total = carts_crud.find_all(db, popup_id=popup_id, skip=skip, limit=limit)

    pending_statuses = [PaymentStatus.PENDING.value, PaymentStatus.EXPIRED.value]

    results = []
    for cart in carts:
        human = cart.human
        popup = cart.popup

        # Find pending/expired payments for this cart. Authenticated carts link
        # payments through the human's applications; anonymous open-checkout
        # carts have no application, so correlate by the buyer email stored in
        # the payment's buyer_snapshot.
        if cart.human_id is not None:
            payment_stmt = (
                select(Payments)
                .join(Applications, Payments.application_id == Applications.id)  # type: ignore[arg-type]
                .where(
                    Applications.human_id == cart.human_id,
                    Applications.popup_id == cart.popup_id,
                    Payments.status.in_(pending_statuses),  # type: ignore[attr-defined]
                )
                .order_by(Payments.created_at.desc())  # type: ignore[union-attr]
            )
        else:
            payment_stmt = (
                select(Payments)
                .where(
                    Payments.application_id.is_(None),  # type: ignore[union-attr]
                    Payments.popup_id == cart.popup_id,
                    Payments.status.in_(pending_statuses),  # type: ignore[attr-defined]
                    text("buyer_snapshot->>'buyer_email' = :buyer_email"),
                )
                .params(buyer_email=(cart.email or "").lower())
                .order_by(Payments.created_at.desc())  # type: ignore[union-attr]
            )
        payments = list(db.exec(payment_stmt).all())

        items = CartState.model_validate(cart.items) if cart.items else CartState()

        human_info = (
            CartHumanInfo(
                id=human.id,
                email=human.email,
                first_name=human.first_name,
                last_name=human.last_name,
            )
            if human is not None
            else None
        )

        results.append(
            AbandonedCartPublic(
                id=cart.id,
                items=items,
                created_at=cart.created_at,
                updated_at=cart.updated_at,
                email=human.email if human is not None else cart.email,
                human=human_info,
                popup=CartPopupInfo(
                    id=popup.id,
                    name=popup.name,
                    slug=popup.slug,
                ),
                payments=[
                    CartPaymentInfo(
                        id=p.id,
                        status=p.status,
                        amount=float(p.amount),
                        currency=p.currency,
                        created_at=p.created_at,
                    )
                    for p in payments
                ],
            )
        )

    return ListModel[AbandonedCartPublic](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/my/{popup_id}", response_model=CartPublic | None)
async def get_my_cart(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    sales_flow_id: uuid.UUID | None = None,
) -> CartPublic | None:
    """Get cart for current human and popup (Portal). Returns null if none exists."""
    flow_id = _resolve_cart_flow_id(db, popup_id, sales_flow_id)
    cart = carts_crud.find_by_human_popup_flow(
        db,
        human_id=current_human.id,
        popup_id=popup_id,
        sales_flow_id=flow_id,
    )

    if not cart:
        return None

    items = CartState.model_validate(cart.items) if cart.items else CartState()

    return CartPublic(
        id=cart.id,
        human_id=cart.human_id,
        popup_id=cart.popup_id,
        items=items,
        created_at=cart.created_at,
        updated_at=cart.updated_at,
    )


@router.put("/my/{popup_id}", response_model=CartPublic)
async def update_my_cart(
    popup_id: uuid.UUID,
    cart_in: CartUpdate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    sales_flow_id: uuid.UUID | None = None,
) -> CartPublic:
    """Replace cart items for current human and popup (Portal)."""
    from app.api.popup.crud import popups_crud
    from app.api.popup.guards import ensure_popup_writable

    ensure_popup_writable(popups_crud.get(db, popup_id))
    flow_id = _resolve_cart_flow_id(db, popup_id, sales_flow_id)

    cart = carts_crud.get_or_create(
        db,
        human_id=current_human.id,
        popup_id=popup_id,
        tenant_id=current_human.tenant_id,
        sales_flow_id=flow_id,
    )

    cart = carts_crud.update_items(db, cart, cart_in.items)
    items = CartState.model_validate(cart.items) if cart.items else CartState()

    return CartPublic(
        id=cart.id,
        human_id=cart.human_id,
        popup_id=cart.popup_id,
        items=items,
        created_at=cart.created_at,
        updated_at=cart.updated_at,
    )


@router.delete("/my/{popup_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_cart(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    sales_flow_id: uuid.UUID | None = None,
) -> None:
    """Clear cart for current human and popup (Portal)."""
    from app.api.popup.crud import popups_crud
    from app.api.popup.guards import ensure_popup_writable

    ensure_popup_writable(popups_crud.get(db, popup_id))
    flow_id = _resolve_cart_flow_id(db, popup_id, sales_flow_id)

    carts_crud.delete_by_human_popup(
        db,
        human_id=current_human.id,
        popup_id=popup_id,
        sales_flow_id=flow_id,
    )
    db.commit()
