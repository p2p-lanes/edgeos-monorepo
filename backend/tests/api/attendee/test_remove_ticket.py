"""Tests for remove_ticket(session, ticket_id) refactor.

TDD phase: RED — tests written BEFORE the implementation.
Design §2.4: remove_product must be refactored to remove_ticket(session, ticket_id: uuid.UUID)
to delete a single AttendeeProducts row by its UUID PK.

Under always-insert semantics, each row is an independent ticket. Deleting by
(attendee_id, product_id) with .first() is semantically wrong — it picks an
arbitrary row when multiple tickets of the same product exist for one attendee.
"""

import uuid
from decimal import Decimal

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


def _make_product(db: Session, tenant: Tenants, popup: Popups) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Remove Ticket Product {uuid.uuid4().hex[:6]}",
        slug=f"remove-ticket-prod-{uuid.uuid4().hex[:6]}",
        price=Decimal("10"),
        category="ticket",
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_attendee(db: Session, tenant: Tenants, popup: Popups) -> Attendees:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"remove-ticket-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Remove",
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
        name="Remove Ticket Test",
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
        check_in_code=f"RT{uuid.uuid4().hex[:6].upper()}",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestRemoveTicket:
    """remove_ticket(session, ticket_id) must delete exactly that ticket row by PK."""

    def test_remove_ticket_deletes_correct_row(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Calling remove_ticket with a specific ticket_id removes only that row."""
        product = _make_product(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)

        # Create two tickets for the same attendee + product
        ticket_1 = _make_ticket(db, tenant_a, attendee, product)
        ticket_2 = _make_ticket(db, tenant_a, attendee, product)

        # Remove only ticket_1
        attendee_crud.attendees_crud.remove_ticket(db, ticket_1.id)

        # ticket_1 must be gone
        gone = db.get(AttendeeProducts, ticket_1.id)
        assert gone is None, f"ticket_1 ({ticket_1.id}) should have been deleted"

        # ticket_2 must survive
        remaining = db.get(AttendeeProducts, ticket_2.id)
        assert remaining is not None, f"ticket_2 ({ticket_2.id}) should still exist"

    def test_remove_ticket_nonexistent_is_noop(
        self,
        db: Session,
    ) -> None:
        """Calling remove_ticket with a non-existent id does nothing (no error)."""
        fake_id = uuid.uuid4()
        # Must not raise — deleting a non-existent ticket is a no-op
        attendee_crud.attendees_crud.remove_ticket(db, fake_id)

    def test_remove_ticket_method_accepts_uuid(self) -> None:
        """remove_ticket must accept a uuid.UUID as ticket_id, not (attendee_id, product_id)."""
        import inspect

        sig = inspect.signature(attendee_crud.attendees_crud.remove_ticket)
        params = list(sig.parameters.keys())
        # Expected: self, session, ticket_id
        assert "ticket_id" in params, (
            f"remove_ticket must have 'ticket_id' parameter, got: {params}"
        )
        assert "attendee_id" not in params, (
            "remove_ticket must NOT have 'attendee_id' — that's the old signature"
        )
        assert "product_id" not in params, (
            "remove_ticket must NOT have 'product_id' — that's the old signature"
        )
