import uuid

from sqlmodel import Session, select

from app.api.cart.models import Carts
from app.api.cart.schemas import CartState


class CartsCRUD:
    """CRUD operations for Carts."""

    def get_or_create(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
        tenant_id: uuid.UUID,
    ) -> Carts:
        """Get existing cart or create a new empty one."""
        statement = select(Carts).where(
            Carts.human_id == human_id,
            Carts.popup_id == popup_id,
        )
        cart = session.exec(statement).first()

        if cart:
            return cart

        cart = Carts(
            tenant_id=tenant_id,
            human_id=human_id,
            popup_id=popup_id,
            items={},
        )
        session.add(cart)
        session.commit()
        session.refresh(cart)
        return cart

    def update_items(
        self,
        session: Session,
        cart: Carts,
        items: CartState,
    ) -> Carts:
        """Replace cart items."""
        cart.items = items.model_dump()
        session.add(cart)
        session.commit()
        session.refresh(cart)
        return cart

    def delete_by_human_popup(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
    ) -> None:
        """Delete cart for a specific human and popup."""
        statement = select(Carts).where(
            Carts.human_id == human_id,
            Carts.popup_id == popup_id,
        )
        cart = session.exec(statement).first()
        if cart:
            session.delete(cart)
            session.flush()


carts_crud = CartsCRUD()
