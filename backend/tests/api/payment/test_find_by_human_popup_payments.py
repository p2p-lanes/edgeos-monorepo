"""Tests for PaymentsCRUD.find_by_human_popup — CAP-D CRUD layer.

TDD phase: RED — tests written BEFORE the implementation.
The method does not exist yet, so all tests must FAIL.

Scenarios covered:
1. Empty result when human has no payments for popup
2. Application-linked payments returned (application.human_id match)
3. Direct-sale payments returned (payment.products_snapshot.attendee.human_id match)
4. Both legs combined, no duplicates
5. Pagination: skip + limit respected, total counts all payments
6. Cross-popup isolation
7. Cross-human isolation
"""

import uuid
from decimal import Decimal

from sqlmodel import Session

from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(db: Session, tenant: Tenants, *, suffix: str) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"CAP-D Popup {suffix}",
        slug=f"capd-popup-{suffix}-{uuid.uuid4().hex[:6]}",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"capd-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.flush()
    return human


def _make_app_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
) -> Payments:
    """Create a payment via an application (application.human_id == human.id)."""
    from app.api.application.models import Applications
    from app.api.application.schemas import ApplicationStatus

    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.flush()

    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        status=PaymentStatus.APPROVED.value,
        amount=Decimal("100"),
        currency="USD",
    )
    db.add(payment)
    db.flush()
    return payment


def _make_product(db: Session, tenant: Tenants, popup: Popups, *, suffix: str):
    """Create a minimal product for use in PaymentProducts snapshots."""
    from app.api.product.models import Products

    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Test Product {suffix}",
        slug=f"test-product-{suffix}-{uuid.uuid4().hex[:6]}",
        price=Decimal("50"),
        category="standard",
    )
    db.add(product)
    db.flush()
    return product


def _make_direct_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
) -> Payments:
    """Create a direct-sale payment (no application).

    Ownership is resolved via payment_products.attendee.human_id == human.id.
    """
    # Create direct-sale attendee
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=None,
        popup_id=popup.id,
        human_id=human.id,
        name="Direct Sale Buyer",
        category="main",
        check_in_code=f"D{uuid.uuid4().hex[:5].upper()}",
    )
    db.add(attendee)
    db.flush()

    # Create payment with no application
    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=None,
        popup_id=popup.id,
        status=PaymentStatus.APPROVED.value,
        amount=Decimal("50"),
        currency="USD",
    )
    db.add(payment)
    db.flush()

    # Create a real product for the FK to be satisfied
    product = _make_product(db, tenant, popup, suffix="direct-pay")

    # Create payment product snapshot linking payment → attendee (the ownership proof)
    pp = PaymentProducts(
        tenant_id=tenant.id,
        payment_id=payment.id,
        product_id=product.id,
        attendee_id=attendee.id,
        quantity=1,
        product_name="Direct Product",
        product_price=Decimal("50"),
        product_category="standard",
        product_currency="USD",
    )
    db.add(pp)
    db.flush()
    return payment


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestFindByHumanPopupPayments:
    """Unit tests for PaymentsCRUD.find_by_human_popup."""

    def test_empty_when_no_payments(self, db: Session, tenant_a: Tenants) -> None:
        """Human with no payments for popup returns empty list, total=0."""
        popup = _make_popup(db, tenant_a, suffix="empty")
        human = _make_human(db, tenant_a, suffix="empty")
        db.commit()

        results, total = payments_crud.find_by_human_popup(db, human.id, popup.id)

        assert results == []
        assert total == 0

    def test_application_linked_payment_returned(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Application-linked payments are returned."""
        popup = _make_popup(db, tenant_a, suffix="app-pay")
        human = _make_human(db, tenant_a, suffix="app-pay")
        payment = _make_app_payment(db, tenant_a, popup, human)
        db.commit()

        results, total = payments_crud.find_by_human_popup(db, human.id, popup.id)

        assert total == 1
        assert len(results) == 1
        assert results[0].id == payment.id

    def test_direct_sale_payment_returned(self, db: Session, tenant_a: Tenants) -> None:
        """Direct-sale payments are returned via attendee.human_id match."""
        popup = _make_popup(db, tenant_a, suffix="direct-pay")
        human = _make_human(db, tenant_a, suffix="direct-pay")
        payment = _make_direct_payment(db, tenant_a, popup, human)
        db.commit()

        results, total = payments_crud.find_by_human_popup(db, human.id, popup.id)

        assert total == 1
        assert len(results) == 1
        assert results[0].id == payment.id

    def test_both_legs_no_duplicates(self, db: Session, tenant_a: Tenants) -> None:
        """Both application-linked AND direct-sale payments, no duplicates."""
        popup = _make_popup(db, tenant_a, suffix="both-pay")
        human = _make_human(db, tenant_a, suffix="both-pay")
        app_payment = _make_app_payment(db, tenant_a, popup, human)
        direct_payment = _make_direct_payment(db, tenant_a, popup, human)
        db.commit()

        results, total = payments_crud.find_by_human_popup(db, human.id, popup.id)

        assert total == 2
        ids = {r.id for r in results}
        assert app_payment.id in ids
        assert direct_payment.id in ids

    def test_pagination_respected(self, db: Session, tenant_a: Tenants) -> None:
        """Pagination: skip=1, limit=1 returns 1 row and total=2.

        Uses one application-linked payment and one direct-sale payment so
        both are in the same popup without triggering the uq_application_human_popup
        unique constraint (which only applies to Applications, one per human per popup).
        """
        popup = _make_popup(db, tenant_a, suffix="paged-pay")
        human = _make_human(db, tenant_a, suffix="paged-pay")
        _make_app_payment(db, tenant_a, popup, human)
        _make_direct_payment(db, tenant_a, popup, human)
        db.commit()

        results, total = payments_crud.find_by_human_popup(
            db, human.id, popup.id, skip=1, limit=1
        )

        assert total == 2
        assert len(results) == 1

    def test_cross_popup_isolation(self, db: Session, tenant_a: Tenants) -> None:
        """Only payments for popup A returned when querying popup A."""
        popup_a = _make_popup(db, tenant_a, suffix="iso-pa")
        popup_b = _make_popup(db, tenant_a, suffix="iso-pb")
        human = _make_human(db, tenant_a, suffix="iso-pay")
        payment_a = _make_app_payment(db, tenant_a, popup_a, human)
        _make_app_payment(db, tenant_a, popup_b, human)
        db.commit()

        results, total = payments_crud.find_by_human_popup(db, human.id, popup_a.id)

        assert total == 1
        assert results[0].id == payment_a.id

    def test_cross_human_isolation(self, db: Session, tenant_a: Tenants) -> None:
        """Only human A's payments returned when querying for human A."""
        popup = _make_popup(db, tenant_a, suffix="iso-hpay")
        human_a = _make_human(db, tenant_a, suffix="iso-ha-pay")
        human_b = _make_human(db, tenant_a, suffix="iso-hb-pay")
        payment_a = _make_app_payment(db, tenant_a, popup, human_a)
        _make_app_payment(db, tenant_a, popup, human_b)
        db.commit()

        results, total = payments_crud.find_by_human_popup(db, human_a.id, popup.id)

        assert total == 1
        assert results[0].id == payment_a.id
