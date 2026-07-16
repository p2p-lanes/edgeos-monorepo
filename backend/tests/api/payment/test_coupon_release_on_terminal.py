"""Integration tests — coupon release on terminal payment status transitions.

Covers CouponsCRUD.release_use wired into PaymentsCRUD.update_status:
  1. PENDING + coupon → EXPIRED decrements current_uses by 1
  2. PENDING + coupon → CANCELLED decrements current_uses by 1
  3. PENDING + coupon → REJECTED decrements current_uses by 1
  4. PENDING + coupon → APPROVED does NOT change current_uses
  5. Idempotency: PENDING→EXPIRED (uses decremented), then EXPIRED→EXPIRED (no further decrement)
  6. PENDING payment with NO coupon → EXPIRED without error, no coupon touched

All tests operate directly against the CRUD layer against a real PostgreSQL
container (testcontainers), exactly like test_stock_restoration.py.
"""

import uuid
from decimal import Decimal

from sqlmodel import Session

from app.api.coupon.models import Coupons
from app.api.payment.crud import payments_crud
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

INITIAL_USES = 2
MAX_USES = 5


def _make_direct_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Coupon Release Popup {uuid.uuid4().hex[:6]}",
        slug=f"cpn-rel-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.direct.value,
        status="active",
        currency="ARS",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_coupon(
    db: Session,
    popup: Popups,
    *,
    current_uses: int = INITIAL_USES,
    max_uses: int = MAX_USES,
) -> Coupons:
    coupon = Coupons(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        code=f"TEST{uuid.uuid4().hex[:6].upper()}",
        discount_value=10,
        is_active=True,
        current_uses=current_uses,
        max_uses=max_uses,
    )
    db.add(coupon)
    db.flush()
    return coupon


def _make_pending_payment_with_coupon(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    coupon: Coupons | None,
) -> Payments:
    """Create a minimal PENDING payment, optionally linked to a coupon.

    products_snapshot is intentionally empty — _restore_payment_stock returns
    early when products_snapshot is empty, so stock never interferes with the
    coupon-only assertion.
    """
    from app.api.application.models import Applications
    from app.api.application.schemas import ApplicationStatus
    from app.api.attendee.models import Attendees
    from app.api.human.models import Humans

    suffix = uuid.uuid4().hex[:8]

    human = Humans(
        tenant_id=tenant.id,
        email=f"cpn-rel-{suffix}@test.com",
        first_name="Coupon",
        last_name="Test",
    )
    db.add(human)
    db.flush()

    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.flush()

    attendee = Attendees(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        name="Coupon Attendee",
        category="main",
        email=f"att-cpn-{suffix}@test.com",
    )
    db.add(attendee)
    db.flush()

    payment = Payments(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        status=PaymentStatus.PENDING.value,
        amount=Decimal("90"),
        currency="ARS",
        external_id=f"sf-cpn-{suffix}",
        coupon_id=coupon.id if coupon else None,
        coupon_code=coupon.code if coupon else None,
        discount_value=Decimal("10") if coupon else None,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def _fresh_coupon_uses(db: Session, coupon_id: uuid.UUID) -> int:
    """Force-refresh the coupon and return its current_uses."""
    db.expire_all()
    coupon = db.get(Coupons, coupon_id)
    assert coupon is not None
    return coupon.current_uses


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestCouponReleaseOnTerminalStatus:
    """PaymentsCRUD.update_status releases coupon use for non-approved terminals."""

    def test_pending_to_expired_decrements_uses(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """PENDING + coupon → EXPIRED: current_uses decremented by 1."""
        popup = _make_direct_popup(db, tenant_a)
        coupon = _make_coupon(db, popup)
        payment = _make_pending_payment_with_coupon(db, tenant_a, popup, coupon)

        coupon_id = coupon.id
        uses_before = _fresh_coupon_uses(db, coupon_id)
        assert uses_before == INITIAL_USES

        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)

        assert _fresh_coupon_uses(db, coupon_id) == INITIAL_USES - 1

    def test_pending_to_cancelled_decrements_uses(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """PENDING + coupon → CANCELLED: current_uses decremented by 1."""
        popup = _make_direct_popup(db, tenant_a)
        coupon = _make_coupon(db, popup)
        payment = _make_pending_payment_with_coupon(db, tenant_a, popup, coupon)

        coupon_id = coupon.id
        assert _fresh_coupon_uses(db, coupon_id) == INITIAL_USES

        payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)

        assert _fresh_coupon_uses(db, coupon_id) == INITIAL_USES - 1

    def test_pending_to_rejected_decrements_uses(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """PENDING + coupon → REJECTED: current_uses decremented by 1."""
        popup = _make_direct_popup(db, tenant_a)
        coupon = _make_coupon(db, popup)
        payment = _make_pending_payment_with_coupon(db, tenant_a, popup, coupon)

        coupon_id = coupon.id
        assert _fresh_coupon_uses(db, coupon_id) == INITIAL_USES

        payments_crud.update_status(db, payment.id, PaymentStatus.REJECTED)

        assert _fresh_coupon_uses(db, coupon_id) == INITIAL_USES - 1

    def test_pending_to_approved_does_not_change_uses(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """PENDING + coupon → APPROVED: current_uses NOT changed (paid use stays consumed)."""
        popup = _make_direct_popup(db, tenant_a)
        coupon = _make_coupon(db, popup)
        payment = _make_pending_payment_with_coupon(db, tenant_a, popup, coupon)

        coupon_id = coupon.id
        assert _fresh_coupon_uses(db, coupon_id) == INITIAL_USES

        payments_crud.update_status(db, payment.id, PaymentStatus.APPROVED)

        assert _fresh_coupon_uses(db, coupon_id) == INITIAL_USES

    def test_idempotency_second_terminal_does_not_decrement_further(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """PENDING→EXPIRED releases once; EXPIRED→EXPIRED must NOT release again.

        The PENDING-only guard in update_status is what prevents the double-release.
        After the first transition old_status is no longer PENDING, so the release
        branch is skipped entirely on the second call.
        """
        popup = _make_direct_popup(db, tenant_a)
        coupon = _make_coupon(db, popup)
        payment = _make_pending_payment_with_coupon(db, tenant_a, popup, coupon)

        coupon_id = coupon.id
        assert _fresh_coupon_uses(db, coupon_id) == INITIAL_USES

        # First transition: PENDING → EXPIRED — decrements
        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)
        uses_after_first = _fresh_coupon_uses(db, coupon_id)
        assert uses_after_first == INITIAL_USES - 1

        # Second call: EXPIRED → EXPIRED — must be no-op for coupon
        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)
        uses_after_second = _fresh_coupon_uses(db, coupon_id)
        assert uses_after_second == uses_after_first, (
            f"Second terminal transition must not decrement coupon again. "
            f"Expected {uses_after_first}, got {uses_after_second}."
        )

    def test_pending_no_coupon_expires_without_error(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """PENDING payment with NO coupon → EXPIRED: no error, payment status updated."""
        popup = _make_direct_popup(db, tenant_a)
        payment = _make_pending_payment_with_coupon(db, tenant_a, popup, coupon=None)

        assert payment.coupon_id is None

        # Must not raise; coupon path is skipped entirely
        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)

        db.expire_all()
        refreshed = db.get(Payments, payment.id)
        assert refreshed is not None
        assert refreshed.status == PaymentStatus.EXPIRED.value
