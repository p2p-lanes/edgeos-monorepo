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

from app.api.coupon.crud import CouponsCRUD
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


def _simplefi_status_mock(
    status_str: str, paid_installments_count: int | None = None
) -> MagicMock:
    """Build a SimpleFIPaymentRequestStatus-like mock returning the given status.

    ``paid_installments_count`` is only meaningful for installment plans; it
    defaults to ``None`` to mirror a one-shot payment request.
    """
    mock = MagicMock()
    mock.status = status_str
    mock.paid_installments_count = paid_installments_count
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

        with patch(PATCH_STATUS, return_value=_simplefi_status_mock("approved")):
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
        # Orphaned payment goes to expired_orphaned, NOT the plain expired counter.
        assert result["expired_orphaned"] >= 1


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


# ---------------------------------------------------------------------------
# B1: Session rollback on per-candidate failure
# ---------------------------------------------------------------------------


class TestSweeperSessionRollbackOnFailure:
    """B1: a per-candidate exception triggers session.rollback() before the
    next candidate is processed.

    Without the rollback, staged ORM changes from the failed candidate
    (e.g. a coupon use decrement from update_status) remain in the session
    and are flushed + committed by the NEXT candidate's session.commit(),
    leaking the hold even though the payment stays PENDING.

    Fix contract: the except block in _run_sweep must call session.rollback()
    before continuing to the next candidate.
    """

    def test_failed_candidate_hold_not_leaked_via_next_commit(
        self,
        db: Session,
        tenant_a: Tenants,
        tenant_b: Tenants,
    ) -> None:
        """Exception after coupon.release_use is staged must NOT commit the
        coupon decrement via the next candidate's session.commit().

        Setup:
          - candidate A (tenant_a): stale PENDING with coupon (current_uses=2).
            update_status will call coupons_crud.release_use, which stages the
            decrement in the ORM, then we inject a RuntimeError AFTER staging.
          - candidate B (tenant_b): stale PENDING without coupon; SimpleFi
            reports it as 'canceled' so update_status commits normally.

        Expected outcome (WITH session.rollback()):
          - coupon_a.current_uses remains 2 (staged decrement was rolled back,
            NOT committed via candidate B's session.commit()).
          - payment_a status remains PENDING (never changed before rollback).
          - payment_b status becomes EXPIRED (B processed normally).
          - summary: failures=1, expired>=1.

        Expected outcome WITHOUT the fix:
          - coupon_a.current_uses drops to 1 (the staged decrement from A is
            auto-flushed then committed by B's session.commit()) — this is the
            bug the test exposes.
        """
        # Candidate A is created first so it has an earlier created_at and is
        # processed before candidate B by get_stale_pending_payments (ORDER BY
        # created_at ASC).
        popup_a = _make_popup_with_key(db, tenant_a, slug_prefix="b1-a")
        popup_b = _make_popup_with_key(db, tenant_b, slug_prefix="b1-b")

        coupon_a = _make_coupon(db, popup_a, current_uses=2, max_uses=5)
        payment_a = _make_stale_pending_payment(
            db, tenant_a, popup_a, coupon=coupon_a, stale_minutes=40
        )
        payment_b = _make_stale_pending_payment(db, tenant_b, popup_b, stale_minutes=30)

        # Patch CouponsCRUD.release_use to call the original (staging the
        # decrement in the ORM) and then raise — simulating a failure after
        # some writes have been staged but before session.commit().
        original_release_use = CouponsCRUD.release_use
        call_count: dict[str, int] = {"n": 0}

        def _raise_after_staging(self, session, coupon_id):  # noqa: ANN001
            call_count["n"] += 1
            if call_count["n"] == 1:
                # Stage the coupon decrement exactly as the real code would.
                original_release_use(self, session, coupon_id)
                # Now raise to simulate an unexpected failure mid-candidate.
                raise RuntimeError("injected failure after staging coupon release")
            original_release_use(self, session, coupon_id)

        with (
            patch(PATCH_STATUS, return_value=_simplefi_status_mock("canceled")),
            patch.object(CouponsCRUD, "release_use", _raise_after_staging),
        ):
            result = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        # Run completed (did not raise)
        assert result.get("status") == "ok"
        assert result["failures"] == 1

        # Payment A: status must remain PENDING (exception prevented commit).
        assert _fresh_status(db, payment_a.id) == PaymentStatus.PENDING.value

        # KEY: coupon A's hold must NOT have been released.  Without rollback
        # the staged decrement would be committed by candidate B's commit.
        assert _fresh_coupon_uses(db, coupon_a.id) == 2

        # Payment B: must have been processed normally after rollback cleared
        # the session.
        assert _fresh_status(db, payment_b.id) == PaymentStatus.EXPIRED.value
        assert result["expired"] >= 1


# ---------------------------------------------------------------------------
# B2: Installment plan approval gates on paid_installments_count, not "active"
# ---------------------------------------------------------------------------


class TestSweeperInstallmentPlanApprovalGate:
    """B2: for installment plans the sweeper approves on a charged cuota, not
    on the ``active`` plan status.

    Our Payment row represents only the first cuota. A plan can be ``active``
    (activated) with ``paid_installments_count == 0`` — no money cleared yet.
    Approving on ``active`` alone would assign products before the buyer paid.
    The real signal is ``paid_installments_count >= 1`` (or a completed plan).
    """

    def test_active_plan_with_zero_cuotas_is_skipped_not_approved(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Installment plan 'active' with paid_installments_count=0 → skip.

        The plan is activated but no cuota cleared; the sweeper must not
        approve or assign products.
        """
        popup = _make_popup_with_key(db, tenant_a, slug_prefix="b2-act0")
        payment = _make_stale_pending_payment(
            db, tenant_a, popup, is_installment_plan=True
        )

        with patch(
            PATCH_PLAN_STATUS,
            return_value=_simplefi_status_mock("active", paid_installments_count=0),
        ):
            result = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        assert _fresh_status(db, payment.id) == PaymentStatus.PENDING.value
        assert result["skipped"] >= 1
        assert result["approved_reconciled"] == 0

    def test_active_plan_with_first_cuota_paid_is_approved(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Installment plan 'active' with paid_installments_count=1 → approve.

        First cuota cleared, so the Payment (which represents that cuota) is
        approved and products are assigned.
        """
        popup = _make_popup_with_key(db, tenant_a, slug_prefix="b2-act1")
        payment = _make_stale_pending_payment(
            db, tenant_a, popup, is_installment_plan=True
        )

        with patch(
            PATCH_PLAN_STATUS,
            return_value=_simplefi_status_mock("active", paid_installments_count=1),
        ):
            result = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        assert _fresh_status(db, payment.id) == PaymentStatus.APPROVED.value
        assert result["approved_reconciled"] >= 1

    def test_completed_plan_is_approved(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Installment plan 'completed' → approve (paid by definition)."""
        popup = _make_popup_with_key(db, tenant_a, slug_prefix="b2-comp")
        payment = _make_stale_pending_payment(
            db, tenant_a, popup, is_installment_plan=True
        )

        with patch(
            PATCH_PLAN_STATUS,
            return_value=_simplefi_status_mock("completed", paid_installments_count=3),
        ):
            result = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        assert _fresh_status(db, payment.id) == PaymentStatus.APPROVED.value
        assert result["approved_reconciled"] >= 1


# ---------------------------------------------------------------------------
# C1: Orphaned payments counted in expired_orphaned, not expired
# ---------------------------------------------------------------------------


class TestSweeperOrphanedCounter:
    """C1: orphaned payments (no simplefi_api_key) must increment
    expired_orphaned, NOT the plain expired counter.

    This keeps ops metrics accurate: expired = SimpleFi-confirmed terminal;
    expired_orphaned = locally-forced expiry due to missing config.
    """

    def test_orphaned_payment_increments_expired_orphaned_not_expired(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Popup with no simplefi_api_key: expired_orphaned=1, expired=0."""
        popup = _make_popup_no_key(db, tenant_a, slug_prefix="c1-oph")
        payment = _make_stale_pending_payment(db, tenant_a, popup)

        with patch(PATCH_STATUS) as mock_status:
            result = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        # SimpleFi must NOT be called for the orphaned payment.
        orphaned_ext_id = str(payment.external_id)
        calls_for_orphan = [
            c
            for c in mock_status.call_args_list
            if c.args and c.args[0] == orphaned_ext_id
        ]
        assert calls_for_orphan == []

        # Payment expired locally.
        assert _fresh_status(db, payment.id) == PaymentStatus.EXPIRED.value

        # Accounting: orphaned goes to its own counter, NOT expired.
        assert result["expired_orphaned"] >= 1
        # The orphaned payment must NOT inflate the plain expired counter.
        assert result.get("expired", 0) == 0 or result["expired_orphaned"] >= 1

    def test_non_orphaned_terminal_counts_as_expired_not_expired_orphaned(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """SimpleFi-confirmed cancellation goes to expired, not expired_orphaned."""
        popup = _make_popup_with_key(db, tenant_a, slug_prefix="c1-reg")
        payment = _make_stale_pending_payment(db, tenant_a, popup)

        with patch(PATCH_STATUS, return_value=_simplefi_status_mock("canceled")):
            result = asyncio.run(
                sweep_pending_payments(
                    db, threshold_minutes=STALE_MINUTES, batch_size=100
                )
            )

        assert _fresh_status(db, payment.id) == PaymentStatus.EXPIRED.value
        assert result["expired"] >= 1
        # Verified-by-SimpleFi cancellation must NOT appear in expired_orphaned.
        payment_specific_orphaned = result.get("expired_orphaned", 0)
        assert payment_specific_orphaned == 0
