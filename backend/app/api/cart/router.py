import uuid

from fastapi import APIRouter, status

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


@router.get("", response_model=ListModel[AbandonedCartPublic])
async def list_abandoned_carts(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[AbandonedCartPublic]:
    """List all abandoned carts with human, popup and payment info (BO only)."""
    from app.api.application.models import Applications
    from app.api.payment.models import Payments
    from app.api.payment.schemas import PaymentStatus

    carts, total = carts_crud.find_all(db, popup_id=popup_id, skip=skip, limit=limit)

    results = []
    for cart in carts:
        human = cart.human
        popup = cart.popup

        # Find pending/expired payments for this human+popup
        from sqlmodel import select

        payment_stmt = (
            select(Payments)
            .join(Applications, Payments.application_id == Applications.id)  # type: ignore[arg-type]
            .where(
                Applications.human_id == cart.human_id,
                Applications.popup_id == cart.popup_id,
                Payments.status.in_(  # type: ignore[attr-defined]
                    [PaymentStatus.PENDING.value, PaymentStatus.EXPIRED.value]
                ),
            )
            .order_by(Payments.created_at.desc())  # type: ignore[union-attr]
        )
        payments = list(db.exec(payment_stmt).all())

        items = CartState.model_validate(cart.items) if cart.items else CartState()

        results.append(
            AbandonedCartPublic(
                id=cart.id,
                items=items,
                created_at=cart.created_at,
                updated_at=cart.updated_at,
                human=CartHumanInfo(
                    id=human.id,
                    email=human.email,
                    first_name=human.first_name,
                    last_name=human.last_name,
                ),
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
) -> CartPublic | None:
    """Get cart for current human and popup (Portal). Returns null if none exists."""
    cart = carts_crud.find_by_human_popup(
        db,
        human_id=current_human.id,
        popup_id=popup_id,
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
) -> CartPublic:
    """Replace cart items for current human and popup (Portal)."""
    cart = carts_crud.get_or_create(
        db,
        human_id=current_human.id,
        popup_id=popup_id,
        tenant_id=current_human.tenant_id,
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
) -> None:
    """Clear cart for current human and popup (Portal)."""
    carts_crud.delete_by_human_popup(
        db,
        human_id=current_human.id,
        popup_id=popup_id,
    )
    db.commit()
