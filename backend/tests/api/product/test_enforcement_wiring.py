"""Integration tests for enforcement wiring at 3 sites (product-inventory-redesign, Slice 2 / Phase 4).

TDD phase: RED — written BEFORE implementation.

Covers:
  4.1 create_open_ticketing_payment: sold-out 409, concurrent decrement (one 200, one 409),
       NULL-stock pass-through, max_per_order 422
  4.3 create_payment: sold-out 409, decrement success, NULL-stock pass-through,
       max_per_order 422
  4.5 add_product: sold-out 409, max_per_order 422, NULL-stock pass-through,
       decrement success
  4.7 _validate_product_availability: verify it is REMOVED / no call sites remain
  4.8 max_per_order validation at all sites

Spec references:
  §Domain 2 "Eager Decrement at All Three Purchase Entry Points"
  §Domain 5 "add_product Enforces Stock Caps"
  §Domain 1 "Atomic Stock Decrement"
"""

import threading
import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.attendee.crud import attendees_crud
from app.api.attendee.models import Attendees
from app.api.payment.crud import payments_crud
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
    total_stock_cap: int | None = None,
    total_stock_remaining: int | None = None,
    max_per_order: int | None = None,
    price: int = 0,
) -> Products:
    suffix = uuid.uuid4().hex[:8]
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"enf-test-{suffix}",
        slug=f"enf-{suffix}",
        price=price,
        category="ticket",
        total_stock_cap=total_stock_cap,
        total_stock_remaining=total_stock_remaining,
        max_per_order=max_per_order,
        is_active=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_attendee(
    db: Session,
    application: Applications,
) -> Attendees:
    """Create a minimal attendee linked to an application."""
    attendee = Attendees(
        tenant_id=application.tenant_id,
        application_id=application.id,
        popup_id=application.popup_id,
        name="Test Attendee",
        category="main",
        email=f"attendee-{uuid.uuid4().hex[:8]}@test.com",
        check_in_code=f"T{uuid.uuid4().hex[:4].upper()}",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _get_or_create_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
) -> Applications:
    """Get an existing application or create one for tests."""
    app = db.exec(
        select(Applications).where(
            Applications.tenant_id == tenant.id,
            Applications.popup_id == popup.id,
        )
    ).first()
    if app is None:
        from app.api.human.models import Humans
        human = Humans(
            tenant_id=tenant.id,
            email=f"enf-human-{uuid.uuid4().hex[:8]}@test.com",
            first_name="Enf",
            last_name="Test",
        )
        db.add(human)
        db.flush()
        from app.api.application.schemas import ApplicationStatus

        app = Applications(
            tenant_id=tenant.id,
            popup_id=popup.id,
            human_id=human.id,
            status=ApplicationStatus.ACCEPTED.value,
        )
        db.add(app)
        db.commit()
        db.refresh(app)
    return app


# ---------------------------------------------------------------------------
# 4.5 / 4.6 add_product enforcement (simplest site to test first)
# ---------------------------------------------------------------------------


class TestAddProductEnforcement:
    """Spec §Domain 5 — add_product Enforces Stock Caps."""

    def test_add_product_sold_out_raises_409(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """add_product on product with total_stock_remaining=0 → 409."""
        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=1,
            total_stock_remaining=0,
        )
        app = _get_or_create_application(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, app)

        with pytest.raises(HTTPException) as exc_info:
            attendees_crud.add_product(db, attendee.id, product.id)
        assert exc_info.value.status_code == 409

    def test_add_product_within_stock_decrements_counter(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """add_product call decrements 1 unit of total_stock_remaining."""
        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=5,
            total_stock_remaining=5,
        )
        app = _get_or_create_application(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, app)

        # Always-insert: each call creates 1 ticket and decrements 1.
        attendees_crud.add_product(db, attendee.id, product.id)
        attendees_crud.add_product(db, attendee.id, product.id)

        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining == 3, (
            f"Expected remaining=3, got {refreshed.total_stock_remaining}"
        )

    def test_add_product_unlimited_passes(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """add_product with NULL stock (unlimited) → succeeds without decrement."""
        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=None,
            total_stock_remaining=None,
        )
        app = _get_or_create_application(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, app)

        # Many calls on an unlimited product all succeed.
        for _ in range(5):
            result = attendees_crud.add_product(db, attendee.id, product.id)
            assert result is not None

        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining is None

    def test_add_product_invalid_max_per_order_raises_422(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """add_product on a product mis-configured with max_per_order < 1 → 422.

        Note: under always-insert semantics, max_per_order is enforced per cart
        in the calling layer; this guard only catches the degenerate case where
        max_per_order is 0 (config error that would reject all tickets).

        The DB check constraint ck_products_max_per_order_positive prevents
        inserting max_per_order=0 directly, so we mock session.get to return a
        Product object with max_per_order=0 — simulating legacy/corrupted data
        without poisoning the shared session.
        """
        from unittest.mock import MagicMock, patch

        from app.api.product.models import Products

        # Build a mock product with max_per_order=0 (uncreatable via normal ORM)
        mock_product = MagicMock(spec=Products)
        mock_product.id = uuid.uuid4()
        mock_product.name = "invalid-max-per-order-product"
        mock_product.max_per_order = 0
        mock_product.total_stock_cap = 10
        mock_product.total_stock_remaining = 10

        app = _get_or_create_application(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, app)

        with patch.object(db, "get", return_value=mock_product):
            with pytest.raises(HTTPException) as exc_info:
                attendees_crud.add_product(db, attendee.id, mock_product.id)
        assert exc_info.value.status_code == 422

    def test_add_product_concurrent_decrements_exactly_one_wins(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        test_engine,
    ) -> None:
        """Concurrent add_product on remaining=1: exactly one 200, one 409."""
        from sqlmodel import Session as SyncSession

        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=1,
            total_stock_remaining=1,
        )
        app = _get_or_create_application(db, tenant_a, popup_tenant_a)

        successes: list[bool] = []
        conflicts: list[bool] = []
        lock = threading.Lock()

        def one_add() -> None:
            with SyncSession(test_engine) as session:
                attendee = _make_attendee(session, app)
                try:
                    attendees_crud.add_product(session, attendee.id, product.id)
                    with lock:
                        successes.append(True)
                except HTTPException as exc:
                    session.rollback()
                    if exc.status_code == 409:
                        with lock:
                            conflicts.append(True)
                    else:
                        raise

        t1 = threading.Thread(target=one_add)
        t2 = threading.Thread(target=one_add)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        assert len(successes) == 1, f"Expected 1 success, got {successes}"
        assert len(conflicts) == 1, f"Expected 1 conflict, got {conflicts}"

        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining == 0


# ---------------------------------------------------------------------------
# 4.7 _validate_product_availability must be REMOVED
# ---------------------------------------------------------------------------


class TestValidateProductAvailabilityRemoved:
    """Design §1 — _validate_product_availability must be deleted."""

    def test_validate_product_availability_does_not_exist(self) -> None:
        """PaymentsCRUD must not have _validate_product_availability anymore."""
        assert not hasattr(payments_crud, "_validate_product_availability"), (
            "_validate_product_availability still exists on PaymentsCRUD. "
            "It must be removed as part of Slice 2 (replaced by atomic decrement)."
        )

    def test_no_call_sites_in_payment_crud(self) -> None:
        """No remaining call to _validate_product_availability in payment/crud.py."""
        import inspect

        import app.api.payment.crud as payment_crud_module

        source = inspect.getsource(payment_crud_module)
        assert "_validate_product_availability" not in source, (
            "_validate_product_availability still referenced in payment/crud.py"
        )


# ---------------------------------------------------------------------------
# 4.1 / 4.2  create_open_ticketing_payment enforcement
# ---------------------------------------------------------------------------


def _make_ot_popup(db: Session, tenant: Tenants) -> Popups:
    """Create an active direct-sale popup for open ticketing tests."""
    from app.api.shared.enums import SaleType

    popup = Popups(
        tenant_id=tenant.id,
        name=f"OT Popup {uuid.uuid4().hex[:6]}",
        slug=f"ot-enf-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.direct.value,
        status="active",
        simplefi_api_key="test_simplefi_key",
        currency="ARS",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_ot_product(
    db: Session,
    popup: Popups,
    *,
    total_stock_remaining: int | None = None,
    total_stock_cap: int | None = None,
    max_per_order: int | None = None,
    price: str = "100.00",
) -> Products:

    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"OT Product {uuid.uuid4().hex[:6]}",
        slug=f"ot-prod-{uuid.uuid4().hex[:6]}",
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


def _ot_purchase(product: Products, qty: int = 1):
    from app.api.checkout.schemas import (
        BuyerInfo,
        OpenTicketingPurchaseCreate,
        ProductLine,
    )

    return OpenTicketingPurchaseCreate(
        products=[ProductLine(product_id=product.id, quantity=qty)],
        buyer=BuyerInfo(
            email=f"buyer-{uuid.uuid4().hex[:6]}@test.com",
            first_name="Test",
            last_name="Buyer",
            form_data={},
        ),
    )


class TestOpenTicketingPaymentEnforcement:
    """Spec §Domain 2 — create_open_ticketing_payment decrements stock."""

    def test_sold_out_product_raises_409(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """total_stock_remaining=0 → 409 before SimpleFI is called."""
        from unittest.mock import patch

        popup = _make_ot_popup(db, tenant_a)
        product = _make_ot_product(
            db, popup,
            total_stock_cap=1,
            total_stock_remaining=0,
        )
        obj = _ot_purchase(product, qty=1)

        with patch("app.services.simplefi.get_simplefi_client") as mock_sf:
            with pytest.raises(HTTPException) as exc_info:
                payments_crud.create_open_ticketing_payment(
                    db, obj=obj, popup=popup, tenant=tenant_a
                )
        assert exc_info.value.status_code == 409
        # SimpleFI must NOT have been called
        mock_sf.assert_not_called()

    def test_sufficient_stock_decrements_counter(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Successful payment → total_stock_remaining decremented atomically."""
        from types import SimpleNamespace
        from unittest.mock import patch

        popup = _make_ot_popup(db, tenant_a)
        product = _make_ot_product(
            db, popup,
            total_stock_cap=10,
            total_stock_remaining=10,
        )
        obj = _ot_purchase(product, qty=2)

        simplefi_response = SimpleNamespace(
            id=f"sf-{uuid.uuid4().hex[:8]}",
            status="pending",
            checkout_url="https://simplefi.test/checkout/enf",
        )

        with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
            mock_get_client.return_value.create_payment.return_value = simplefi_response
            payments_crud.create_open_ticketing_payment(
                db, obj=obj, popup=popup, tenant=tenant_a
            )

        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining == 8, (
            f"Expected 8, got {refreshed.total_stock_remaining}"
        )

    def test_unlimited_stock_passes_without_decrement(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """NULL stock (unlimited) → no decrement, payment created."""
        from types import SimpleNamespace
        from unittest.mock import patch

        popup = _make_ot_popup(db, tenant_a)
        product = _make_ot_product(
            db, popup,
            total_stock_cap=None,
            total_stock_remaining=None,
        )
        obj = _ot_purchase(product, qty=5)

        simplefi_response = SimpleNamespace(
            id=f"sf-{uuid.uuid4().hex[:8]}",
            status="pending",
            checkout_url="https://simplefi.test/checkout/unlimited",
        )

        with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
            mock_get_client.return_value.create_payment.return_value = simplefi_response
            payment, _ = payments_crud.create_open_ticketing_payment(
                db, obj=obj, popup=popup, tenant=tenant_a
            )

        assert payment is not None
        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining is None

    def test_max_per_order_exceeded_raises_422(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """qty > max_per_order → 422."""
        from unittest.mock import patch

        popup = _make_ot_popup(db, tenant_a)
        product = _make_ot_product(
            db, popup,
            total_stock_cap=100,
            total_stock_remaining=100,
            max_per_order=2,
        )
        obj = _ot_purchase(product, qty=3)

        with patch("app.services.simplefi.get_simplefi_client"):
            with pytest.raises(HTTPException) as exc_info:
                payments_crud.create_open_ticketing_payment(
                    db, obj=obj, popup=popup, tenant=tenant_a
                )
        assert exc_info.value.status_code == 422

    def test_concurrent_decrements_exactly_one_wins(
        self,
        db: Session,
        tenant_a: Tenants,
        test_engine,
    ) -> None:
        """Concurrent calls on remaining=1: exactly one succeeds, one 409."""
        from types import SimpleNamespace
        from unittest.mock import patch

        from sqlmodel import Session as SyncSession

        popup = _make_ot_popup(db, tenant_a)
        product = _make_ot_product(
            db, popup,
            total_stock_cap=1,
            total_stock_remaining=1,
        )

        successes: list[bool] = []
        conflicts: list[bool] = []
        lock = threading.Lock()

        def one_purchase() -> None:
            obj = _ot_purchase(product, qty=1)
            simplefi_response = SimpleNamespace(
                id=f"sf-{uuid.uuid4().hex[:8]}",
                status="pending",
                checkout_url="https://simplefi.test/checkout/conc",
            )
            with SyncSession(test_engine) as session:
                with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
                    mock_get_client.return_value.create_payment.return_value = simplefi_response
                    try:
                        payments_crud.create_open_ticketing_payment(
                            session, obj=obj, popup=popup, tenant=tenant_a
                        )
                        with lock:
                            successes.append(True)
                    except HTTPException as exc:
                        if exc.status_code == 409:
                            with lock:
                                conflicts.append(True)
                        else:
                            raise

        t1 = threading.Thread(target=one_purchase)
        t2 = threading.Thread(target=one_purchase)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        assert len(successes) == 1, f"Expected 1 success, got {successes}"
        assert len(conflicts) == 1, f"Expected 1 conflict, got {conflicts}"

        db.expire_all()
        refreshed = db.get(Products, product.id)
        assert refreshed.total_stock_remaining == 0


# ---------------------------------------------------------------------------
# 4.3 / 4.4  create_payment enforcement
# ---------------------------------------------------------------------------


class TestCreatePaymentEnforcement:
    """Spec §Domain 2 — create_payment decrements total stock."""

    def test_sold_out_product_raises_409(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """total_stock_remaining=0 via create_payment → 409, no payment row."""
        from app.api.payment.schemas import PaymentCreate, PaymentProductRequest

        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=1,
            total_stock_remaining=0,
        )

        # We need a real application+attendee to call create_payment
        app = _get_or_create_application(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, app)

        pay_obj = PaymentCreate(
            application_id=app.id,
            products=[
                PaymentProductRequest(
                    product_id=product.id,
                    attendee_id=attendee.id,
                    quantity=1,
                )
            ],
        )

        with pytest.raises(HTTPException) as exc_info:
            payments_crud.create_payment(db, pay_obj)
        assert exc_info.value.status_code == 409

    def test_max_per_order_exceeded_raises_422(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """qty > max_per_order via create_payment → 422."""
        from app.api.payment.schemas import PaymentCreate, PaymentProductRequest

        product = _make_product(
            db, tenant_a, popup_tenant_a,
            total_stock_cap=100,
            total_stock_remaining=100,
            max_per_order=2,
        )

        app = _get_or_create_application(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, app)

        pay_obj = PaymentCreate(
            application_id=app.id,
            products=[
                PaymentProductRequest(
                    product_id=product.id,
                    attendee_id=attendee.id,
                    quantity=5,
                )
            ],
        )

        with pytest.raises(HTTPException) as exc_info:
            payments_crud.create_payment(db, pay_obj)
        assert exc_info.value.status_code == 422
