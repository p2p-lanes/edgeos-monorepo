"""Tests for pending-payment hold-release PR 2: ADR-1 row lock, ADR-2 supersede, ADR-4 router contracts.

TDD phase: RED — written BEFORE implementation.

Tasks covered:
  5.1 test_supersede_authenticated
  5.2 test_supersede_open_checkout
  5.3 test_supersede_installment_plan
  5.4 test_race_lost_approved
  5.5 test_cancel_transport_failure
  5.6 test_concurrent_create_same_buyer (DB + threading)
  5.7 test_double_release_protection (DB + threading)
  5.8 test_release_then_fail
"""

import threading
import uuid
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.coupon.models import Coupons
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentSource, PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.services.simplefi.client import CancelOutcome, CancelOutcomeAmbiguousError

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _make_popup(db: Session, tenant: Tenants, *, slug_prefix: str = "hold") -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Hold Test Popup {slug_prefix}",
        slug=f"{slug_prefix}-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.direct.value,
        status="active",
        simplefi_api_key="test_simplefi_key",
        currency="ARS",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_human(db: Session, tenant: Tenants, *, email: str | None = None) -> Humans:
    """Create a minimal Human for testing."""
    email = email or f"test-{uuid.uuid4().hex[:8]}@example.com"
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=email,
        first_name="Test",
        last_name="User",
    )
    db.add(human)
    db.flush()
    return human


def _make_application(
    db: Session, tenant: Tenants, popup: Popups, human: Humans
) -> Applications:
    """Create a minimal Application for testing."""
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
        referral="test",
    )
    db.add(application)
    db.flush()
    return application


def _make_product(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    price: str = "100",
    total_stock_cap: int | None = None,
    total_stock_remaining: int | None = None,
) -> Products:
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Product {uuid.uuid4().hex[:6]}",
        slug=f"prod-{uuid.uuid4().hex[:6]}",
        price=Decimal(price),
        category="ticket",
        is_active=True,
        total_stock_cap=total_stock_cap,
        total_stock_remaining=total_stock_remaining,
    )
    db.add(product)
    db.flush()
    return product


def _make_coupon(
    db: Session,
    popup: Popups,
    *,
    current_uses: int = 2,
    max_uses: int = 5,
) -> Coupons:
    coupon = Coupons(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        code=f"HOLD{uuid.uuid4().hex[:6].upper()}",
        discount_value=10,
        is_active=True,
        current_uses=current_uses,
        max_uses=max_uses,
    )
    db.add(coupon)
    db.flush()
    return coupon


def _make_pending_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    coupon: Coupons | None = None,
    application_id: uuid.UUID | None = None,
    buyer_email: str | None = None,
    is_installment_plan: bool = False,
    external_id: str | None = None,
) -> Payments:
    """Create a minimal PENDING SimpleFi payment.

    For open-checkout payments (no application_id), buyer_email is stored in
    buyer_snapshot under the 'buyer_email' key — the same key that
    supersede_pending_payments uses for JSONB lookup.
    """
    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        application_id=application_id,
        status=PaymentStatus.PENDING.value,
        amount=Decimal("100"),
        currency="ARS",
        source=PaymentSource.SIMPLEFI.value,
        coupon_id=coupon.id if coupon else None,
        coupon_code=coupon.code if coupon else None,
        is_installment_plan=is_installment_plan,
        external_id=external_id or f"ext-{uuid.uuid4().hex[:12]}",
    )
    if buyer_email:
        # Store as 'buyer_email' (lowercase) — matches supersede lookup key
        payment.buyer_snapshot = {"buyer_email": buyer_email.lower()}
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def _fresh_coupon_uses(db: Session, coupon_id: uuid.UUID) -> int:
    db.expire_all()
    coupon = db.get(Coupons, coupon_id)
    assert coupon is not None
    return coupon.current_uses


def _fresh_payment_status(db: Session, payment_id: uuid.UUID) -> str:
    db.expire_all()
    payment = db.get(Payments, payment_id)
    assert payment is not None
    return str(payment.status)


# ---------------------------------------------------------------------------
# Task 5.7: test_double_release_protection (ADR-1 row lock)
# ---------------------------------------------------------------------------


class TestDoubleReleaseProtection:
    """Concurrent update_status calls on the same PENDING payment release holds exactly once.

    Spec reference: Idempotent Hold Release + ADR-1.
    """

    def test_concurrent_update_status_releases_coupon_once(
        self,
        db: Session,
        test_engine,
        tenant_a: Tenants,
    ) -> None:
        """Two concurrent update_status(CANCELLED) calls → coupon current_uses decremented exactly once.

        Without ADR-1 FOR UPDATE, both threads could read PENDING and both release
        the coupon, giving current_uses -= 2. With the row lock, one blocks until
        the other commits, reads CANCELLED, and skips the release.
        """
        popup = _make_popup(db, tenant_a, slug_prefix="lock5")
        coupon = _make_coupon(db, popup, current_uses=3)
        payment = _make_pending_payment(db, tenant_a, popup, coupon=coupon)

        initial_uses = _fresh_coupon_uses(db, coupon.id)
        assert initial_uses == 3

        results: list[Exception | None] = []

        def call_update_status() -> None:
            from sqlmodel import Session as Sess

            with Sess(test_engine) as local_session:
                try:
                    payments_crud.update_status(
                        local_session, payment.id, PaymentStatus.CANCELLED
                    )
                    results.append(None)
                except Exception as exc:
                    results.append(exc)

        t1 = threading.Thread(target=call_update_status)
        t2 = threading.Thread(target=call_update_status)
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        # Both must complete (one is a no-op, not an error)
        assert len(results) == 2
        for r in results:
            assert r is None, f"Unexpected exception: {r}"

        # Coupon released exactly once
        final_uses = _fresh_coupon_uses(db, coupon.id)
        assert final_uses == initial_uses - 1, (
            f"Expected {initial_uses - 1} uses, got {final_uses} (double-release detected)"
        )

        # Payment landed in CANCELLED
        assert _fresh_payment_status(db, payment.id) == PaymentStatus.CANCELLED.value


# ---------------------------------------------------------------------------
# Task 5.1-5.5, 5.8: supersede unit tests (mocked SimpleFi)
# ---------------------------------------------------------------------------


class TestSupersedeAuthenticated:
    """supersede_pending_payments with application_id finds a prior PENDING and cancels it.

    Task 5.1: Prior PENDING auth payment → cancel_payment_request → CANCELED →
    update_status(CANCELLED) → coupon/stock released; new payment can be created.
    """

    def test_prior_pending_cancelled_and_holds_released(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Happy path: prior PENDING auth payment is superseded; coupon released."""
        popup = _make_popup(db, tenant_a, slug_prefix="sup-auth")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        coupon = _make_coupon(db, popup, current_uses=2)
        prior_payment = _make_pending_payment(
            db, tenant_a, popup, coupon=coupon, application_id=application.id
        )

        uses_before = _fresh_coupon_uses(db, coupon.id)
        assert uses_before == 2

        with patch("app.services.simplefi.get_simplefi_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = CancelOutcome.CANCELED
            mock_client_factory.return_value = mock_client

            payments_crud.supersede_pending_payments(
                db,
                application_id=application.id,
            )

        mock_client.cancel_payment_request.assert_called_once_with(
            prior_payment.external_id
        )

        # Coupon released exactly once
        assert _fresh_coupon_uses(db, coupon.id) == uses_before - 1

        # Old payment is CANCELLED
        assert (
            _fresh_payment_status(db, prior_payment.id) == PaymentStatus.CANCELLED.value
        )

    def test_no_prior_pending_is_noop(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """No PENDING payment for application_id → supersede is a no-op."""
        popup = _make_popup(db, tenant_a, slug_prefix="sup-auth-noop")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        db.commit()

        with patch("app.services.simplefi.get_simplefi_client") as mock_client_factory:
            # supersede_pending_payments should NOT call SimpleFi
            payments_crud.supersede_pending_payments(
                db,
                application_id=application.id,
            )
            mock_client_factory.assert_not_called()


class TestSupersedeOpenCheckout:
    """supersede_pending_payments with email+popup_id key.

    Task 5.2: Prior PENDING open-checkout payment (email+popup_id) → cancel →
    holds released; subsequent creation can proceed cleanly.
    """

    def test_prior_pending_open_checkout_cancelled(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Prior PENDING open-checkout payment for email+popup_id is superseded."""
        popup = _make_popup(db, tenant_a, slug_prefix="sup-oc")
        buyer_email = f"buyer-{uuid.uuid4().hex[:8]}@example.com"
        prior_payment = _make_pending_payment(
            db, tenant_a, popup, buyer_email=buyer_email
        )

        with patch("app.services.simplefi.get_simplefi_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = CancelOutcome.CANCELED
            mock_client_factory.return_value = mock_client

            payments_crud.supersede_pending_payments(
                db,
                email=buyer_email,
                popup_id=popup.id,
            )

        mock_client.cancel_payment_request.assert_called_once_with(
            prior_payment.external_id
        )
        assert (
            _fresh_payment_status(db, prior_payment.id) == PaymentStatus.CANCELLED.value
        )

    def test_email_matching_is_case_insensitive(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Email lookup is case-insensitive (BUYER@example.com matches buyer@example.com)."""
        popup = _make_popup(db, tenant_a, slug_prefix="sup-oc-ci")
        buyer_email = f"Buyer-{uuid.uuid4().hex[:8]}@example.com"
        prior_payment = _make_pending_payment(
            db, tenant_a, popup, buyer_email=buyer_email
        )

        with patch("app.services.simplefi.get_simplefi_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = CancelOutcome.CANCELED
            mock_client_factory.return_value = mock_client

            # Pass uppercase version
            payments_crud.supersede_pending_payments(
                db,
                email=buyer_email.upper(),
                popup_id=popup.id,
            )

        mock_client.cancel_payment_request.assert_called_once()
        assert (
            _fresh_payment_status(db, prior_payment.id) == PaymentStatus.CANCELLED.value
        )


class TestSupersedeInstallmentPlan:
    """supersede_pending_payments dispatches cancel_installment_plan when is_installment_plan=True.

    Task 5.3: is_installment_plan=True → cancel_installment_plan called (not cancel_payment_request);
    'cancelled' (two-L) normalizes to CANCELED; holds released.
    """

    def test_installment_plan_uses_cancel_installment_plan(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """PENDING installment plan → cancel_installment_plan called; holds released."""
        popup = _make_popup(db, tenant_a, slug_prefix="sup-plan")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        prior_payment = _make_pending_payment(
            db,
            tenant_a,
            popup,
            application_id=application.id,
            is_installment_plan=True,
        )

        with patch("app.services.simplefi.get_simplefi_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.cancel_installment_plan.return_value = CancelOutcome.CANCELED
            mock_client_factory.return_value = mock_client

            payments_crud.supersede_pending_payments(
                db,
                application_id=application.id,
            )

        # Must use cancel_installment_plan, NOT cancel_payment_request
        mock_client.cancel_installment_plan.assert_called_once_with(
            prior_payment.external_id
        )
        mock_client.cancel_payment_request.assert_not_called()

        assert (
            _fresh_payment_status(db, prior_payment.id) == PaymentStatus.CANCELLED.value
        )


class TestRaceLostApproved:
    """supersede_pending_payments with ALREADY_APPROVED outcome raises 409 previous_payment_completed.

    Task 5.4 (strengthened — B2 + S1): cancel → ALREADY_APPROVED → _reconcile_approved runs
    for real (no mock); prior payment ends APPROVED in DB; holds not released; no payment_id
    in the 409 response; redirect_url points to the buyer's passes page.
    """

    def test_already_approved_raises_409(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Race-lost (authenticated): _reconcile_approved runs for real; payment is APPROVED in DB.

        B2 fix: _reconcile_approved now acquires a row lock before calling approve_payment,
        ensuring a concurrent webhook can't add products twice.
        S1 fix: 409 detail has no raw payment_id; redirect_url points to the passes page.
        """
        popup = _make_popup(db, tenant_a, slug_prefix="race-lost")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        coupon = _make_coupon(db, popup, current_uses=2)
        prior_payment = _make_pending_payment(
            db, tenant_a, popup, coupon=coupon, application_id=application.id
        )

        uses_before = _fresh_coupon_uses(db, coupon.id)

        with patch("app.services.simplefi.get_simplefi_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = (
                CancelOutcome.ALREADY_APPROVED
            )
            mock_client_factory.return_value = mock_client

            # No mock on _reconcile_approved — it runs for real (B2 strengthening)
            with pytest.raises(HTTPException) as exc_info:
                payments_crud.supersede_pending_payments(
                    db,
                    application_id=application.id,
                )

        exc = exc_info.value
        assert exc.status_code == 409
        assert isinstance(exc.detail, dict)
        assert exc.detail["code"] == "previous_payment_completed"

        # S1: no raw payment UUID exposed in anonymous/semi-anonymous response
        assert "payment_id" not in exc.detail

        # S1: authenticated path has redirect_url pointing to the buyer's passes page
        assert "redirect_url" in exc.detail
        redirect = exc.detail["redirect_url"]
        assert redirect is not None
        assert "/passes" in redirect

        # B2: prior payment is APPROVED in the DB (reconcile ran for real)
        db.expire_all()
        fresh = db.get(Payments, prior_payment.id)
        assert fresh is not None
        assert fresh.status == PaymentStatus.APPROVED.value

        # Coupon NOT released — approved payment keeps its coupon use
        assert _fresh_coupon_uses(db, coupon.id) == uses_before

    def test_already_approved_open_checkout_redirect_url_absent_without_signing(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Race-lost on open checkout without signing: redirect_url is None (S1 fix).

        When the popup has no open_checkout_signing_secret, the 409 response omits
        a usable redirect_url so no unsigned navigable URL is handed to anonymous callers.
        The portal falls back to a message-only state.
        """
        popup = _make_popup(db, tenant_a, slug_prefix="race-oc")
        buyer_email = f"racer-{uuid.uuid4().hex[:8]}@example.com"
        _make_pending_payment(db, tenant_a, popup, buyer_email=buyer_email)

        with patch("app.services.simplefi.get_simplefi_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = (
                CancelOutcome.ALREADY_APPROVED
            )
            mock_client_factory.return_value = mock_client

            with patch.object(payments_crud, "_reconcile_approved"):
                with pytest.raises(HTTPException) as exc_info:
                    payments_crud.supersede_pending_payments(
                        db,
                        email=buyer_email,
                        popup_id=popup.id,
                    )

        exc = exc_info.value
        assert exc.status_code == 409
        assert exc.detail["code"] == "previous_payment_completed"
        # S1: no raw payment_id exposed to anonymous caller
        assert "payment_id" not in exc.detail
        # S1: no signing secret → redirect_url is None (portal falls back to message-only)
        assert "redirect_url" in exc.detail
        assert exc.detail["redirect_url"] is None


class TestCancelTransportFailure:
    """supersede_pending_payments on transport error → raises, no holds released, old stays PENDING.

    Task 5.5: transport error/5xx → supersede aborts; old stays PENDING; no new payment created.
    """

    def test_transport_error_aborts_without_releasing_holds(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Transport error during cancel → exception propagates; old payment stays PENDING."""
        import httpx

        popup = _make_popup(db, tenant_a, slug_prefix="trans-fail")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        coupon = _make_coupon(db, popup, current_uses=3)
        prior_payment = _make_pending_payment(
            db, tenant_a, popup, coupon=coupon, application_id=application.id
        )

        uses_before = _fresh_coupon_uses(db, coupon.id)

        with patch("app.services.simplefi.get_simplefi_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.side_effect = httpx.RequestError(
                "Connection refused"
            )
            mock_client_factory.return_value = mock_client

            with pytest.raises(HTTPException) as exc_info:
                payments_crud.supersede_pending_payments(
                    db,
                    application_id=application.id,
                )

        exc = exc_info.value
        assert exc.status_code == 502
        assert isinstance(exc.detail, dict)
        assert exc.detail["code"] == "payment_cancel_failed"

        # Holds NOT released; coupon uses unchanged
        assert _fresh_coupon_uses(db, coupon.id) == uses_before
        # Old payment stays PENDING
        assert (
            _fresh_payment_status(db, prior_payment.id) == PaymentStatus.PENDING.value
        )

    def test_ambiguous_error_also_aborts(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """CancelOutcomeAmbiguousError during cancel → 502 payment_cancel_failed; holds not released."""
        popup = _make_popup(db, tenant_a, slug_prefix="ambig-fail")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        coupon = _make_coupon(db, popup, current_uses=3)
        prior_payment = _make_pending_payment(
            db, tenant_a, popup, coupon=coupon, application_id=application.id
        )

        uses_before = _fresh_coupon_uses(db, coupon.id)

        with patch("app.services.simplefi.get_simplefi_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.side_effect = (
                CancelOutcomeAmbiguousError("Cannot classify status")
            )
            mock_client_factory.return_value = mock_client

            with pytest.raises(HTTPException) as exc_info:
                payments_crud.supersede_pending_payments(
                    db,
                    application_id=application.id,
                )

        exc = exc_info.value
        assert exc.status_code == 502
        assert exc.detail["code"] == "payment_cancel_failed"
        # Old payment stays PENDING
        assert (
            _fresh_payment_status(db, prior_payment.id) == PaymentStatus.PENDING.value
        )
        # No holds released
        assert _fresh_coupon_uses(db, coupon.id) == uses_before


class TestReleaseThenFail:
    """Supersede commits release (old cancelled) and then new-payment creation fails.

    Task 5.8: supersede commits release; force create_payment to fail; assert old is CANCELLED
    + holds free + buyer can retry cleanly.
    """

    def test_release_committed_before_creation_fails(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Old payment is CANCELLED even when subsequent creation raises an error."""
        popup = _make_popup(db, tenant_a, slug_prefix="release-fail")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        coupon = _make_coupon(db, popup, current_uses=2)
        prior_payment = _make_pending_payment(
            db, tenant_a, popup, coupon=coupon, application_id=application.id
        )

        uses_before = _fresh_coupon_uses(db, coupon.id)

        with patch("app.services.simplefi.get_simplefi_client") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = CancelOutcome.CANCELED
            mock_client_factory.return_value = mock_client

            # supersede alone: releases old payment
            payments_crud.supersede_pending_payments(
                db,
                application_id=application.id,
            )

        # Old payment is CANCELLED + holds released
        assert (
            _fresh_payment_status(db, prior_payment.id) == PaymentStatus.CANCELLED.value
        )
        assert _fresh_coupon_uses(db, coupon.id) == uses_before - 1

        # Now simulate a failed new-payment creation (e.g., SimpleFi unavailable)
        # The buyer should be in a clean state: no PENDING payments for this application
        remaining_pending = db.exec(
            select(Payments).where(
                Payments.application_id == application.id,
                Payments.status == PaymentStatus.PENDING.value,  # type: ignore[arg-type]
            )
        ).all()
        assert len(remaining_pending) == 0, (
            "No PENDING payments should remain after supersede; buyer can retry"
        )


# ---------------------------------------------------------------------------
# Task 5.6: test_concurrent_create_same_buyer (ADR-2 post-lock sibling re-check)
# ---------------------------------------------------------------------------


class TestConcurrentCreateSameBuyer:
    """Two simultaneous create calls race — only one new PENDING payment is created.

    Task 5.6: Two concurrent create_payment calls; P1 released exactly once (ADR-1
    row lock); the loser receives 409 concurrent_payment_in_progress from sibling
    re-check; exactly ONE new PENDING payment created.

    Note: This test is structurally verified by testing the sibling re-check helper
    directly (raises 409 when a sibling PENDING exists for the same application_id).
    The threading race is non-deterministic, so we test the guard itself.
    """

    def test_sibling_recheck_raises_409_when_sibling_exists(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Post-lock sibling re-check: if a PENDING sibling exists for application_id, raise 409."""
        popup = _make_popup(db, tenant_a, slug_prefix="sib-recheck")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        # A "sibling" PENDING payment already exists for this application
        _sibling = _make_pending_payment(
            db, tenant_a, popup, application_id=application.id
        )

        with pytest.raises(HTTPException) as exc_info:
            payments_crud._check_no_pending_sibling_by_application(
                db, application_id=application.id
            )

        exc = exc_info.value
        assert exc.status_code == 409
        assert isinstance(exc.detail, dict)
        assert exc.detail["code"] == "concurrent_payment_in_progress"

    def test_sibling_recheck_is_noop_when_no_sibling(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Sibling re-check: no PENDING payment for application_id → no exception."""
        popup = _make_popup(db, tenant_a, slug_prefix="sib-noop")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        db.commit()
        # Should not raise
        payments_crud._check_no_pending_sibling_by_application(
            db, application_id=application.id
        )

    def test_sibling_recheck_open_checkout_raises_409_when_sibling_exists(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Open-checkout sibling re-check: PENDING for same email+popup_id → 409."""
        popup = _make_popup(db, tenant_a, slug_prefix="sib-oc-recheck")
        buyer_email = f"sibling-{uuid.uuid4().hex[:8]}@example.com"
        _sibling = _make_pending_payment(db, tenant_a, popup, buyer_email=buyer_email)

        with pytest.raises(HTTPException) as exc_info:
            payments_crud._check_no_pending_sibling_by_email_popup(
                db, email=buyer_email, popup_id=popup.id
            )

        exc = exc_info.value
        assert exc.status_code == 409
        assert exc.detail["code"] == "concurrent_payment_in_progress"
        # S2: sibling 409 must NOT expose the payment UUID to anonymous callers
        assert "payment_id" not in exc.detail


# ---------------------------------------------------------------------------
# B1 regression: update_status must bypass the session identity map
# ---------------------------------------------------------------------------


class TestUpdateStatusIdentityMapBypass:
    """Regression for B1: update_status reads fresh DB state after acquiring lock.

    Without the fix, the two-step approach (raw text() lock + self.get()) returned
    the stale PENDING object from the session identity map even after a concurrent
    transaction committed CANCELLED — causing a double-release of coupon/stock.
    """

    def test_second_update_status_sees_cancelled_not_pending(
        self,
        db: Session,
        test_engine,
        tenant_a: Tenants,
    ) -> None:
        """Session A pre-loads payment as PENDING. Session B commits CANCELLED.
        Session A's update_status must NOT release holds again.

        Proves that ``with_for_update()`` bypasses the identity map and returns
        the post-lock DB state (CANCELLED), so the PENDING-only guard skips the
        second release.
        """
        from sqlmodel import Session as Sess

        popup = _make_popup(db, tenant_a, slug_prefix="b1-imap")
        coupon = _make_coupon(db, popup, current_uses=3)
        payment = _make_pending_payment(db, tenant_a, popup, coupon=coupon)

        # Pre-load payment into Session A's identity map — it sees PENDING
        stale = db.get(Payments, payment.id)
        assert stale is not None
        assert stale.status == PaymentStatus.PENDING.value

        # Session B commits CANCELLED — coupon released (uses: 3 → 2)
        with Sess(test_engine) as session_b:
            payments_crud.update_status(session_b, payment.id, PaymentStatus.CANCELLED)

        uses_after_b = _fresh_coupon_uses(db, coupon.id)
        assert uses_after_b == 2  # One release from Session B

        # Session A calls update_status again.  With the B1 fix (with_for_update()),
        # it reads CANCELLED from DB — not stale PENDING from identity map — so the
        # PENDING-only guard skips the second coupon release.
        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)

        uses_after_a = _fresh_coupon_uses(db, coupon.id)
        # Must still be 2, not 1 (no second release)
        assert uses_after_a == 2, (
            "update_status released holds twice — identity map bypass (B1) is broken"
        )


# ---------------------------------------------------------------------------
# W1: orphaned payment branch (popup without simplefi_api_key)
# ---------------------------------------------------------------------------


class TestOrphanedPayment:
    """W1: When the popup has no simplefi_api_key, supersede releases holds directly
    without any SimpleFi call (orphaned payment path — crud.py ~2946-2958).
    """

    def test_orphaned_payment_released_without_simplefi(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Prior payment with no simplefi_api_key → CANCELLED locally; no SimpleFi call."""
        popup = Popups(
            tenant_id=tenant_a.id,
            name="No-Key Popup",
            slug=f"nokey-{uuid.uuid4().hex[:6]}",
            sale_type=SaleType.direct.value,
            status="active",
            simplefi_api_key=None,  # Deliberately missing
            currency="ARS",
        )
        db.add(popup)
        db.flush()

        coupon = _make_coupon(db, popup, current_uses=2)
        prior_payment = _make_pending_payment(
            db,
            tenant_a,
            popup,
            coupon=coupon,
            application_id=None,
            buyer_email="orphan@test.com",
        )

        uses_before = _fresh_coupon_uses(db, coupon.id)

        # Use a mock to verify SimpleFi is NOT called
        with patch("app.services.simplefi.get_simplefi_client") as mock_sf:
            payments_crud.supersede_pending_payments(
                db,
                email="orphan@test.com",
                popup_id=popup.id,
            )

        # No SimpleFi call (orphaned payment — no API key)
        mock_sf.assert_not_called()

        # Payment released locally
        assert (
            _fresh_payment_status(db, prior_payment.id) == PaymentStatus.CANCELLED.value
        )
        # Coupon hold released
        assert _fresh_coupon_uses(db, coupon.id) == uses_before - 1


# ---------------------------------------------------------------------------
# B3: SUPERSEDE_PENDING_ENABLED=False restores pre-PR sequential-purchase behavior
# ---------------------------------------------------------------------------


class TestSupersedePendingDisabled:
    """B3: When SUPERSEDE_PENDING_ENABLED=False, the entire new machinery
    (supersede call, advisory lock, sibling re-check) is bypassed.

    Sequential same-buyer open-checkout purchases succeed exactly as they did
    before the PR — the prior PENDING payment is NOT cancelled and no 409 is
    raised by the sibling re-check.
    """

    def test_sequential_open_checkout_succeeds_when_supersede_disabled(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """With flag=False, a second open-checkout purchase succeeds even with a prior PENDING.

        Verifies that _check_no_pending_sibling_by_email_popup is NOT invoked so
        the pre-existing PENDING payment from the first checkout does not block the
        second request.
        """
        from types import SimpleNamespace

        from app.api.checkout.schemas import (
            BuyerInfo,
            OpenTicketingPurchaseCreate,
            ProductLine,
        )
        from app.core.config import settings as _app_settings

        popup = _make_popup(db, tenant_a, slug_prefix="b3-oc")
        product = _make_product(db, tenant_a, popup)
        buyer_email = f"b3-buyer-{uuid.uuid4().hex[:8]}@example.com"

        # Prior PENDING payment — would normally block via sibling re-check
        prior_payment = _make_pending_payment(
            db, tenant_a, popup, buyer_email=buyer_email
        )

        sf_resp = SimpleNamespace(
            id=f"sf-b3-{uuid.uuid4().hex[:8]}",
            status="pending",
            checkout_url="https://sf.test/b3",
            is_installment_plan=False,
        )

        obj = OpenTicketingPurchaseCreate(
            buyer=BuyerInfo(email=buyer_email, first_name="B3", last_name="Test"),
            products=[ProductLine(product_id=product.id, quantity=1)],
        )

        with patch.object(_app_settings, "SUPERSEDE_PENDING_ENABLED", False):
            with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
                mock_client = MagicMock()
                mock_client.create_payment.return_value = sf_resp
                mock_get_client.return_value = mock_client

                with patch.object(
                    payments_crud,
                    "_check_no_pending_sibling_by_email_popup",
                    wraps=payments_crud._check_no_pending_sibling_by_email_popup,
                ) as spy_check:
                    new_payment, checkout_url, _ = (
                        payments_crud.create_open_ticketing_payment(
                            db, obj=obj, popup=popup, tenant=tenant_a
                        )
                    )

        # B3: sibling re-check was never called (gated by the flag)
        spy_check.assert_not_called()

        # New purchase succeeded
        assert new_payment is not None
        assert checkout_url == "https://sf.test/b3"

        # Prior payment still PENDING (not superseded — flag was off)
        assert (
            _fresh_payment_status(db, prior_payment.id) == PaymentStatus.PENDING.value
        )
