import uuid
from datetime import UTC, datetime

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

    def find_by_human_popup(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
    ) -> Carts | None:
        """Find cart by human and popup (read-only, no creation)."""
        statement = select(Carts).where(
            Carts.human_id == human_id,
            Carts.popup_id == popup_id,
        )
        return session.exec(statement).first()

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
        """Replace cart items.

        Sets updated_at client-side instead of reloading from the DB after
        commit: the committed row is authoritative and a post-commit reload
        races with concurrent deletes (DELETE /my/{popup_id}, checkout cleanup),
        which under RLS surfaces as "Could not refresh instance".
        """
        cart.items = items.model_dump()
        cart.updated_at = datetime.now(UTC)
        session.add(cart)
        session.commit()
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

    # ------------------------------------------------------------------
    # Open-checkout carts. Keyed by human (resolved from the buyer email) just
    # like authenticated portal carts, so a buyer has a single cart per popup
    # across both flows.
    # ------------------------------------------------------------------

    def upsert_open_cart(
        self,
        session: Session,
        *,
        tenant_id: uuid.UUID,
        popup_id: uuid.UUID,
        human_id: uuid.UUID,
        email: str,
        items: CartState,
    ) -> Carts:
        """Create or update the open-checkout cart for (human, popup).

        Shares the uq_cart_human_popup key with the authenticated portal cart,
        so the two flows converge on one row. Email is stored for display and
        restore-link continuity only, not as a key.
        """
        cart = self.find_by_human_popup(session, human_id, popup_id)
        if cart is None:
            cart = Carts(
                tenant_id=tenant_id,
                human_id=human_id,
                popup_id=popup_id,
                email=email.lower(),
                items=items.model_dump(),
            )
            session.add(cart)
            session.commit()
            session.refresh(cart)
            return cart

        cart.items = items.model_dump()
        cart.email = email.lower()
        cart.updated_at = datetime.now(UTC)
        session.add(cart)
        session.commit()
        session.refresh(cart)
        return cart

    def find_by_id_popup(
        self,
        session: Session,
        cart_id: uuid.UUID,
        popup_id: uuid.UUID,
    ) -> Carts | None:
        """Find a cart by id, scoped to a popup (read-only).

        Backs the open-checkout restore link and cart-continuity proof.
        """
        statement = select(Carts).where(
            Carts.id == cart_id,
            Carts.popup_id == popup_id,
        )
        return session.exec(statement).first()


carts_crud = CartsCRUD()
