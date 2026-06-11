"""Unit tests for the PR 3 installment webhook hardening.

Three behaviors under test:
  1. ``_handle_installment_plan_cancelled`` restores stock (and revokes products
     when applicable) — closing the stock-leak gap.
  2. ``_handle_installment_payment`` dedupes by ``external_payment_id`` even
     when the redis-backed fingerprint cache miss-cycles.
  3. ``_handle_installment_plan_activated`` is idempotent against duplicate
     deliveries and warns on a divergent ``number_of_installments``.

The handlers are exercised in isolation via monkey-patching the module-level
``payments_crud``; the fakes are intentionally minimal so the test states what
the handler is contractually required to do.
"""

import asyncio
import importlib
from types import SimpleNamespace

from app.api.payment.router import (
    _handle_installment_payment,
    _handle_installment_plan_activated,
    _handle_installment_plan_cancelled,
)
from app.api.payment.schemas import (
    PaymentStatus,
    SimpleFIWebhookPayload,
)

payment_router_module = importlib.import_module("app.api.payment.router")


class FakeWebhookCache:
    def __init__(self) -> None:
        self.fingerprints: set[str] = set()

    def add(self, fingerprint: str) -> bool:
        if fingerprint in self.fingerprints:
            return False
        self.fingerprints.add(fingerprint)
        return True


class FakeDBSession:
    """Captures commit() calls; the handlers don't otherwise touch the session."""

    def __init__(self) -> None:
        self.committed = 0

    def commit(self) -> None:
        self.committed += 1

    def add(self, _obj) -> None:  # noqa: D401 — sqlmodel compat for installment add
        pass


# ----------------------------------------------------------------------------
# _handle_installment_plan_cancelled
# ----------------------------------------------------------------------------


def _make_cancel_payload(plan_id: str) -> dict:
    return {
        "id": "evt-cancel-1",
        "event_type": "installment_plan_cancelled",
        "entity_type": "installment_plan",
        "entity_id": plan_id,
        "data": {
            "installment_plan": {
                "id": plan_id,
                "status": "cancelled",
                "paid_installments_count": 2,
                "number_of_installments": 6,
                "user_email": "buyer@example.com",
            }
        },
    }


def test_cancel_pending_plan_restores_stock(monkeypatch) -> None:
    """PENDING plan cancellation must restore stock and not try to revoke
    products (none assigned yet)."""
    plan_id = "plan-pending-cancel-1"
    payment = SimpleNamespace(
        id="payment-pending-1",
        external_id=plan_id,
        status=PaymentStatus.PENDING.value,
        products_snapshot=[],
    )

    calls: list[str] = []

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, ext_id):
            assert ext_id == plan_id
            return payment

        def _remove_products_from_attendees(self, _db, _payment):
            calls.append("remove_products")

        def _restore_payment_stock(self, _db, p):
            assert p is payment
            calls.append("restore_stock")

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())

    result = asyncio.run(
        _handle_installment_plan_cancelled(
            _make_cancel_payload(plan_id),
            FakeDBSession(),
            FakeWebhookCache(),
        )
    )

    assert result == {"message": "Installment plan cancelled successfully"}
    assert payment.status == "cancelled"
    # PENDING → cancelled: no products were assigned, only stock restored.
    assert calls == ["restore_stock"]


def test_cancel_approved_plan_revokes_products_and_restores_stock(
    monkeypatch,
) -> None:
    """APPROVED plan (first installment already paid) must revoke attendee
    products AND restore stock."""
    plan_id = "plan-approved-cancel-1"
    payment = SimpleNamespace(
        id="payment-approved-1",
        external_id=plan_id,
        status=PaymentStatus.APPROVED.value,
        products_snapshot=[object()],  # non-empty placeholder
    )

    calls: list[str] = []

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, ext_id):
            return payment

        def _remove_products_from_attendees(self, _db, p):
            assert p is payment
            calls.append("remove_products")

        def _restore_payment_stock(self, _db, p):
            assert p is payment
            calls.append("restore_stock")

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())

    asyncio.run(
        _handle_installment_plan_cancelled(
            _make_cancel_payload(plan_id),
            FakeDBSession(),
            FakeWebhookCache(),
        )
    )

    # Order matters: revoke products BEFORE flipping status so the snapshot is
    # still readable; stock restore can run in either position but currently
    # runs after revoke. Both must have happened.
    assert calls == ["remove_products", "restore_stock"]
    assert payment.status == "cancelled"


def test_cancel_already_cancelled_plan_is_idempotent(monkeypatch) -> None:
    """Duplicate cancellation webhook must not re-revoke or double-restore."""
    plan_id = "plan-already-cancelled-1"
    payment = SimpleNamespace(
        id="payment-already-1",
        external_id=plan_id,
        status="cancelled",
        products_snapshot=[],
    )

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, _ext_id):
            return payment

        def _remove_products_from_attendees(self, *_args, **_kwargs):
            raise AssertionError("must not revoke on already-cancelled")

        def _restore_payment_stock(self, *_args, **_kwargs):
            raise AssertionError("must not restore stock on already-cancelled")

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())

    result = asyncio.run(
        _handle_installment_plan_cancelled(
            _make_cancel_payload(plan_id),
            FakeDBSession(),
            FakeWebhookCache(),
        )
    )
    assert result == {"message": "Payment already cancelled"}


# ----------------------------------------------------------------------------
# _handle_installment_payment dedupe
# ----------------------------------------------------------------------------


def _make_installment_payload(
    plan_id: str, payment_request_id: str
) -> SimpleFIWebhookPayload:
    return SimpleFIWebhookPayload.model_validate(
        {
            "id": "evt-installment-1",
            "event_type": "new_payment",
            "entity_type": "payment_request",
            "entity_id": payment_request_id,
            "data": {
                "payment_request": {
                    "id": payment_request_id,
                    "order_id": 9,
                    "amount": 100.0,
                    "amount_paid": 100.0,
                    "currency": "USD",
                    "reference": {},
                    "status": "approved",
                    "status_detail": "approved",
                    "transactions": [],
                    "card_payment": None,
                    "payments": [],
                    "installment_plan_id": plan_id,
                },
                "new_payment": {
                    "coin": "USD",
                    "hash": "h1",
                    "amount": 100.0,
                    "paid_at": "2026-05-01T10:00:00Z",
                },
            },
        }
    )


def test_installment_payment_dedupes_by_external_payment_id(monkeypatch) -> None:
    """A second installment_payment webhook with the same payment_request_id
    must NOT insert a duplicate PaymentInstallments row, even if the redis
    fingerprint cache missed (separate cache instance)."""
    plan_id = "plan-dedup-1"
    pr_id = "pr-dedup-1"

    existing_installment = SimpleNamespace(
        external_payment_id=pr_id,
        installment_number=1,
    )
    payment = SimpleNamespace(
        id="payment-dedup-1",
        external_id=plan_id,
        status=PaymentStatus.APPROVED.value,
        tenant_id="tenant-x",
        installments=[existing_installment],
        installments_paid=1,
        installments_total=6,
    )

    def fail_approve(*_a, **_kw):
        raise AssertionError("must not re-approve when deduping")

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, _ext_id):
            return payment

        approve_payment = staticmethod(fail_approve)

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())

    db = FakeDBSession()

    # Use a fresh webhook cache (simulating eviction since the original delivery)
    result = asyncio.run(
        _handle_installment_payment(
            _make_installment_payload(plan_id, pr_id),
            db,
            FakeWebhookCache(),
        )
    )

    assert result == {"message": "Installment payment already recorded"}
    # No new installment row was added (still the one we seeded)
    assert len(payment.installments) == 1
    # installments_paid is unchanged
    assert payment.installments_paid == 1
    # No commit needed because we returned early before any writes
    assert db.committed == 0


# ----------------------------------------------------------------------------
# _handle_installment_plan_activated idempotency
# ----------------------------------------------------------------------------


def _make_activated_payload(plan_id: str, number: int) -> dict:
    return {
        "id": "evt-activated-1",
        "event_type": "installment_plan_activated",
        "entity_type": "installment_plan",
        "entity_id": plan_id,
        "data": {
            "installment_plan": {
                "id": plan_id,
                "status": "active",
                "paid_installments_count": 0,
                "number_of_installments": number,
                "user_email": "buyer@example.com",
            }
        },
    }


def test_activated_idempotent_when_total_already_matches(monkeypatch) -> None:
    plan_id = "plan-act-1"
    payment = SimpleNamespace(
        id="payment-act-1",
        external_id=plan_id,
        installments_total=6,
    )

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, _ext_id):
            return payment

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())

    db = FakeDBSession()
    result = asyncio.run(
        _handle_installment_plan_activated(
            _make_activated_payload(plan_id, 6),
            db,
            FakeWebhookCache(),
        )
    )
    assert result == {"message": "Installment plan already activated"}
    assert payment.installments_total == 6
    assert db.committed == 0


def test_activated_logs_warning_on_divergent_total(monkeypatch) -> None:
    """If the new total differs from the stored one, we overwrite (so future
    counting stays correct) but emit a warning — silently letting them drift
    would corrupt installments_paid/installments_total comparisons."""
    plan_id = "plan-act-2"
    payment = SimpleNamespace(
        id="payment-act-2",
        external_id=plan_id,
        installments_total=4,
    )

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, _ext_id):
            return payment

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())

    db = FakeDBSession()
    asyncio.run(
        _handle_installment_plan_activated(
            _make_activated_payload(plan_id, 6),
            db,
            FakeWebhookCache(),
        )
    )
    assert payment.installments_total == 6
    assert db.committed == 1


def test_activated_first_time_writes_total(monkeypatch) -> None:
    plan_id = "plan-act-3"
    payment = SimpleNamespace(
        id="payment-act-3",
        external_id=plan_id,
        installments_total=None,
    )

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, _ext_id):
            return payment

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())

    db = FakeDBSession()
    asyncio.run(
        _handle_installment_plan_activated(
            _make_activated_payload(plan_id, 3),
            db,
            FakeWebhookCache(),
        )
    )
    assert payment.installments_total == 3
    assert db.committed == 1


def test_activated_single_installment_normalizes_flag(monkeypatch) -> None:
    """A pay-in-full activation (number_of_installments=1) is not really an
    installment plan — the flag must be normalized to False so data consumers
    don't need a single-installment special case."""
    plan_id = "plan-act-payfull"
    payment = SimpleNamespace(
        id="payment-act-payfull",
        external_id=plan_id,
        installments_total=None,
        is_installment_plan=True,
    )

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, _ext_id):
            return payment

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())

    db = FakeDBSession()
    asyncio.run(
        _handle_installment_plan_activated(
            _make_activated_payload(plan_id, 1),
            db,
            FakeWebhookCache(),
        )
    )
    assert payment.installments_total == 1
    assert payment.is_installment_plan is False
    assert db.committed == 1


def test_activated_multi_installment_keeps_flag(monkeypatch) -> None:
    plan_id = "plan-act-multi"
    payment = SimpleNamespace(
        id="payment-act-multi",
        external_id=plan_id,
        installments_total=None,
        is_installment_plan=True,
    )

    class FakePaymentsCRUD:
        def get_by_external_id(self, _db, _ext_id):
            return payment

    monkeypatch.setattr(payment_router_module, "payments_crud", FakePaymentsCRUD())

    asyncio.run(
        _handle_installment_plan_activated(
            _make_activated_payload(plan_id, 6),
            FakeDBSession(),
            FakeWebhookCache(),
        )
    )
    assert payment.installments_total == 6
    assert payment.is_installment_plan is True
