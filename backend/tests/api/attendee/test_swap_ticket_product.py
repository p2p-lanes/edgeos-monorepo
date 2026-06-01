"""Tests for the admin attendee product-management CRUD methods.

Covers swap_ticket_product (change a ticket's product, no payment) and
remove_product (delete a ticket and restore its stock). Both operate on the
ticket layer plus inventory; the payment_products financial snapshot is left
untouched on purpose.
"""

import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.attendee import crud as attendee_crud
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_product(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    stock: int | None = None,
) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Swap Product {uuid.uuid4().hex[:6]}",
        slug=f"swap-prod-{uuid.uuid4().hex[:6]}",
        price=Decimal("10"),
        category="ticket",
        total_stock_cap=stock,
        total_stock_remaining=stock,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_attendee(db: Session, tenant: Tenants, popup: Popups) -> Attendees:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"swap-ticket-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Swap",
        last_name="Ticket",
    )
    db.add(human)
    db.commit()
    db.refresh(human)

    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        name="Swap Ticket Test",
        category="main",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _make_ticket(
    db: Session,
    tenant: Tenants,
    attendee: Attendees,
    product: Products,
) -> AttendeeProducts:
    ticket = AttendeeProducts(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        attendee_id=attendee.id,
        product_id=product.id,
        check_in_code=f"SW{uuid.uuid4().hex[:6].upper()}",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


# ---------------------------------------------------------------------------
# swap_ticket_product
# ---------------------------------------------------------------------------


class TestSwapTicketProduct:
    def test_swap_changes_product_and_keeps_check_in_code(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        old_product = _make_product(db, tenant_a, popup_tenant_a)
        new_product = _make_product(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, old_product)
        original_code = ticket.check_in_code

        updated = attendee_crud.attendees_crud.swap_ticket_product(
            db,
            attendee_id=attendee.id,
            ticket_id=ticket.id,
            new_product_id=new_product.id,
        )

        assert updated.product_id == new_product.id
        assert updated.check_in_code == original_code

    def test_swap_restores_old_and_decrements_new_stock(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        old_product = _make_product(db, tenant_a, popup_tenant_a, stock=5)
        new_product = _make_product(db, tenant_a, popup_tenant_a, stock=5)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        # Simulate the ticket having consumed one unit of the old product.
        old_product.total_stock_remaining = 4
        db.add(old_product)
        db.commit()
        ticket = _make_ticket(db, tenant_a, attendee, old_product)

        attendee_crud.attendees_crud.swap_ticket_product(
            db,
            attendee_id=attendee.id,
            ticket_id=ticket.id,
            new_product_id=new_product.id,
        )

        db.refresh(old_product)
        db.refresh(new_product)
        assert old_product.total_stock_remaining == 5  # restored, clamped to cap
        assert new_product.total_stock_remaining == 4  # decremented

    def test_swap_same_product_is_noop(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        product = _make_product(db, tenant_a, popup_tenant_a, stock=5)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, product)

        attendee_crud.attendees_crud.swap_ticket_product(
            db,
            attendee_id=attendee.id,
            ticket_id=ticket.id,
            new_product_id=product.id,
        )

        db.refresh(product)
        assert product.total_stock_remaining == 5  # untouched

    def test_swap_sold_out_new_product_raises_409(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        old_product = _make_product(db, tenant_a, popup_tenant_a, stock=5)
        new_product = _make_product(db, tenant_a, popup_tenant_a, stock=0)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, old_product)

        with pytest.raises(HTTPException) as exc:
            attendee_crud.attendees_crud.swap_ticket_product(
                db,
                attendee_id=attendee.id,
                ticket_id=ticket.id,
                new_product_id=new_product.id,
            )
        assert exc.value.status_code == 409
        # Old product stock must not have been restored on the aborted swap.
        db.refresh(old_product)
        assert old_product.total_stock_remaining == 5
        db.refresh(ticket)
        assert ticket.product_id == old_product.id

    def test_swap_ticket_not_owned_raises_404(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        product = _make_product(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        other_attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, product)
        new_product = _make_product(db, tenant_a, popup_tenant_a)

        with pytest.raises(HTTPException) as exc:
            attendee_crud.attendees_crud.swap_ticket_product(
                db,
                attendee_id=other_attendee.id,
                ticket_id=ticket.id,
                new_product_id=new_product.id,
            )
        assert exc.value.status_code == 404

    def test_swap_cross_popup_raises_422(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        popup_tenant_a_summer_fest: Popups,
    ) -> None:
        old_product = _make_product(db, tenant_a, popup_tenant_a)
        foreign_product = _make_product(db, tenant_a, popup_tenant_a_summer_fest)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, old_product)

        with pytest.raises(HTTPException) as exc:
            attendee_crud.attendees_crud.swap_ticket_product(
                db,
                attendee_id=attendee.id,
                ticket_id=ticket.id,
                new_product_id=foreign_product.id,
            )
        assert exc.value.status_code == 422


# ---------------------------------------------------------------------------
# remove_product
# ---------------------------------------------------------------------------


class TestRemoveProduct:
    def test_remove_deletes_ticket_and_restores_stock(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        product = _make_product(db, tenant_a, popup_tenant_a, stock=5)
        product.total_stock_remaining = 4  # one unit consumed by the ticket
        db.add(product)
        db.commit()
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, product)

        attendee_crud.attendees_crud.remove_product(
            db,
            attendee_id=attendee.id,
            ticket_id=ticket.id,
        )

        assert db.get(AttendeeProducts, ticket.id) is None
        db.refresh(product)
        assert product.total_stock_remaining == 5

    def test_remove_ticket_not_owned_raises_404(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        product = _make_product(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        other_attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, product)

        with pytest.raises(HTTPException) as exc:
            attendee_crud.attendees_crud.remove_product(
                db,
                attendee_id=other_attendee.id,
                ticket_id=ticket.id,
            )
        assert exc.value.status_code == 404
        # Ticket must survive the rejected removal.
        assert db.get(AttendeeProducts, ticket.id) is not None
