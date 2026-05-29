"""Tests for AttendeesCRUD.find_by_popup has_tickets filter.

has_tickets keeps only attendees with at least one AttendeeProducts row when
True, only those without when False, and disables the filter when None. The
filter must not multiply rows (correlated EXISTS) nor break the total count.

Each test creates a fresh popup so it is isolated from the session-scoped
shared fixtures (db / popup_tenant_a have no per-test rollback).
"""

import uuid
from decimal import Decimal

from sqlmodel import Session

from app.api.attendee.crud import attendees_crud
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name="HasTickets Popup",
        slug=f"has-tickets-popup-{uuid.uuid4().hex[:8]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_attendee(
    db: Session, tenant: Tenants, popup: Popups, *, name: str
) -> Attendees:
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=name,
        category="main",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _make_product(db: Session, tenant: Tenants, popup: Popups) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"HasTickets Product {uuid.uuid4().hex[:6]}",
        slug=f"has-tickets-prod-{uuid.uuid4().hex[:6]}",
        price=Decimal("10"),
        category="ticket",
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _give_ticket(
    db: Session, tenant: Tenants, attendee: Attendees, product: Products
) -> AttendeeProducts:
    ticket = AttendeeProducts(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        attendee_id=attendee.id,
        product_id=product.id,
        check_in_code=f"HT{uuid.uuid4().hex[:6].upper()}",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


class TestFindByPopupHasTickets:
    def test_none_returns_all(self, db: Session, tenant_a: Tenants) -> None:
        popup = _make_popup(db, tenant_a)
        product = _make_product(db, tenant_a, popup)
        with_ticket = _make_attendee(db, tenant_a, popup, name="With")
        _give_ticket(db, tenant_a, with_ticket, product)
        _make_attendee(db, tenant_a, popup, name="Without")

        results, total = attendees_crud.find_by_popup(db, popup_id=popup.id)

        assert total == 2
        assert len(results) == 2

    def test_true_returns_only_attendees_with_tickets(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        product = _make_product(db, tenant_a, popup)
        with_ticket = _make_attendee(db, tenant_a, popup, name="With")
        _give_ticket(db, tenant_a, with_ticket, product)
        _make_attendee(db, tenant_a, popup, name="Without")

        results, total = attendees_crud.find_by_popup(
            db, popup_id=popup.id, has_tickets=True
        )

        assert total == 1
        assert [r.id for r in results] == [with_ticket.id]

    def test_true_does_not_multiply_rows_for_multiple_tickets(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """An attendee with several tickets must appear exactly once."""
        popup = _make_popup(db, tenant_a)
        product = _make_product(db, tenant_a, popup)
        with_ticket = _make_attendee(db, tenant_a, popup, name="Multi")
        _give_ticket(db, tenant_a, with_ticket, product)
        _give_ticket(db, tenant_a, with_ticket, product)
        _give_ticket(db, tenant_a, with_ticket, product)

        results, total = attendees_crud.find_by_popup(
            db, popup_id=popup.id, has_tickets=True
        )

        assert total == 1
        assert len(results) == 1

    def test_false_returns_only_attendees_without_tickets(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        product = _make_product(db, tenant_a, popup)
        with_ticket = _make_attendee(db, tenant_a, popup, name="With")
        _give_ticket(db, tenant_a, with_ticket, product)
        without = _make_attendee(db, tenant_a, popup, name="Without")

        results, total = attendees_crud.find_by_popup(
            db, popup_id=popup.id, has_tickets=False
        )

        assert total == 1
        assert [r.id for r in results] == [without.id]
