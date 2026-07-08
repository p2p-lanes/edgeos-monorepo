"""Tests for pending-payment sweeper (PR 3): tasks 5.9, 5.10, 5.11.

TDD phase: RED — written BEFORE implementation.

Coverage:
  5.9  Sweeper reconciliation matrix (stale+expired, stale+approved,
        stale+still-pending, status-fetch-failure, orphaned)
  5.10 Cross-tenant sweep (both tenants processed in one run)
  5.11 Overlap guard (second run under held advisory lock is skipped)
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

from sqlalchemy import text
from sqlmodel import Session

from app.api.coupon.models import Coupons
from app.api.payment.crud import payments_crud
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentSource, PaymentStatus
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.services.pending_payment_sweeper import (  # NOT YET CREATED — RED
    SWEEP_ADVISORY_LOCK_KEY,
    sweep_pending_payments,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

STALE_MINUTES = 20


def _make_popup_with_key(
    db: Session, tenant: Tenants, *, slug_prefix: str = "swp"
) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Sweep Test Popup {slug_prefix}",
        slug=f"{slug_prefix}-{uuid.uuid4().hex[:6]}",
        sale_type="direct",
        status="active",
        simplefi_api_key="swp_test_key",
        currency="ARS",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_popup_no_key(
    db: Session, tenant: Tenants, *, slug_prefix: str = "swp-nokey"
) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Sweep No Key Popup {slug_prefix}",
        slug=f"{slug_prefix}-{uuid.uuid4().hex[:6]}",
        sale_type="direct",
        status="active",
        simplefi_api_key=None,
        currency="ARS",
    )
    db.add(popup)
    db.flush()
    return popup


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
        code=f"SWP{uuid.uuid4().hex[:6].upper()}",
        discount_value=10,
        is_active=True,
        current_uses=current_uses,
        max_uses=max_uses,
    )
    db.add(coupon)
    db.flush()
    return coupon


def _make_stale_pending_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    stale_minutes: int = 30,
    coupon: Coupons | None = None,
    application_id: uuid.UUID | None = None,
    is_installment_plan: bool = False,
    external_id: str | None = None,
) -> Payments:
    """Create a PENDING SimpleFi payment with created_at in the past."""
    stale_at = datetime.now(UTC) - timedelta(minutes=stale_minutes)
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
        external_id=external_id or f"swp-ext-{uuid.uuid4().hex[:12]}",
        created_at=stale_at,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def _make_recent_pending_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
) -> Payments:
    """Create a PENDING payment that is NOT stale (created just now)."""
    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        status=PaymentStatus.PENDING.value,
        amount=Decimal("50"),
        currency="ARS",
        source=PaymentSource.SIMPLEFI.value,
        external_id=f"recent-ext-{uuid.uuid4().hex[:12]}",
        created_at=datetime.now(UTC),
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def _fresh_status(db: Session, payment_id: uuid.UUID) -> str:
    db.expire_all()
    p = db.get(Payments, payment_id)
    assert p is not None
    return str(p.status)


def _fresh_coupon_uses(db: Session, coupon_id: uuid.UUID) -> int:
    db.expire_all()
    c = db.get(Coupons, coupon_id)
    assert c is not None
    return c.current_uses


def _simplefi_status_mock(status_str: str) -> MagicMock:
    """Build a SimpleFIPaymentRequestStatus-like mock returning the given status."""
    mock = MagicMock()
    mock.status = status_str
    return mock


# ---------------------------------------------------------------------------
# Task 2.4: get_stale_pending_payments
# ---------------------------------------------------------------------------


class TestGetStalePendingPayments:
    """Unit-style tests for the crud query method (task 2.4 deferred from PR2)."""

    def test_returns_stale_pending_simplefi_payments(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Stale PENDING SimpleFi payment with external_id is returned."""
        popup = _make_popup_with_key(db, tenant_a, slug_prefix="q1")
        payment = _make_stale_pending_payment(db, tenant_a, popup, stale_minutes=30)

        results = payments_crud.get_stale_pending_payments(
            db, STALE_MINUTES, batch_size=100
        )
        result_ids = {p.id for p in results}
        assert payment.id in result_ids

    def test_does_not_return_recent_pending(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """A PENDING payment created just now is NOT returned (not stale)."""
        popup = _make_popup_with_key(db, tenant_a, slug_prefix="q2")
        recent = _make_recent_pending_payment(db, tenant_a, popup)

        results = payments_crud.get_stale_pending_payments(
            db, STALE_MINUTES, batch_size=100
        )
        result_ids = {p.id for p in results}
        assert recent.id not in result_ids

    def test_respects_batch_size(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Returns at most batch_size results."""
        popup = _make_popup_with_key(db, tenant_a, slug_prefix="q3")
        # Create 3 stale payments
        for _ in range(3):
            _make_stale_pending_payment(db, tenant_a, popup, stale_minutes=30)

        results = payments_crud.get_stale_pending_payments(
            db, STALE_MINUTES, batch_size=2
        )
        assert len(results) <= 2

    def test_does_not_return_approved_payment(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """An APPROVED payment is not in the stale-pending queue."""
        popup = _make_popup_with_key(db, tenant_a, slug_prefix="q4")
        payment = _make_stale_pending_payment(db, tenant_a, popup, stale_minutes=30)
        # Manually transition to APPROVED
        payment.status = PaymentStatus.APPROVED.value
        db.add(payment)
        db.commit()

        results = payments_crud.get_stale_pending_payments(
            db, STALE_MINUTES, batch_size=100
        )
        result_ids = {p.id for p in results}
        assert payment.id not in result_ids


# ---------------------------------------------------------------------------
# Task 5.9: Sweeper reconciliation matrix
# ---------------------------------------------------------------------------


PATCH_STATUS = "app.services.simplefi.client.SimpleFIClient.get_payment_request_status"
PATCH_PLAN_STATUS = (
    "app.services.simplefi.client.SimpleFIClient.get_installment_plan_status"
)
# Email helper is lazily imported from the router inside _reconcile_candidate.
# Patch it on the router module so the lazy `from ... import` picks up the mock.
PATCH_EMAIL = "app.api.payment.router._send_payment_confirmed_email_best_effort"


class TestSweeperMatrix:
    """Sweeper reconciles each candidate according to its SimpleFi status.

    Spec reference: Sweeper — SimpleFi Status Reconciliation.
    """

    def test_terminal_status_expires_payment_and_releases_coupon(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Stale payment with SimpleFi status 'expired' → update_status(EXPIRED), coupon released.

        Verifies the terminal-status branch of the reconciliation matrix.
        """
        popup = _make_popup_with_key(db, tenant_a, slug_prefix="mx1")
        coupon = _make_coupon(db, popup, current_uses=2)
        payment = _make_stale_pending_payment(db, tenant_a, popup, coupon=coupon)

        with patch(PATCH_STATUS, return_value=_simplefi_status_mock("expired")):
            result = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        assert _fresh_status(db, payment.id) == PaymentStatus.EXPIRED.value
        assert _fresh_coupon_uses(db, coupon.id) == 1  # released once
        assert result["expired"] >= 1
        assert result["failures"] == 0

    def test_cancelled_status_expires_payment(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Stale payment with SimpleFi status 'canceled' → update_status(EXPIRED).

        Triangulation: different terminal status string, same outcome.
        """
        popup = _make_popup_with_key(db, tenant_a, slug_prefix="mx2")
        payment = _make_stale_pending_payment(db, tenant_a, popup)

        with patch(PATCH_STATUS, return_value=_simplefi_status_mock("canceled")):
            asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        assert _fresh_status(db, payment.id) == PaymentStatus.EXPIRED.value

    def test_approved_status_reconciles_payment(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Stale payment with SimpleFi status 'approved' → approve path, not expired.

        Spec: sweeper MUST NOT expire a payment SimpleFi reports as approved.
        """
        popup = _make_popup_with_key(db, tenant_a, slug_prefix="mx3")
        coupon = _make_coupon(db, popup, current_uses=2)
        payment = _make_stale_pending_payment(db, tenant_a, popup, coupon=coupon)

        with (
            patch(PATCH_STATUS, return_value=_simplefi_status_mock("approved")),
            patch(PATCH_EMAIL) as mock_email,
        ):
            mock_email.return_value = None
            result = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        # Payment must NOT be EXPIRED — it should be APPROVED
        assert _fresh_status(db, payment.id) == PaymentStatus.APPROVED.value
        # Coupon must NOT be released (hold legitimately consumed)
        assert _fresh_coupon_uses(db, coupon.id) == 2
        assert result["approved_reconciled"] >= 1

    def test_still_pending_status_is_skipped(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Stale payment still 'pending' on SimpleFi → skip (no status change).

        The sweeper must not expire a payment that SimpleFi hasn't cancelled yet.
        """
        popup = _make_popup_with_key(db, tenant_a, slug_prefix="mx4")
        payment = _make_stale_pending_payment(db, tenant_a, popup)

        with patch(PATCH_STATUS, return_value=_simplefi_status_mock("pending")):
            result = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        assert _fresh_status(db, payment.id) == PaymentStatus.PENDING.value
        assert result["skipped"] >= 1

    def test_status_fetch_failure_is_skipped(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """SimpleFi status fetch failure → skip candidate, run continues.

        Per-candidate failure must NOT abort the sweeper run.
        """
        popup = _make_popup_with_key(db, tenant_a, slug_prefix="mx5")
        payment = _make_stale_pending_payment(db, tenant_a, popup)

        with patch(PATCH_STATUS, side_effect=Exception("timeout")):
            result = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        # Payment must remain PENDING — not expired on ambiguous error
        assert _fresh_status(db, payment.id) == PaymentStatus.PENDING.value
        # The run completed (not aborted)
        assert (
            result["failures"] == 0
        )  # fetch-failure is logged and skipped, not a "failure"
        assert result["skipped"] >= 1

    def test_installment_plan_uses_plan_status_endpoint(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Installment plan payment uses get_installment_plan_status, not get_payment_request_status.

        Triangulation: installment plan path vs payment request path.
        """
        popup = _make_popup_with_key(db, tenant_a, slug_prefix="mx6")
        payment = _make_stale_pending_payment(
            db, tenant_a, popup, is_installment_plan=True
        )

        plan_ext_id = str(payment.external_id)

        with (
            patch(
                PATCH_PLAN_STATUS, return_value=_simplefi_status_mock("expired")
            ) as mock_plan,
            patch(PATCH_STATUS) as mock_req,
        ):
            asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        # Plan status was called with the installment plan's external_id
        plan_ext_ids_called = [c.args[0] for c in mock_plan.call_args_list if c.args]
        assert plan_ext_id in plan_ext_ids_called, (
            f"get_installment_plan_status was not called for {plan_ext_id}"
        )
        # Payment request status was NOT called with the installment plan's external_id
        req_ext_ids_called = [c.args[0] for c in mock_req.call_args_list if c.args]
        assert plan_ext_id not in req_ext_ids_called, (
            f"get_payment_request_status was incorrectly called for installment plan {plan_ext_id}"
        )
        assert _fresh_status(db, payment.id) == PaymentStatus.EXPIRED.value


# ---------------------------------------------------------------------------
# Orphaned payment (no simplefi_api_key)
# ---------------------------------------------------------------------------


class TestSweeperOrphanedPayment:
    """Popup without simplefi_api_key: expire locally, no SimpleFi call.

    Mirrors the same policy established in supersede_pending_payments for PR2.
    """

    def test_orphaned_payment_expired_without_simplefi_call(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Payment on a popup with no API key → EXPIRED locally, no SimpleFi call."""
        popup = _make_popup_no_key(db, tenant_a, slug_prefix="oph")
        coupon = _make_coupon(db, popup, current_uses=3)
        payment = _make_stale_pending_payment(db, tenant_a, popup, coupon=coupon)

        with patch(PATCH_STATUS) as mock_status:
            result = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        # SimpleFi must NOT be called for the orphaned payment's external_id
        # (other non-orphaned stale payments from earlier tests may have been
        # processed and are irrelevant to this assertion).
        orphaned_ext_id = str(payment.external_id)
        calls_for_orphan = [
            c
            for c in mock_status.call_args_list
            if c.args and c.args[0] == orphaned_ext_id
        ]
        assert calls_for_orphan == [], (
            f"SimpleFi was called for orphaned payment {orphaned_ext_id}: {calls_for_orphan}"
        )
        assert _fresh_status(db, payment.id) == PaymentStatus.EXPIRED.value
        assert _fresh_coupon_uses(db, coupon.id) == 2  # released
        assert result["expired"] >= 1


# ---------------------------------------------------------------------------
# Task 5.10: Cross-tenant sweep
# ---------------------------------------------------------------------------


class TestSweeperCrossTenant:
    """Sweeper processes stale payments across all tenants in one run.

    Spec reference: Sweeper — Multi-Tenant Iteration.
    """

    def test_processes_payments_in_two_tenants(
        self,
        db: Session,
        tenant_a: Tenants,
        tenant_b: Tenants,
    ) -> None:
        """Stale pending payments in two different tenants are both expired.

        Verifies that the superuser session bypasses RLS and sees rows from
        every tenant in a single pass.
        """
        popup_a = _make_popup_with_key(db, tenant_a, slug_prefix="ct-a")
        popup_b = _make_popup_with_key(db, tenant_b, slug_prefix="ct-b")

        payment_a = _make_stale_pending_payment(db, tenant_a, popup_a)
        payment_b = _make_stale_pending_payment(db, tenant_b, popup_b)

        with patch(PATCH_STATUS, return_value=_simplefi_status_mock("canceled")):
            result = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        assert _fresh_status(db, payment_a.id) == PaymentStatus.EXPIRED.value
        assert _fresh_status(db, payment_b.id) == PaymentStatus.EXPIRED.value
        assert result["expired"] >= 2

    def test_one_candidate_failure_does_not_abort_run(
        self,
        db: Session,
        tenant_a: Tenants,
        tenant_b: Tenants,
    ) -> None:
        """Exception on one payment does not stop the run; other payments are processed.

        Spec: a per-tenant failure must not abort the full sweep run.
        """
        popup_a = _make_popup_with_key(db, tenant_a, slug_prefix="iso-a")
        popup_b = _make_popup_with_key(db, tenant_b, slug_prefix="iso-b")

        payment_a = _make_stale_pending_payment(db, tenant_a, popup_a)
        payment_b = _make_stale_pending_payment(db, tenant_b, popup_b)

        call_count = {"n": 0}

        def _status_side_effect(*_args, **_kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise RuntimeError("simuleated SimpleFi error on first candidate")
            return _simplefi_status_mock("canceled")

        with patch(PATCH_STATUS, side_effect=_status_side_effect):
            result = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        # At least one was expired (the second candidate), the other was skipped
        statuses = {_fresh_status(db, payment_a.id), _fresh_status(db, payment_b.id)}
        assert PaymentStatus.EXPIRED.value in statuses
        # Run did NOT raise — it completed and returned a summary
        assert "candidates" in result


# ---------------------------------------------------------------------------
# Task 5.11: Overlap guard
# ---------------------------------------------------------------------------


class TestSweeperOverlapGuard:
    """A second concurrent sweeper run skips when the advisory lock is held.

    Spec reference: Concurrent sweeper instances MUST NOT double-process.
    """

    def test_second_run_under_held_lock_is_skipped(
        self,
        db: Session,
        test_engine,
    ) -> None:
        """While another process holds the advisory lock, sweep_pending_payments returns skipped.

        Simulates two concurrent sweeper instances: the first holds the session-level
        pg_try_advisory_lock; the second call attempts the same lock and gets a no-op.
        """
        with test_engine.connect() as lock_conn:
            # Acquire the advisory lock on a dedicated connection (session-level)
            got = lock_conn.execute(
                text("SELECT pg_try_advisory_lock(:k)"),
                {"k": SWEEP_ADVISORY_LOCK_KEY},
            ).scalar()
            assert got, (
                "Test setup: should have acquired the advisory lock on lock_conn"
            )
            lock_conn.commit()  # COMMIT does NOT release a session-level advisory lock

            # Now try to sweep — it should detect the lock is held and skip
            result = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

            assert result.get("status") == "skipped"

            # Explicitly release before returning the connection to the pool.
            # SQLAlchemy connection pooling keeps the underlying physical connection
            # alive after lock_conn.close() / context exit.  A session-level advisory
            # lock is tied to the physical connection, not the SQLAlchemy wrapper, so
            # it would persist across the next borrower without an explicit unlock.
            lock_conn.execute(
                text("SELECT pg_advisory_unlock(:k)"),
                {"k": SWEEP_ADVISORY_LOCK_KEY},
            )
            lock_conn.commit()

    def test_lock_released_after_run_allows_next_run(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """After a normal sweep run completes, the next run can acquire the lock.

        Triangulation: verifies the finally-block releases the lock properly.
        """
        popup = _make_popup_with_key(db, tenant_a, slug_prefix="lk2")
        _make_stale_pending_payment(db, tenant_a, popup)

        with patch(PATCH_STATUS, return_value=_simplefi_status_mock("canceled")):
            # First run
            result1 = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )
            # Second run — lock must be available after first run's finally block
            result2 = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        assert result1.get("status") != "skipped"
        assert result2.get("status") != "skipped"
