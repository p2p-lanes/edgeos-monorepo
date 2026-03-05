import uuid

from fastapi import APIRouter, status

from app.api.cart.crud import carts_crud
from app.api.cart.schemas import CartPublic, CartState, CartUpdate
from app.core.dependencies.users import CurrentHuman, HumanTenantSession

router = APIRouter(prefix="/carts", tags=["carts"])



@router.get("/my/{popup_id}", response_model=CartPublic)
async def get_my_cart(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> CartPublic:
    """Get or create cart for current human and popup (Portal)."""
    cart = carts_crud.get_or_create(
        db,
        human_id=current_human.id,
        popup_id=popup_id,
        tenant_id=current_human.tenant_id,
    )

    # Parse items from JSONB into CartState
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
