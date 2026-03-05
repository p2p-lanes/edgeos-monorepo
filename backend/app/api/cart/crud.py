import uuid

from sqlalchemy.orm import selectinload
from sqlmodel import Session, func, select

from app.api.cart.models import Carts
from app.api.cart.schemas import CartState


class CartsCRUD:
    """CRUD operations for Carts."""

    def find_all(
        self,
        session: Session,
        popup_id: uuid.UUID | None = None,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Carts], int]:
        """List all carts (abandoned) with eager loaded relationships."""
        statement = select(Carts).options(
            selectinload(Carts.human),  # type: ignore[arg-type]
            selectinload(Carts.popup),  # type: ignore[arg-type]
        )

        if popup_id:
            statement = statement.where(Carts.popup_id == popup_id)

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.order_by(Carts.updated_at.desc())  # type: ignore[union-attr]
        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

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
