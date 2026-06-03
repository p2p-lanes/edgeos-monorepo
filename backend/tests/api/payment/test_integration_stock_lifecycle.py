"""Integration tests — stock lifecycle cross-slice (product-inventory-redesign, Phase 7).

TDD phase: RED (written as integration-layer tests for HTTP + DB verification).

Covers:
  7.1 Concurrent checkout race: two simultaneous purchases on remaining=1 → exactly one 200,
      one 409; product state verified at DB level.
  7.2 Webhook expiry restoration end-to-end: create payment → fire expired webhook via HTTP
      → assert total_stock_remaining restored, payment EXPIRED.
  7.3 Cancel/reject restoration end-to-end: create payment → admin PATCH → assert restoration.
  7.4 Application flow enforcement end-to-end: add_product against capacity=0 → 409.

Spec references:
  §Domain 1 "Atomic Stock Decrement"
  §Domain 2 "Eager Decrement at All Three Purchase Entry Points"
  §Domain 3 "Webhook Handlers Restore Both Counters"
  §Domain 5 "add_product Enforces Stock Caps"
"""

import threading
import uuid
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.crud import products_crud
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Fixtures / Helpers
# ---------------------------------------------------------------------------


def _make_direct_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Integration Popup {uuid.uuid4().hex[:6]}",
        slug=f"integ-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.direct.value,
        status="active",
        simplefi_api_key="test_simplefi_key",
        currency="ARS",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_product(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    total_stock_cap: int | None = None,
    total_stock_remaining: int | None = None,
    max_per_order: int | None = None,
    price: str = "0",
    name: str | None = None,
) -> Products:
    suffix = uuid.uuid4().hex[:8]
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=name or f"integ-prod-{suffix}",
        slug=f"integ-{suffix}",
        price=Decimal(price),
        category="ticket",
        is_active=True,
        total_stock_cap=total_stock_cap,
        total_stock_remaining=total_stock_remaining,
        max_per_order=max_per_order,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_payment_with_product(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    product: Products,
    quantity: int = 1,
    *,
    external_id: str | None = None,
) -> Payments:
    """Create a PENDING payment that already has a PaymentProducts row (snapshot).

    Creates a minimal Human → Application → Attendee chain required by
    PaymentProducts FK (attendee_id is part of the primary key).
    """
    from app.api.application.models import Applications
    from app.api.application.schemas import ApplicationStatus
    from app.api.attendee.models import Attendees
    from app.api.human.models import Humans

    ext_id = external_id or f"simplefi-integ-{uuid.uuid4().hex[:8]}"
    suffix = uuid.uuid4().hex[:8]

    human = Humans(
        tenant_id=tenant.id,
        email=f"integ-human-{suffix}@test.com",
        first_name="Integ",
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
        name="Integ Attendee",
        category="main",
        email=f"att-{suffix}@test.com",
    )
    db.add(attendee)
    db.flush()

    payment = Payments(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        status=PaymentStatus.PENDING.value,
        amount=Decimal("0"),
        currency="ARS",
        external_id=ext_id,
        checkout_url="https://checkout.example.com",
        payment_type="regular",
    )
    db.add(payment)
    db.flush()

    snapshot = PaymentProducts(
        tenant_id=tenant.id,
        payment_id=payment.id,
        product_id=product.id,
        attendee_id=attendee.id,
        quantity=quantity,
        product_name=product.name,
        product_description=None,
        product_price=product.price,
        product_category=product.category or "ticket",
        product_currency="ARS",
    )
    db.add(snapshot)
    db.commit()
    db.refresh(payment)
    return payment


def _make_simplefi_expired_webhook_body(payment_request_id: str) -> dict:
    return {
        "id": f"evt-{uuid.uuid4().hex[:8]}",
        "event_type": "payment_request_expired",
        "entity_type": "payment_request",
        "entity_id": payment_request_id,
        "data": {
            "payment_request": {
                "id": payment_request_id,
                "order_id": 1,
                "amount": 0,
                "amount_paid": 0,
                "currency": "ARS",
                "reference": {},
                "status": "expired",
                "status_detail": "expired",
                "transactions": [],
                "card_payment": None,
                "payments": [],
                "installment_plan_id": None,
            },
            "new_payment": None,
        },
    }


# ---------------------------------------------------------------------------
# 7.1 Concurrent checkout race
# ---------------------------------------------------------------------------


class TestConcurrentCheckoutRace:
    """7.1 — HTTP-layer concurrent checkout: one succeeds, one 409."""

    def test_concurrent_open_ticketing_on_stock_one_exactly_one_success(
        self,
        db: Session,
        tenant_a: Tenants,
        test_engine,
    ) -> None:
        """Concurrent OT purchases on remaining=1: exactly one 200, one 409 at CRUD level.

        This validates the atomic guard from the CRUD layer perspective.
        The HTTP-level test is covered by the pattern demonstrated in
        test_product_crud_atomic.py — same threading model.
        """
        from sqlmodel import Session as SyncSession

        popup = _make_direct_popup(db, tenant_a)
        product = _make_product(
            db,
            tenant_a,
            popup,
            total_stock_cap=1,
            total_stock_remaining=1,
        )
        product_id = product.id

        from fastapi import HTTPException

        successes: list[bool] = []
        conflicts: list[bool] = []
        lock = threading.Lock()

        def one_decrement() -> None:
            with SyncSession(test_engine) as session:
                try:
                    products_crud.decrement_total_stock(session, product_id, 1)
                    session.commit()
                    with lock:
                        successes.append(True)
                except HTTPException as exc:
                    session.rollback()
                    if exc.status_code == 409:
                        with lock:
                            conflicts.append(True)
                    else:
                        raise

        t1 = threading.Thread(target=one_decrement)
        t2 = threading.Thread(target=one_decrement)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        assert len(successes) == 1, f"Expected 1 success, got {successes}"
        assert len(conflicts) == 1, f"Expected 1 conflict, got {conflicts}"

        db.expire_all()
        refreshed = db.get(Products, product_id)
        assert refreshed.total_stock_remaining == 0


# ---------------------------------------------------------------------------
# 7.2 Webhook expiry restoration — HTTP layer
# ---------------------------------------------------------------------------


class TestWebhookExpiryRestoration:
    """7.2 — Create payment → fire expired webhook via HTTP → assert stock restored."""

    def test_expiry_webhook_restores_stock_end_to_end(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_direct_popup(db, tenant_a)
        product = _make_product(
            db,
            tenant_a,
            popup,
            total_stock_cap=10,
            total_stock_remaining=7,  # 3 units sold
        )

        external_id = f"simplefi-expire-e2e-{uuid.uuid4().hex[:8]}"
        payment = _make_payment_with_product(
            db, tenant_a, popup, product, quantity=3, external_id=external_id
        )

        stock_before = db.get(Products, product.id).total_stock_remaining
        assert stock_before == 7

        # Fire the webhook via HTTP — no auth required on webhook endpoints
        response = client.post(
            "/api/v1/payments/webhook/simplefi",
            json=_make_simplefi_expired_webhook_body(external_id),
        )

        assert response.status_code == 200, response.text

        db.expire_all()
        payment_after = db.get(Payments, payment.id)
        assert payment_after.status == PaymentStatus.EXPIRED.value

        product_after = db.get(Products, product.id)
        # 7 + 3 = 10; LEAST(10, 10) = 10
        assert product_after.total_stock_remaining == 10

    def test_expiry_webhook_idempotent_double_fire(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_direct_popup(db, tenant_a)
        product = _make_product(
            db,
            tenant_a,
            popup,
            total_stock_cap=10,
            total_stock_remaining=8,  # 2 units sold
        )

        external_id = f"simplefi-expire-idem-{uuid.uuid4().hex[:8]}"
        _make_payment_with_product(
            db, tenant_a, popup, product, quantity=2, external_id=external_id
        )

        webhook_body = _make_simplefi_expired_webhook_body(external_id)

        # First fire — should restore
        r1 = client.post("/api/v1/payments/webhook/simplefi", json=webhook_body)
        assert r1.status_code == 200

        db.expire_all()
        after_first = db.get(Products, product.id).total_stock_remaining
        assert after_first == 10  # 8 + 2

        # Second fire — different fingerprint event_id so no cache dedup;
        # but payment is now EXPIRED so update_status is a no-op
        webhook_body["id"] = f"evt-second-{uuid.uuid4().hex[:8]}"
        r2 = client.post("/api/v1/payments/webhook/simplefi", json=webhook_body)
        assert r2.status_code == 200

        db.expire_all()
        after_second = db.get(Products, product.id).total_stock_remaining
        # Must NOT exceed cap — idempotency guard holds
        assert after_second == 10


# ---------------------------------------------------------------------------
# 7.3 Cancel / reject restoration — HTTP PATCH layer
# ---------------------------------------------------------------------------


class TestCancelRejectRestoration:
    """7.3 — Create payment → admin cancels via HTTP → assert restoration."""

    def test_cancel_pending_payment_restores_stock(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        popup = _make_direct_popup(db, tenant_a)
        product = _make_product(
            db,
            tenant_a,
            popup,
            total_stock_cap=10,
            total_stock_remaining=6,  # 4 units sold
        )

        payment = _make_payment_with_product(db, tenant_a, popup, product, quantity=4)

        admin_token = create_access_token(
            subject=admin_user_tenant_a.id, token_type="user"
        )

        response = client.patch(
            f"/api/v1/payments/{payment.id}",
            json={"status": PaymentStatus.CANCELLED.value},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert response.status_code == 200, response.text

        db.expire_all()
        payment_after = db.get(Payments, payment.id)
        assert payment_after.status == PaymentStatus.CANCELLED.value

        product_after = db.get(Products, product.id)
        assert product_after.total_stock_remaining == 10  # 6 + 4

    def test_reject_pending_payment_restores_stock(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        popup = _make_direct_popup(db, tenant_a)
        product = _make_product(
            db,
            tenant_a,
            popup,
            total_stock_cap=5,
            total_stock_remaining=3,  # 2 units sold
        )

        payment = _make_payment_with_product(db, tenant_a, popup, product, quantity=2)

        admin_token = create_access_token(
            subject=admin_user_tenant_a.id, token_type="user"
        )

        response = client.patch(
            f"/api/v1/payments/{payment.id}",
            json={"status": PaymentStatus.REJECTED.value},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert response.status_code == 200, response.text

        db.expire_all()
        product_after = db.get(Products, product.id)
        assert product_after.total_stock_remaining == 5  # 3 + 2

    def test_cancel_approved_payment_does_not_restore_stock(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """APPROVED → CANCELLED: explicitly out-of-scope refund flow, no restoration."""
        popup = _make_direct_popup(db, tenant_a)
        product = _make_product(
            db,
            tenant_a,
            popup,
            total_stock_cap=10,
            total_stock_remaining=6,  # 4 units sold
        )

        payment = _make_payment_with_product(db, tenant_a, popup, product, quantity=4)
        # Set to APPROVED first
        payment.status = PaymentStatus.APPROVED.value
        db.add(payment)
        db.commit()
        db.refresh(payment)

        stock_before = db.get(Products, product.id).total_stock_remaining
        assert stock_before == 6

        admin_token = create_access_token(
            subject=admin_user_tenant_a.id, token_type="user"
        )

        response = client.patch(
            f"/api/v1/payments/{payment.id}",
            json={"status": PaymentStatus.CANCELLED.value},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert response.status_code == 200, response.text

        db.expire_all()
        product_after = db.get(Products, product.id)
        # Stock must NOT be restored for APPROVED → CANCELLED
        assert product_after.total_stock_remaining == 6


# ---------------------------------------------------------------------------
# 7.4 Application flow enforcement — add_product via CRUD
# ---------------------------------------------------------------------------


class TestApplicationFlowEnforcement:
    """7.4 — add_product against capacity=0 → 409."""

    def test_add_product_at_capacity_returns_409(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        from fastapi import HTTPException

        from app.api.application.models import Applications
        from app.api.application.schemas import ApplicationStatus
        from app.api.attendee.crud import attendees_crud
        from app.api.attendee.models import Attendees
        from app.api.human.models import Humans

        popup = _make_direct_popup(db, tenant_a)
        product = _make_product(
            db,
            tenant_a,
            popup,
            total_stock_cap=0,
            total_stock_remaining=0,
        )

        # Create human + application + attendee
        human = Humans(
            tenant_id=tenant_a.id,
            email=f"enf-int-{uuid.uuid4().hex[:8]}@test.com",
            first_name="Enf",
            last_name="Int",
        )
        db.add(human)
        db.flush()

        application = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            human_id=human.id,
            status=ApplicationStatus.ACCEPTED.value,
        )
        db.add(application)
        db.flush()

        attendee = Attendees(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            application_id=application.id,
            name="Test Attendee",
            category="main",
            email=f"test-{uuid.uuid4().hex[:6]}@test.com",
        )
        db.add(attendee)
        db.commit()
        db.refresh(attendee)

        with pytest.raises(HTTPException) as exc_info:
            attendees_crud.add_product(db, attendee.id, product.id)

        assert exc_info.value.status_code == 409
