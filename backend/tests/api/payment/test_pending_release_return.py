"""Tests for release-on-return backend: TASK-01 shared-core equivalence, TASK-05..07.

TDD phase: RED written before implementation.

Tasks covered:
  TASK-01 — _supersede_located_pending shared-core equivalence + idempotency
  TASK-05 — release_pending_open / release_pending_authenticated CRUD entrypoints
  TASK-06 — POST /checkout/{slug}/pending/release integration (anonymous)
  TASK-07 — POST /payments/my/pending/release integration (authenticated)
"""

import uuid
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.coupon.models import Coupons
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentSource, PaymentStatus
from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.services.simplefi.client import CancelOutcome

# ---------------------------------------------------------------------------
# Shared helpers (copied from test_pending_hold_pr2 to remain autonomous)
# ---------------------------------------------------------------------------

SIGNING_SECRET = "test-signing-secret-for-return-release-tests"


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    slug_prefix: str = "ret",
    with_signing_secret: bool = True,
    commit: bool = False,
) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Return Release Popup {slug_prefix}",
        slug=f"{slug_prefix}-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.direct.value,
        status="active",
        simplefi_api_key="test_simplefi_key",
        currency="ARS",
        open_checkout_signing_secret=SIGNING_SECRET if with_signing_secret else None,
    )
    db.add(popup)
    if commit:
        db.commit()
        db.refresh(popup)
    else:
        db.flush()
    return popup


def _make_human(
    db: Session, tenant: Tenants, *, email: str | None = None, commit: bool = False
) -> Humans:
    email = email or f"ret-{uuid.uuid4().hex[:8]}@example.com"
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=email,
        first_name="Return",
        last_name="Tester",
    )
    db.add(human)
    if commit:
        db.commit()
        db.refresh(human)
    else:
        db.flush()
    return human


def _make_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    commit: bool = False,
) -> Applications:
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
        referral="test",
    )
    db.add(application)
    if commit:
        db.commit()
        db.refresh(application)
    else:
        db.flush()
    return application


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
        code=f"RET{uuid.uuid4().hex[:6].upper()}",
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
    external_id: str | None = None,
) -> Payments:
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
        external_id=external_id or f"ext-{uuid.uuid4().hex[:12]}",
    )
    if buyer_email:
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
# TASK-01: _supersede_located_pending shared-core equivalence
# ---------------------------------------------------------------------------


class TestSupersedeLocatedPendingCore:
    """Unit tests for _supersede_located_pending shared helper.

    Spec: TASK-01 — purely extractive refactor; the located-pending core must
    produce identical outcomes to the pre-existing supersede_pending_payments
    wrapper.
    """

    def test_pending_transitions_to_cancelled(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Happy path: PENDING → CANCELLED, coupon released via shared core."""
        popup = _make_popup(db, tenant_a, slug_prefix="slp01")
        coupon = _make_coupon(db, popup, current_uses=3)
        prior = _make_pending_payment(db, tenant_a, popup, coupon=coupon)

        uses_before = _fresh_coupon_uses(db, coupon.id)
        assert uses_before == 3

        with patch("app.services.simplefi.get_simplefi_client") as mock_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = CancelOutcome.CANCELED
            mock_factory.return_value = mock_client

            payments_crud._supersede_located_pending(db, prior, anonymous=True)

        assert _fresh_payment_status(db, prior.id) == PaymentStatus.CANCELLED.value
        assert _fresh_coupon_uses(db, coupon.id) == uses_before - 1

    def test_already_cancelled_noop(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Second caller with a now-CANCELLED payment: update_status row-lock guard skips release.

        Simulates the idempotency invariant: _supersede_located_pending called on
        a payment that is already CANCELLED must not double-release holds.
        """
        popup = _make_popup(db, tenant_a, slug_prefix="slp02")
        coupon = _make_coupon(db, popup, current_uses=2)
        prior = _make_pending_payment(db, tenant_a, popup, coupon=coupon)

        # Manually cancel the payment first (as if a webhook or sweeper won the race)
        payments_crud.update_status(db, prior.id, PaymentStatus.CANCELLED)
        uses_after_first_release = _fresh_coupon_uses(db, coupon.id)
        assert uses_after_first_release == 1  # decremented once

        # Now call the shared core on the already-CANCELLED payment object.
        # We must reload it to get the terminal status.
        db.expire_all()
        stale_prior = db.get(Payments, prior.id)
        assert stale_prior is not None

        with patch("app.services.simplefi.get_simplefi_client") as mock_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = CancelOutcome.CANCELED
            mock_factory.return_value = mock_client

            # update_status inside will read terminal status via FOR UPDATE and skip release
            payments_crud._supersede_located_pending(db, stale_prior, anonymous=True)

        # Coupon NOT decremented again
        assert _fresh_coupon_uses(db, coupon.id) == uses_after_first_release

    def test_already_approved_raises_409(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """ALREADY_APPROVED from SimpleFi → 409 previous_payment_completed, no payment_id."""
        popup = _make_popup(db, tenant_a, slug_prefix="slp03")
        prior = _make_pending_payment(db, tenant_a, popup)

        with patch("app.services.simplefi.get_simplefi_client") as mock_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = (
                CancelOutcome.ALREADY_APPROVED
            )
            mock_factory.return_value = mock_client
            mock_reconcile = MagicMock()
            with patch.object(payments_crud, "_reconcile_approved", mock_reconcile):
                with pytest.raises(HTTPException) as exc_info:
                    payments_crud._supersede_located_pending(db, prior, anonymous=True)

        # _reconcile_approved MUST be called exactly once with the located prior
        mock_reconcile.assert_called_once_with(db, prior)

        assert exc_info.value.status_code == 409
        detail = exc_info.value.detail
        assert detail["code"] == "previous_payment_completed"
        # S1: no payment identifier in anonymous 409 body
        assert "payment_id" not in detail
        assert str(prior.id) not in str(detail)

    def test_transport_failure_raises_502(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """SimpleFi transport error → 502 payment_cancel_failed, no release."""
        popup = _make_popup(db, tenant_a, slug_prefix="slp04")
        coupon = _make_coupon(db, popup, current_uses=1)
        prior = _make_pending_payment(db, tenant_a, popup, coupon=coupon)

        with patch("app.services.simplefi.get_simplefi_client") as mock_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.side_effect = Exception("network error")
            mock_factory.return_value = mock_client

            with pytest.raises(HTTPException) as exc_info:
                payments_crud._supersede_located_pending(db, prior, anonymous=True)

        assert exc_info.value.status_code == 502
        assert exc_info.value.detail["code"] == "payment_cancel_failed"
        # Holds must NOT be released on transport error
        assert _fresh_payment_status(db, prior.id) == PaymentStatus.PENDING.value
        assert _fresh_coupon_uses(db, coupon.id) == 1

    def test_shared_core_equivalence_with_wrapper(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Shared-core equivalence: same fixture produces identical DB state via wrapper and direct core.

        Creates two parallel fixtures; processes one through the wrapper and the
        other through the core directly; asserts both end in identical status.
        """
        popup = _make_popup(db, tenant_a, slug_prefix="slp05")
        coupon_a = _make_coupon(db, popup, current_uses=5)
        coupon_b = _make_coupon(db, popup, current_uses=5)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)

        payment_via_wrapper = _make_pending_payment(
            db, tenant_a, popup, coupon=coupon_a, application_id=application.id
        )
        _make_pending_payment(
            db, tenant_a, popup, coupon=coupon_b, application_id=application.id
        )

        def _cancel_mock():
            mock = MagicMock()
            mock.cancel_payment_request.return_value = CancelOutcome.CANCELED
            return mock

        # Via wrapper
        with patch(
            "app.services.simplefi.get_simplefi_client", return_value=_cancel_mock()
        ):
            payments_crud.supersede_pending_payments(db, application_id=application.id)

        # Via core directly (locate then call)
        db.expire_all()
        # Use a second application/payment with the same popup to exercise the core
        human2 = _make_human(db, tenant_a)
        application2 = _make_application(db, tenant_a, popup, human2)
        coupon_c = _make_coupon(db, popup, current_uses=5)
        payment_via_core2 = _make_pending_payment(
            db, tenant_a, popup, coupon=coupon_c, application_id=application2.id
        )
        with patch(
            "app.services.simplefi.get_simplefi_client", return_value=_cancel_mock()
        ):
            payments_crud._supersede_located_pending(
                db, payment_via_core2, anonymous=False
            )

        # Both payments end in CANCELLED
        assert (
            _fresh_payment_status(db, payment_via_wrapper.id)
            == PaymentStatus.CANCELLED.value
        )
        assert (
            _fresh_payment_status(db, payment_via_core2.id)
            == PaymentStatus.CANCELLED.value
        )
        # Both coupons released exactly once
        assert _fresh_coupon_uses(db, coupon_a.id) == 4
        assert _fresh_coupon_uses(db, coupon_c.id) == 4

    def test_already_approved_builds_signed_redirect_url(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """ALREADY_APPROVED with signing secret + success URL → 409 detail contains redirect_url.

        Regression guard for the build_thank_you_payload contract violations
        (missing exp=, wrong item keys, str vs float amount_total) that would
        cause a TypeError at runtime when both popup fields are configured.
        """
        popup = _make_popup(db, tenant_a, slug_prefix="slp06")
        # Configure the popup for signed redirect (both fields required)
        popup.open_checkout_signing_secret = "test-secret-32-chars-long-xxxxxxxx"
        popup.open_checkout_success_url = "https://example.com/thank-you"
        db.add(popup)
        db.flush()
        prior = _make_pending_payment(db, tenant_a, popup)

        with patch("app.services.simplefi.get_simplefi_client") as mock_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = (
                CancelOutcome.ALREADY_APPROVED
            )
            mock_factory.return_value = mock_client
            with patch.object(payments_crud, "_reconcile_approved"):
                with pytest.raises(HTTPException) as exc_info:
                    payments_crud._supersede_located_pending(db, prior, anonymous=True)

        detail = exc_info.value.detail
        assert exc_info.value.status_code == 409
        assert detail["code"] == "previous_payment_completed"
        # redirect_url must be present and be a signed URL (non-None, non-empty)
        redirect_url = detail.get("redirect_url")
        assert redirect_url is not None, (
            "redirect_url must be present when secret+URL configured"
        )
        assert "example.com/thank-you" in redirect_url
        # Signed URL carries base64 payload + sig — must not contain the raw payment UUID
        assert str(prior.id) not in redirect_url


# ---------------------------------------------------------------------------
# TASK-05: release_pending_open / release_pending_authenticated CRUD
# ---------------------------------------------------------------------------


class TestReleasePendingOpen:
    """Unit tests for release_pending_open CRUD entrypoint.

    Spec: TASK-05 — validates proof, calls shared core, returns ReleaseResult.
    """

    def test_valid_proof_pending_exists_released(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Valid cid+sig + PENDING payment → released=True, payment CANCELLED."""
        popup = _make_popup(db, tenant_a, slug_prefix="rpo01")
        email = f"buyer-{uuid.uuid4().hex[:6]}@example.com"
        coupon = _make_coupon(db, popup, current_uses=3)
        prior = _make_pending_payment(
            db, tenant_a, popup, coupon=coupon, buyer_email=email
        )

        with (
            patch.object(
                payments_crud,
                "_validate_cart_continuity_proof",
                return_value=True,
            ),
            patch("app.services.simplefi.get_simplefi_client") as mock_factory,
        ):
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = CancelOutcome.CANCELED
            mock_factory.return_value = mock_client

            result = payments_crud.release_pending_open(
                db,
                popup=popup,
                email=email,
                cid=uuid.uuid4(),
                sig="valid-sig",
            )

        assert result.released is True
        assert _fresh_payment_status(db, prior.id) == PaymentStatus.CANCELLED.value
        assert _fresh_coupon_uses(db, coupon.id) == 2

    def test_invalid_proof_returns_false_no_simplefi(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Invalid proof → released=False, 200, NO SimpleFi call."""
        popup = _make_popup(db, tenant_a, slug_prefix="rpo02")
        email = f"buyer-{uuid.uuid4().hex[:6]}@example.com"
        coupon = _make_coupon(db, popup, current_uses=2)
        prior = _make_pending_payment(
            db, tenant_a, popup, coupon=coupon, buyer_email=email
        )

        with (
            patch.object(
                payments_crud,
                "_validate_cart_continuity_proof",
                return_value=False,
            ),
            patch("app.services.simplefi.get_simplefi_client") as mock_factory,
        ):
            result = payments_crud.release_pending_open(
                db,
                popup=popup,
                email=email,
                cid=None,
                sig=None,
            )
            # SimpleFi must NOT be called on invalid proof
            mock_factory.assert_not_called()

        assert result.released is False
        # Payment status unchanged
        assert _fresh_payment_status(db, prior.id) == PaymentStatus.PENDING.value
        assert _fresh_coupon_uses(db, coupon.id) == 2

    def test_valid_proof_no_pending_returns_false(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Valid proof + no PENDING payment → released=False, 200 no-op."""
        popup = _make_popup(db, tenant_a, slug_prefix="rpo03")
        email = f"nopending-{uuid.uuid4().hex[:6]}@example.com"

        with (
            patch.object(
                payments_crud,
                "_validate_cart_continuity_proof",
                return_value=True,
            ),
            patch("app.services.simplefi.get_simplefi_client") as mock_factory,
        ):
            result = payments_crud.release_pending_open(
                db,
                popup=popup,
                email=email,
                cid=uuid.uuid4(),
                sig="valid-sig",
            )
            mock_factory.assert_not_called()

        assert result.released is False

    def test_enumeration_safety_indistinguishable_responses(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Enumeration safety: invalid-proof+no-pending, invalid-proof+pending, valid-proof+no-pending
        all produce released=False (identical 200 body shape).
        """
        popup = _make_popup(db, tenant_a, slug_prefix="rpo04")
        email_with_pending = f"hasp-{uuid.uuid4().hex[:6]}@example.com"
        email_no_pending = f"nop-{uuid.uuid4().hex[:6]}@example.com"
        _make_pending_payment(db, tenant_a, popup, buyer_email=email_with_pending)

        with patch.object(
            payments_crud, "_validate_cart_continuity_proof", return_value=False
        ):
            r1 = payments_crud.release_pending_open(
                db, popup=popup, email=email_no_pending, cid=None, sig=None
            )
            r2 = payments_crud.release_pending_open(
                db, popup=popup, email=email_with_pending, cid=None, sig=None
            )

        with patch.object(
            payments_crud, "_validate_cart_continuity_proof", return_value=True
        ):
            r3 = payments_crud.release_pending_open(
                db, popup=popup, email=email_no_pending, cid=uuid.uuid4(), sig="sig"
            )

        # All three must be identical — released=False
        assert r1.released is False
        assert r2.released is False
        assert r3.released is False

    def test_already_approved_race_propagates_409(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """ALREADY_APPROVED at return time → 409 previous_payment_completed, no payment_id."""
        popup = _make_popup(db, tenant_a, slug_prefix="rpo05")
        email = f"race-{uuid.uuid4().hex[:6]}@example.com"
        prior = _make_pending_payment(db, tenant_a, popup, buyer_email=email)

        mock_reconcile = MagicMock()
        with (
            patch.object(
                payments_crud,
                "_validate_cart_continuity_proof",
                return_value=True,
            ),
            patch("app.services.simplefi.get_simplefi_client") as mock_factory,
            patch.object(payments_crud, "_reconcile_approved", mock_reconcile),
        ):
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = (
                CancelOutcome.ALREADY_APPROVED
            )
            mock_factory.return_value = mock_client

            with pytest.raises(HTTPException) as exc_info:
                payments_crud.release_pending_open(
                    db, popup=popup, email=email, cid=uuid.uuid4(), sig="valid-sig"
                )

        # _reconcile_approved MUST be called exactly once with the located prior
        mock_reconcile.assert_called_once_with(db, prior)

        assert exc_info.value.status_code == 409
        detail = exc_info.value.detail
        assert detail["code"] == "previous_payment_completed"
        # Anonymous path: no raw payment id
        assert "payment_id" not in detail
        assert str(prior.id) not in str(detail)

    def test_transport_failure_raises_502_nothing_released(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """SimpleFi transport failure → 502 payment_cancel_failed, holds intact."""
        popup = _make_popup(db, tenant_a, slug_prefix="rpo06")
        email = f"fail-{uuid.uuid4().hex[:6]}@example.com"
        coupon = _make_coupon(db, popup, current_uses=2)
        prior = _make_pending_payment(
            db, tenant_a, popup, coupon=coupon, buyer_email=email
        )

        with (
            patch.object(
                payments_crud,
                "_validate_cart_continuity_proof",
                return_value=True,
            ),
            patch("app.services.simplefi.get_simplefi_client") as mock_factory,
        ):
            mock_client = MagicMock()
            mock_client.cancel_payment_request.side_effect = Exception("timeout")
            mock_factory.return_value = mock_client

            with pytest.raises(HTTPException) as exc_info:
                payments_crud.release_pending_open(
                    db, popup=popup, email=email, cid=uuid.uuid4(), sig="valid-sig"
                )

        assert exc_info.value.status_code == 502
        assert exc_info.value.detail["code"] == "payment_cancel_failed"
        # Holds must remain intact
        assert _fresh_payment_status(db, prior.id) == PaymentStatus.PENDING.value
        assert _fresh_coupon_uses(db, coupon.id) == 2

    def test_flag_disabled_returns_false_no_simplefi(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """SUPERSEDE_PENDING_ENABLED=False → released=False, no SimpleFi call."""
        from app.core.config import settings as _app_settings

        popup = _make_popup(db, tenant_a, slug_prefix="rpo07")
        email = f"flag-{uuid.uuid4().hex[:6]}@example.com"
        _make_pending_payment(db, tenant_a, popup, buyer_email=email)

        with (
            patch.object(_app_settings, "SUPERSEDE_PENDING_ENABLED", False),
            patch("app.services.simplefi.get_simplefi_client") as mock_factory,
        ):
            result = payments_crud.release_pending_open(
                db, popup=popup, email=email, cid=uuid.uuid4(), sig="valid-sig"
            )
            mock_factory.assert_not_called()

        assert result.released is False

    def test_concurrent_release_and_webhook_exactly_once(
        self,
        db: Session,
        test_engine,
        tenant_a: Tenants,
    ) -> None:
        """Concurrent return-release + update_status → coupon released exactly once (ADR-1).

        This test verifies the idempotency invariant: two concurrent calls that both
        see the payment as PENDING can only release holds once due to the FOR UPDATE
        row lock in update_status. We test this sequentially (T1 first, then T2)
        to avoid threading race conditions in CI — the ADR-1 row lock is already
        verified by test_double_release_protection in test_pending_hold_pr2.py.

        What we verify here: release_pending_open called AFTER update_status has
        already cancelled the payment returns released=False (no double-release).
        """
        popup = _make_popup(db, tenant_a, slug_prefix="rpo08")
        email = f"conc-{uuid.uuid4().hex[:6]}@example.com"
        coupon = _make_coupon(db, popup, current_uses=5)
        prior = _make_pending_payment(
            db, tenant_a, popup, coupon=coupon, buyer_email=email
        )

        uses_before = _fresh_coupon_uses(db, coupon.id)
        assert uses_before == 5

        # Step 1: webhook/sweeper cancels the payment first
        payments_crud.update_status(db, prior.id, PaymentStatus.CANCELLED)
        uses_after_first_release = _fresh_coupon_uses(db, coupon.id)
        assert uses_after_first_release == 4  # decremented once

        # Step 2: return-release fires (e.g., slower network path, arrives after webhook)
        with (
            patch.object(
                payments_crud,
                "_validate_cart_continuity_proof",
                return_value=True,
            ),
            patch("app.services.simplefi.get_simplefi_client") as mock_factory,
        ):
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = CancelOutcome.CANCELED
            mock_factory.return_value = mock_client

            result = payments_crud.release_pending_open(
                db,
                popup=popup,
                email=email,
                cid=uuid.uuid4(),
                sig="valid-sig",
            )
            # The payment is already CANCELLED — _find_pending_by_email_popup returns None
            # (query filters for PENDING only) so we get released=False with no SimpleFi call
            mock_factory.assert_not_called()

        assert result.released is False
        # Coupon was NOT released a second time
        assert _fresh_coupon_uses(db, coupon.id) == uses_after_first_release
        assert _fresh_payment_status(db, prior.id) == PaymentStatus.CANCELLED.value


class TestReleasePendingAuthenticated:
    """Unit tests for release_pending_authenticated CRUD entrypoint.

    Spec: TASK-05 — verifies ownership, calls shared core.
    """

    def test_owned_application_pending_released(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Valid auth, owned application, PENDING → released=True."""
        popup = _make_popup(db, tenant_a, slug_prefix="rpa01")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        coupon = _make_coupon(db, popup, current_uses=4)
        prior = _make_pending_payment(
            db, tenant_a, popup, coupon=coupon, application_id=application.id
        )

        with patch("app.services.simplefi.get_simplefi_client") as mock_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = CancelOutcome.CANCELED
            mock_factory.return_value = mock_client

            result = payments_crud.release_pending_authenticated(
                db,
                application_id=application.id,
                human_id=human.id,
            )

        assert result.released is True
        assert _fresh_payment_status(db, prior.id) == PaymentStatus.CANCELLED.value
        assert _fresh_coupon_uses(db, coupon.id) == 3

    def test_application_not_owned_raises_404(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Application not owned by human → 404, enumeration-safe."""
        popup = _make_popup(db, tenant_a, slug_prefix="rpa02")
        owner = _make_human(db, tenant_a)
        intruder = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, owner)

        with pytest.raises(HTTPException) as exc_info:
            payments_crud.release_pending_authenticated(
                db,
                application_id=application.id,
                human_id=intruder.id,
            )

        assert exc_info.value.status_code == 404

    def test_no_pending_for_application_returns_false(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Owned application but no PENDING payment → released=False, no SimpleFi."""
        popup = _make_popup(db, tenant_a, slug_prefix="rpa03")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        # No payment created

        with patch("app.services.simplefi.get_simplefi_client") as mock_factory:
            result = payments_crud.release_pending_authenticated(
                db,
                application_id=application.id,
                human_id=human.id,
            )
            mock_factory.assert_not_called()

        assert result.released is False

    def test_flag_disabled_returns_false(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """SUPERSEDE_PENDING_ENABLED=False → released=False, no SimpleFi."""
        from app.core.config import settings as _app_settings

        popup = _make_popup(db, tenant_a, slug_prefix="rpa04")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        _make_pending_payment(db, tenant_a, popup, application_id=application.id)

        with (
            patch.object(_app_settings, "SUPERSEDE_PENDING_ENABLED", False),
            patch("app.services.simplefi.get_simplefi_client") as mock_factory,
        ):
            result = payments_crud.release_pending_authenticated(
                db,
                application_id=application.id,
                human_id=human.id,
            )
            mock_factory.assert_not_called()

        assert result.released is False

    def test_already_approved_race_raises_409(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """ALREADY_APPROVED at return time (auth) → 409 previous_payment_completed, no raw id."""
        popup = _make_popup(db, tenant_a, slug_prefix="rpa05")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        prior = _make_pending_payment(
            db, tenant_a, popup, application_id=application.id
        )

        with (
            patch("app.services.simplefi.get_simplefi_client") as mock_factory,
            patch.object(payments_crud, "_reconcile_approved"),
        ):
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = (
                CancelOutcome.ALREADY_APPROVED
            )
            mock_factory.return_value = mock_client

            with pytest.raises(HTTPException) as exc_info:
                payments_crud.release_pending_authenticated(
                    db,
                    application_id=application.id,
                    human_id=human.id,
                )

        assert exc_info.value.status_code == 409
        detail = exc_info.value.detail
        assert detail["code"] == "previous_payment_completed"
        # No raw payment UUID in authenticated 409 body
        assert "payment_id" not in detail
        assert str(prior.id) not in str(detail)

    def test_transport_failure_raises_502(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Transport failure → 502 payment_cancel_failed, no release."""
        popup = _make_popup(db, tenant_a, slug_prefix="rpa06")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        coupon = _make_coupon(db, popup, current_uses=2)
        prior = _make_pending_payment(
            db, tenant_a, popup, coupon=coupon, application_id=application.id
        )

        with patch("app.services.simplefi.get_simplefi_client") as mock_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.side_effect = Exception("timeout")
            mock_factory.return_value = mock_client

            with pytest.raises(HTTPException) as exc_info:
                payments_crud.release_pending_authenticated(
                    db,
                    application_id=application.id,
                    human_id=human.id,
                )

        assert exc_info.value.status_code == 502
        assert exc_info.value.detail["code"] == "payment_cancel_failed"
        assert _fresh_payment_status(db, prior.id) == PaymentStatus.PENDING.value
        assert _fresh_coupon_uses(db, coupon.id) == 2


# ---------------------------------------------------------------------------
# TASK-06/07: HTTP integration tests
# ---------------------------------------------------------------------------


class TestReleasePendingOpenEndpoint:
    """Integration tests for POST /checkout/{slug}/pending/release (TASK-06).

    Uses the TestClient fixture.  Spec: TASK-06.
    """

    def _tenant_headers(self, tenant: Tenants) -> dict:
        return {"X-Tenant-Id": str(tenant.id)}

    def test_valid_proof_200_released_true(
        self,
        client,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """POST with valid proof → 200 {released: true}."""
        popup = _make_popup(db, tenant_a, slug_prefix="ep01", commit=True)
        email = f"ep01-{uuid.uuid4().hex[:6]}@example.com"
        _make_pending_payment(db, tenant_a, popup, buyer_email=email)

        with (
            patch.object(
                payments_crud,
                "_validate_cart_continuity_proof",
                return_value=True,
            ),
            patch("app.services.simplefi.get_simplefi_client") as mock_factory,
        ):
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = CancelOutcome.CANCELED
            mock_factory.return_value = mock_client

            resp = client.post(
                f"/api/v1/checkout/{popup.slug}/pending/release",
                json={
                    "email": email,
                    "cid": str(uuid.uuid4()),
                    "sig": "valid-sig",
                },
                headers=self._tenant_headers(tenant_a),
            )

        assert resp.status_code == 200
        assert resp.json() == {"released": True}

    def test_invalid_proof_200_released_false(
        self,
        client,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """POST with invalid proof → 200 {released: false} (enumeration-safe)."""
        popup = _make_popup(db, tenant_a, slug_prefix="ep02", commit=True)
        email = f"ep02-{uuid.uuid4().hex[:6]}@example.com"
        _make_pending_payment(db, tenant_a, popup, buyer_email=email)

        with patch.object(
            payments_crud, "_validate_cart_continuity_proof", return_value=False
        ):
            resp = client.post(
                f"/api/v1/checkout/{popup.slug}/pending/release",
                json={"email": email, "cid": str(uuid.uuid4()), "sig": "bad-sig"},
                headers=self._tenant_headers(tenant_a),
            )

        assert resp.status_code == 200
        # Enumeration-safe: response body must be byte-identical across all false paths
        assert resp.text == '{"released":false}'
        assert resp.json() == {"released": False}

    def test_valid_proof_no_pending_200_released_false(
        self,
        client,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Valid proof + no PENDING → 200 {released: false}."""
        popup = _make_popup(db, tenant_a, slug_prefix="ep03", commit=True)
        email = f"ep03-{uuid.uuid4().hex[:6]}@example.com"

        with patch.object(
            payments_crud, "_validate_cart_continuity_proof", return_value=True
        ):
            resp = client.post(
                f"/api/v1/checkout/{popup.slug}/pending/release",
                json={"email": email, "cid": str(uuid.uuid4()), "sig": "valid-sig"},
                headers=self._tenant_headers(tenant_a),
            )

        assert resp.status_code == 200
        # Enumeration-safe: response body must be byte-identical across all false paths
        assert resp.text == '{"released":false}'
        assert resp.json() == {"released": False}

    def test_already_approved_race_409(
        self,
        client,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """ALREADY_APPROVED → 409 previous_payment_completed, no payment_id."""
        popup = _make_popup(db, tenant_a, slug_prefix="ep04", commit=True)
        email = f"ep04-{uuid.uuid4().hex[:6]}@example.com"
        prior = _make_pending_payment(db, tenant_a, popup, buyer_email=email)

        with (
            patch.object(
                payments_crud, "_validate_cart_continuity_proof", return_value=True
            ),
            patch("app.services.simplefi.get_simplefi_client") as mock_factory,
            patch.object(payments_crud, "_reconcile_approved"),
        ):
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = (
                CancelOutcome.ALREADY_APPROVED
            )
            mock_factory.return_value = mock_client

            resp = client.post(
                f"/api/v1/checkout/{popup.slug}/pending/release",
                json={"email": email, "cid": str(uuid.uuid4()), "sig": "valid-sig"},
                headers=self._tenant_headers(tenant_a),
            )

        assert resp.status_code == 409
        body = resp.json()["detail"]
        assert body["code"] == "previous_payment_completed"
        assert "payment_id" not in body
        assert str(prior.id) not in str(body)

    def test_simplefi_failure_502(
        self,
        client,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """SimpleFi transport failure → 502 payment_cancel_failed."""
        popup = _make_popup(db, tenant_a, slug_prefix="ep05", commit=True)
        email = f"ep05-{uuid.uuid4().hex[:6]}@example.com"
        _make_pending_payment(db, tenant_a, popup, buyer_email=email)

        with (
            patch.object(
                payments_crud, "_validate_cart_continuity_proof", return_value=True
            ),
            patch("app.services.simplefi.get_simplefi_client") as mock_factory,
        ):
            mock_client = MagicMock()
            mock_client.cancel_payment_request.side_effect = Exception("network error")
            mock_factory.return_value = mock_client

            resp = client.post(
                f"/api/v1/checkout/{popup.slug}/pending/release",
                json={"email": email, "cid": str(uuid.uuid4()), "sig": "valid-sig"},
                headers=self._tenant_headers(tenant_a),
            )

        assert resp.status_code == 502
        assert resp.json()["detail"]["code"] == "payment_cancel_failed"


class TestReleasePendingAuthenticatedEndpoint:
    """Integration tests for POST /payments/my/pending/release (TASK-07).

    Uses the TestClient fixture.  Spec: TASK-07.
    """

    def test_valid_auth_owned_pending_200_released_true(
        self,
        client,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Valid auth token, owned application, PENDING → 200 {released: true}."""
        from app.core.security import create_access_token

        popup = _make_popup(db, tenant_a, slug_prefix="ap01", commit=True)
        human = _make_human(db, tenant_a, commit=True)
        application = _make_application(db, tenant_a, popup, human, commit=True)
        _make_pending_payment(db, tenant_a, popup, application_id=application.id)

        token = create_access_token(subject=human.id, token_type="human")

        with patch("app.services.simplefi.get_simplefi_client") as mock_factory:
            mock_client = MagicMock()
            mock_client.cancel_payment_request.return_value = CancelOutcome.CANCELED
            mock_factory.return_value = mock_client

            resp = client.post(
                "/api/v1/payments/my/pending/release",
                json={"application_id": str(application.id)},
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-Tenant-Id": str(tenant_a.id),
                },
            )

        assert resp.status_code == 200
        assert resp.json() == {"released": True}

    def test_invalid_token_401(
        self,
        client,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Invalid/absent token → 401 from standard guard."""
        resp = client.post(
            "/api/v1/payments/my/pending/release",
            json={"application_id": str(uuid.uuid4())},
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 401

    def test_application_not_owned_404(
        self,
        client,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Application not owned by human → 404 (enumeration-safe)."""
        from app.core.security import create_access_token

        popup = _make_popup(db, tenant_a, slug_prefix="ap03", commit=True)
        owner = _make_human(db, tenant_a, commit=True)
        intruder = _make_human(db, tenant_a, commit=True)
        application = _make_application(db, tenant_a, popup, owner, commit=True)

        token = create_access_token(subject=intruder.id, token_type="human")
        resp = client.post(
            "/api/v1/payments/my/pending/release",
            json={"application_id": str(application.id)},
            headers={
                "Authorization": f"Bearer {token}",
                "X-Tenant-Id": str(tenant_a.id),
            },
        )

        assert resp.status_code == 404

    def test_no_pending_200_released_false(
        self,
        client,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Owned application + no PENDING → 200 {released: false}."""
        from app.core.security import create_access_token

        popup = _make_popup(db, tenant_a, slug_prefix="ap04", commit=True)
        human = _make_human(db, tenant_a, commit=True)
        application = _make_application(db, tenant_a, popup, human, commit=True)

        token = create_access_token(subject=human.id, token_type="human")
        resp = client.post(
            "/api/v1/payments/my/pending/release",
            json={"application_id": str(application.id)},
            headers={
                "Authorization": f"Bearer {token}",
                "X-Tenant-Id": str(tenant_a.id),
            },
        )

        assert resp.status_code == 200
        assert resp.json() == {"released": False}
