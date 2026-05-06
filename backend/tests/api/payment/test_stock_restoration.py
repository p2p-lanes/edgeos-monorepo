"""Integration tests for stock restoration — product-inventory-redesign, Slice 3 / Phase 5.

TDD phase: RED — written BEFORE implementation.

Payload source decision (Task ZERO):
  Path (b) — SimpleFI's payment_request_expired event carries only payment_request.id
  (stored locally as Payments.external_id).  The handler looks up the local Payments
  row and reads per-product qty from payment.products_snapshot (PaymentProducts rows).
  No per-product data in the webhook payload itself.

Covers:
  5.1 _handle_payment_request_expired: total_stock + shared_stock restored;
       idempotency (double webhook); NULL-stock no-op; multi-product mixed types.
  5.3 update_status CANCELLED/REJECTED: same restoration matrix.
  Edge: payment with no products → no-op.
  Edge: payment already EXPIRED → restoration is no-op (idempotency).

Spec references:
  §Domain 3 "Webhook Handlers Restore Both Counters"
  §Domain 3 "Cancel restores both counters"
  §Domain 3 "Idempotent double-fire"
  §Domain 3 "Webhook for NULL-stock product is safe"
"""

import uuid
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.product.crud import _resolve_tier_group, products_crud, tier_groups_crud
from app.api.product.models import Products, TicketTierGroup, TicketTierPhase
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


# ---------------------------------------------------------------------------
# Fixtures / Helpers
# ---------------------------------------------------------------------------


def _make_product(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    total_stock_cap: int | None = 10,
    total_stock_remaining: int | None = 10,
) -> Products:
    suffix = uuid.uuid4().hex[:8]
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"restore-test-{suffix}",
        slug=f"restore-{suffix}",
        price=Decimal("50"),
        category="ticket",
        total_stock_cap=total_stock_cap,
        total_stock_remaining=total_stock_remaining,
        is_active=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_tier_group(
    db: Session,
    tenant: Tenants,
    *,
    shared_stock_cap: int | None = 20,
    shared_stock_remaining: int | None = 20,
) -> TicketTierGroup:
    suffix = uuid.uuid4().hex[:8]
    group = TicketTierGroup(
        tenant_id=tenant.id,
        name=f"restore-group-{suffix}",
        shared_stock_cap=shared_stock_cap,
        shared_stock_remaining=shared_stock_remaining,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


def _link_product_to_group(
    db: Session,
    product: Products,
    group: TicketTierGroup,
    order: int = 0,
) -> TicketTierPhase:
    phase = TicketTierPhase(
        group_id=group.id,
        product_id=product.id,
        order=order,
        label=f"Phase {order}",
    )
    db.add(phase)
    db.commit()
    db.refresh(phase)
    return phase


def _make_pending_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    product_qty_pairs: list[tuple[Products, int]],
    external_id: str | None = None,
) -> Payments:
    """Create a PENDING payment with PaymentProducts snapshot rows."""
    if external_id is None:
        external_id = f"sf-{uuid.uuid4().hex[:16]}"

    # We need a minimal attendee to satisfy the FK on PaymentProducts.
    from app.api.attendee.models import Attendees
    from app.api.human.models import Humans

    human = Humans(
        tenant_id=tenant.id,
        email=f"restore-human-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Restore",
        last_name="Test",
    )
    db.add(human)
    db.flush()

    from app.api.application.models import Applications
    from app.api.application.schemas import ApplicationStatus

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
        name="Restore Attendee",
        category="main",
        email=f"att-{uuid.uuid4().hex[:8]}@test.com",
        check_in_code=f"R{uuid.uuid4().hex[:4].upper()}",
    )
    db.add(attendee)
    db.flush()

    payment = Payments(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        status=PaymentStatus.PENDING.value,
        amount=Decimal("50"),
        currency="ARS",
        external_id=external_id,
    )
    db.add(payment)
    db.flush()

    for product, qty in product_qty_pairs:
        pp = PaymentProducts(
            tenant_id=tenant.id,
            payment_id=payment.id,
            product_id=product.id,
            attendee_id=attendee.id,
            quantity=qty,
            product_name=product.name,
            product_description=None,
            product_price=product.price,
            product_category=product.category or "ticket",
            product_currency="ARS",
        )
        db.add(pp)

    db.commit()
    db.refresh(payment)
    return payment


# ---------------------------------------------------------------------------
# Helpers: decrement to simulate eager-decrement at purchase time
# ---------------------------------------------------------------------------


def _decrement(db: Session, product: Products, qty: int) -> None:
    """Simulate the eager-decrement that happens at purchase time."""
    products_crud.decrement_total_stock(db, product.id, qty)
    db.commit()


def _decrement_group(db: Session, group: TicketTierGroup, qty: int) -> None:
    """Simulate the shared-tier decrement that happens at purchase time."""
    tier_groups_crud.decrement_shared_stock(db, group.id, qty)
    db.commit()


# ---------------------------------------------------------------------------
# 5.1 — _handle_payment_request_expired restoration
# ---------------------------------------------------------------------------


class TestHandlePaymentRequestExpiredRestoration:
    """Spec §Domain 3 — _handle_payment_request_expired restores both counters."""

    def test_standalone_product_total_stock_restored(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Expired payment → total_stock_remaining restored to pre-payment value."""
        product = _make_product(db, tenant_a, popup_tenant_a, total_stock_cap=10, total_stock_remaining=10)
        _decrement(db, product, 3)  # simulates purchase: remaining=7

        payment = _make_pending_payment(db, tenant_a, popup_tenant_a, [(product, 3)])

        # Expire via update_status (simulating what the webhook handler does internally
        # after we wire restoration — for now just assert restoration method exists
        # and works when called directly).
        # This test will FAIL until _handle_payment_request_expired is wired.
        # We test the route that the handler ultimately calls.
        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)

        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining == 10, (
            f"Expected remaining=10 after expiry, got {refreshed.total_stock_remaining}. "
            "update_status EXPIRED path must restore total_stock."
        )

    def test_tier_grouped_product_both_counters_restored(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Tier-grouped product: BOTH total_stock_remaining AND shared_stock_remaining restored."""
        group = _make_tier_group(db, tenant_a, shared_stock_cap=20, shared_stock_remaining=20)
        product = _make_product(db, tenant_a, popup_tenant_a, total_stock_cap=None, total_stock_remaining=None)
        _link_product_to_group(db, product, group)

        _decrement_group(db, group, 2)  # simulates purchase: group remaining=18

        payment = _make_pending_payment(db, tenant_a, popup_tenant_a, [(product, 2)])

        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)

        db.expire_all()
        refreshed_group = db.get(TicketTierGroup, group.id)
        assert refreshed_group.shared_stock_remaining == 20, (
            f"Expected group remaining=20 after expiry, got {refreshed_group.shared_stock_remaining}. "
            "update_status EXPIRED path must restore shared_stock."
        )

    def test_multi_product_mixed_types_all_restored(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Multi-product payment with mixed types → all counters restored."""
        # Standalone product
        p1 = _make_product(db, tenant_a, popup_tenant_a, total_stock_cap=10, total_stock_remaining=10)
        # Tier-grouped product (NULL individual cap)
        group = _make_tier_group(db, tenant_a, shared_stock_cap=15, shared_stock_remaining=15)
        p2 = _make_product(db, tenant_a, popup_tenant_a, total_stock_cap=None, total_stock_remaining=None)
        _link_product_to_group(db, p2, group, order=0)

        _decrement(db, p1, 2)        # p1: remaining=8
        _decrement_group(db, group, 3)  # group: remaining=12

        payment = _make_pending_payment(db, tenant_a, popup_tenant_a, [(p1, 2), (p2, 3)])

        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)

        db.expire_all()
        rp1 = db.get(Products, p1.id)
        rgroup = db.get(TicketTierGroup, group.id)
        assert rp1.total_stock_remaining == 10, (
            f"p1: expected remaining=10, got {rp1.total_stock_remaining}"
        )
        assert rgroup.shared_stock_remaining == 15, (
            f"group: expected remaining=15, got {rgroup.shared_stock_remaining}"
        )

    def test_null_stock_product_no_error(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """NULL-stock (unlimited) product in payment → handler completes without error."""
        product = _make_product(db, tenant_a, popup_tenant_a, total_stock_cap=None, total_stock_remaining=None)
        payment = _make_pending_payment(db, tenant_a, popup_tenant_a, [(product, 5)])

        # Should not raise; NULL counters are no-op
        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)

        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining is None

    def test_idempotency_double_expire_does_not_exceed_cap(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Double expiry (webhook fires twice): stock does not exceed cap."""
        product = _make_product(db, tenant_a, popup_tenant_a, total_stock_cap=5, total_stock_remaining=5)
        _decrement(db, product, 2)  # remaining=3

        payment = _make_pending_payment(db, tenant_a, popup_tenant_a, [(product, 2)])

        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)
        # Second call: payment is already EXPIRED → restoration must be a no-op
        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)

        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining <= 5, (
            f"Stock must not exceed cap=5, got {refreshed.total_stock_remaining}"
        )
        assert refreshed.total_stock_remaining == 5, (
            f"Expected 5 after first restore; no second restore. Got {refreshed.total_stock_remaining}"
        )

    def test_payment_with_no_products_no_error(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Payment with no products → no-op, no error."""
        payment = _make_pending_payment(db, tenant_a, popup_tenant_a, [])
        # Should complete without any exception
        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)

        db.expire_all()
        refreshed = db.get(Payments, payment.id)
        assert refreshed.status == PaymentStatus.EXPIRED.value

    def test_already_expired_payment_is_noop(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Payment already EXPIRED when expiry fires again → restoration is no-op."""
        product = _make_product(db, tenant_a, popup_tenant_a, total_stock_cap=5, total_stock_remaining=5)
        _decrement(db, product, 1)  # remaining=4

        payment = _make_pending_payment(db, tenant_a, popup_tenant_a, [(product, 1)])

        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)

        db.expire_all()
        after_first = db.get(Products, product.id)
        stock_after_first = after_first.total_stock_remaining  # should be 5

        # Fire again (idempotency)
        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)

        db.expire_all()
        after_second = db.get(Products, product.id)
        assert after_second.total_stock_remaining == stock_after_first, (
            "Second expiry must not change stock counters."
        )


# ---------------------------------------------------------------------------
# 5.3 — update_status CANCELLED / REJECTED restoration
# ---------------------------------------------------------------------------


class TestUpdateStatusCancelledRejectedRestoration:
    """Spec §Domain 3 — Cancel/reject restores both counters."""

    def test_cancel_from_pending_restores_total_stock(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """update_status(CANCELLED) from PENDING → total_stock_remaining restored."""
        product = _make_product(db, tenant_a, popup_tenant_a, total_stock_cap=8, total_stock_remaining=8)
        _decrement(db, product, 3)  # remaining=5

        payment = _make_pending_payment(db, tenant_a, popup_tenant_a, [(product, 3)])

        payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)

        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining == 8, (
            f"Expected remaining=8 after cancel, got {refreshed.total_stock_remaining}"
        )

    def test_cancel_from_pending_restores_shared_stock(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """update_status(CANCELLED) from PENDING → shared_stock_remaining restored."""
        group = _make_tier_group(db, tenant_a, shared_stock_cap=10, shared_stock_remaining=10)
        product = _make_product(db, tenant_a, popup_tenant_a, total_stock_cap=None, total_stock_remaining=None)
        _link_product_to_group(db, product, group, order=1)
        _decrement_group(db, group, 4)  # remaining=6

        payment = _make_pending_payment(db, tenant_a, popup_tenant_a, [(product, 4)])

        payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)

        db.expire_all()
        refreshed_group = db.get(TicketTierGroup, group.id)
        assert refreshed_group.shared_stock_remaining == 10, (
            f"Expected group remaining=10 after cancel, got {refreshed_group.shared_stock_remaining}"
        )

    def test_reject_from_pending_restores_total_stock(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """update_status(REJECTED) from PENDING → total_stock_remaining restored."""
        product = _make_product(db, tenant_a, popup_tenant_a, total_stock_cap=6, total_stock_remaining=6)
        _decrement(db, product, 2)  # remaining=4

        payment = _make_pending_payment(db, tenant_a, popup_tenant_a, [(product, 2)])

        payments_crud.update_status(db, payment.id, PaymentStatus.REJECTED)

        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining == 6, (
            f"Expected remaining=6 after reject, got {refreshed.total_stock_remaining}"
        )

    def test_reject_from_pending_restores_shared_stock(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """update_status(REJECTED) from PENDING → shared_stock_remaining restored."""
        group = _make_tier_group(db, tenant_a, shared_stock_cap=12, shared_stock_remaining=12)
        product = _make_product(db, tenant_a, popup_tenant_a, total_stock_cap=None, total_stock_remaining=None)
        _link_product_to_group(db, product, group, order=2)
        _decrement_group(db, group, 3)  # remaining=9

        payment = _make_pending_payment(db, tenant_a, popup_tenant_a, [(product, 3)])

        payments_crud.update_status(db, payment.id, PaymentStatus.REJECTED)

        db.expire_all()
        refreshed_group = db.get(TicketTierGroup, group.id)
        assert refreshed_group.shared_stock_remaining == 12, (
            f"Expected group remaining=12 after reject, got {refreshed_group.shared_stock_remaining}"
        )

    def test_cancel_from_approved_does_not_restore_stock(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """APPROVED → CANCELLED: stock NOT restored (refund flow, out of scope).

        Per design §4.2 and proposal locked decisions: APPROVED→CANCELLED is the
        refund flow. Stock restoration is intentionally NOT wired for this path.
        This test documents the gap is intentional.
        """
        product = _make_product(db, tenant_a, popup_tenant_a, total_stock_cap=10, total_stock_remaining=10)
        _decrement(db, product, 2)  # remaining=8

        # Build an APPROVED payment directly (skip SimpleFI).
        from app.api.attendee.models import Attendees
        from app.api.human.models import Humans
        from app.api.application.models import Applications
        from app.api.application.schemas import ApplicationStatus

        human = Humans(
            tenant_id=tenant_a.id,
            email=f"approved-human-{uuid.uuid4().hex[:8]}@test.com",
            first_name="Approved",
            last_name="Test",
        )
        db.add(human)
        db.flush()
        application = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=human.id,
            status=ApplicationStatus.ACCEPTED.value,
        )
        db.add(application)
        db.flush()
        attendee = Attendees(
            tenant_id=tenant_a.id,
            application_id=application.id,
            popup_id=popup_tenant_a.id,
            name="Approved Attendee",
            category="main",
            email=f"att-approved-{uuid.uuid4().hex[:8]}@test.com",
            check_in_code=f"A{uuid.uuid4().hex[:4].upper()}",
        )
        db.add(attendee)
        db.flush()

        payment = Payments(
            tenant_id=tenant_a.id,
            application_id=application.id,
            popup_id=popup_tenant_a.id,
            status=PaymentStatus.APPROVED.value,
            amount=Decimal("100"),
            currency="ARS",
        )
        db.add(payment)
        db.flush()
        pp = PaymentProducts(
            tenant_id=tenant_a.id,
            payment_id=payment.id,
            product_id=product.id,
            attendee_id=attendee.id,
            quantity=2,
            product_name=product.name,
            product_description=None,
            product_price=product.price,
            product_category="ticket",
            product_currency="ARS",
        )
        db.add(pp)
        db.commit()
        db.refresh(payment)

        stock_before_cancel = db.get(Products, product.id).total_stock_remaining

        payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)

        db.expire_all()
        refreshed = db.get(Products, product.id)
        # APPROVED → CANCELLED: stock must NOT change (no restoration expected)
        assert refreshed.total_stock_remaining == stock_before_cancel, (
            f"APPROVED→CANCELLED must NOT restore stock. "
            f"Expected {stock_before_cancel}, got {refreshed.total_stock_remaining}. "
            "This is the intentional refund-flow gap (see design §4.2)."
        )

    def test_cancel_idempotency_already_cancelled(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """CANCELLED → CANCELLED (second call): stock not restored twice."""
        product = _make_product(db, tenant_a, popup_tenant_a, total_stock_cap=10, total_stock_remaining=10)
        _decrement(db, product, 2)  # remaining=8

        payment = _make_pending_payment(db, tenant_a, popup_tenant_a, [(product, 2)])

        payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)

        db.expire_all()
        after_first = db.get(Products, product.id)
        stock_after_first = after_first.total_stock_remaining  # should be 10

        # Second cancel — already CANCELLED, must be no-op
        payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)

        db.expire_all()
        after_second = db.get(Products, product.id)
        assert after_second.total_stock_remaining == stock_after_first, (
            "Second cancel must not restore stock a second time."
        )
        assert after_second.total_stock_remaining <= 10

    def test_null_stock_cancel_no_error(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """NULL-stock product cancelled → no error, NULL remains NULL."""
        product = _make_product(db, tenant_a, popup_tenant_a, total_stock_cap=None, total_stock_remaining=None)
        payment = _make_pending_payment(db, tenant_a, popup_tenant_a, [(product, 1)])

        payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)

        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining is None
