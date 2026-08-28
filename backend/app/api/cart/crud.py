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

    def find_by_human_popup_flow(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
        sales_flow_id: uuid.UUID,
    ) -> Carts | None:
        return session.exec(
            select(Carts).where(
                Carts.human_id == human_id,
                Carts.popup_id == popup_id,
                Carts.sales_flow_id == sales_flow_id,
            )
        ).first()

    def get_or_create(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
        tenant_id: uuid.UUID,
        sales_flow_id: uuid.UUID | None = None,
    ) -> Carts:
        """Get existing cart or create a new empty one."""
        cart = (
            self.find_by_human_popup_flow(session, human_id, popup_id, sales_flow_id)
            if sales_flow_id
            else self.find_by_human_popup(session, human_id, popup_id)
        )

        if cart and sales_flow_id:
            legacy = session.exec(
                select(Carts).where(
                    Carts.human_id == human_id,
                    Carts.popup_id == popup_id,
                    Carts.sales_flow_id.is_(None),  # type: ignore[union-attr]
                )
            ).first()
            if legacy:
                session.delete(legacy)
                session.commit()
            return cart
        if cart:
            return cart

        if sales_flow_id:
            from app.api.sales_flow.crud import sales_flows_crud

            default = sales_flows_crud.get_default_flow(session, popup_id)
            legacy = session.exec(
                select(Carts).where(
                    Carts.human_id == human_id,
                    Carts.popup_id == popup_id,
                    Carts.sales_flow_id.is_(None),  # type: ignore[union-attr]
                )
            ).first()
            if legacy and default is not None and default.id == sales_flow_id:
                legacy.sales_flow_id = sales_flow_id
                session.add(legacy)
                session.commit()
                return legacy

        cart = Carts(
            tenant_id=tenant_id,
            human_id=human_id,
            popup_id=popup_id,
            sales_flow_id=sales_flow_id,
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
        cart.items = items.model_dump(mode="json")
        cart.updated_at = datetime.now(UTC)
        session.add(cart)
        session.commit()
        return cart

    def delete_by_human_popup(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
        sales_flow_id: uuid.UUID,
    ) -> None:
        """Delete a cart for one human, popup, and sales flow."""
        statement = select(Carts).where(
            Carts.human_id == human_id,
            Carts.popup_id == popup_id,
            Carts.sales_flow_id == sales_flow_id,
        )
        cart = session.exec(statement).first()
        if cart:
            session.delete(cart)
            session.flush()

    # ------------------------------------------------------------------
    # Open-checkout carts. Keyed by human (resolved from the buyer email) just
    # like authenticated portal carts, so a buyer has one cart per popup and flow.
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
        sales_flow_id: uuid.UUID | None = None,
    ) -> Carts:
        """Create or update the open-checkout cart for (human, popup).

        Shares the human/popup/flow key with the authenticated portal cart. Email
        is stored for display and restore-link continuity only, not as a key.
        """
        cart = self.get_or_create(
            session,
            human_id=human_id,
            popup_id=popup_id,
            tenant_id=tenant_id,
            sales_flow_id=sales_flow_id,
        )
        cart.email = email.lower()
        return self.update_items(session, cart, items)

    def find_by_id_popup(
        self,
        session: Session,
        cart_id: uuid.UUID,
        popup_id: uuid.UUID,
        sales_flow_id: uuid.UUID | None = None,
    ) -> Carts | None:
        """Find a cart by id, scoped to a popup (read-only).

        Backs the open-checkout restore link and cart-continuity proof.
        """
        statement = select(Carts).where(
            Carts.id == cart_id,
            Carts.popup_id == popup_id,
        )
        if sales_flow_id is not None:
            statement = statement.where(Carts.sales_flow_id == sales_flow_id)
        return session.exec(statement).first()


carts_crud = CartsCRUD()
