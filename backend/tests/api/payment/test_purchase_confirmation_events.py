"""Purchase follows committed confirmation, including checkout return recovery."""

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.api.attendee.models import AttendeeProducts
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.core.security import create_access_token
from app.services import ga4_mp, meta_capi, payment_notifications
from app.services.simplefi.client import CancelOutcome
from tests.api.payment.test_payment_idempotency import (
    _make_app_and_attendee,
    _make_free_product,
)
from tests.api.payment.test_pending_release_return import (
    _make_human,
    _make_pending_payment,
    _make_popup,
)


@pytest.fixture
def confirmed_purchase(client, db, test_engine, tenant_a, monkeypatch):
    popup = _make_popup(db, tenant_a, slug_prefix="confirmation")
    human = _make_human(db, tenant_a)
    application, attendee = _make_app_and_attendee(db, popup, human)
    product = _make_free_product(db, popup)
    product.price = Decimal("100")
    payment = _make_pending_payment(db, tenant_a, popup, application_id=application.id)
    payment.ga_client_id = "123.456"
    payment.ga_session_id = "789"
    db.add(payment)
    line = PaymentProducts(
        tenant_id=tenant_a.id,
        payment_id=payment.id,
        product_id=product.id,
        attendee_id=attendee.id,
        quantity=1,
        product_name=product.name,
        product_price=product.price,
        product_category="ticket",
    )
    db.add(line)
    db.commit()
    payment_id = payment.id
    external_id = payment.external_id
    line_id = line.id
    tenant_id = tenant_a.id
    events = defaultdict(list)

    def capture(provider):
        def send(*, tenant, payment, popup):
            assert tenant.id == tenant_id
            assert payment.id == payment_id
            assert popup.id == payment.popup_id
            assert payment.ga_client_id == "123.456"
            with Session(test_engine) as observer:
                assert observer.get(Payments, payment_id).status == "approved"
                assert (
                    len(
                        observer.exec(
                            select(AttendeeProducts).where(
                                AttendeeProducts.payment_product_id == line_id
                            )
                        ).all()
                    )
                    == 1
                )
            events[provider].append(payment.id)

        return send

    monkeypatch.setattr(meta_capi, "fire_and_forget_purchase_event", capture("meta"))
    monkeypatch.setattr(ga4_mp, "fire_and_forget_purchase_event", capture("ga4"))
    monkeypatch.setattr(
        payment_notifications, "_send_payment_confirmed_email", AsyncMock()
    )
    provider = MagicMock()
    provider.cancel_payment_request.return_value = CancelOutcome.ALREADY_APPROVED
    monkeypatch.setattr(
        "app.services.simplefi.get_simplefi_client", lambda _key: provider
    )
    monkeypatch.setattr("app.core.redis.webhook_cache.add", lambda _key: True)
    headers = {
        "Authorization": f"Bearer {create_access_token(subject=human.id, token_type='human')}",
        "X-Tenant-Id": str(tenant_a.id),
    }

    def release():
        return client.post(
            "/api/v1/payments/my/pending/release",
            json={"application_id": str(application.id)},
            headers=headers,
        )

    def webhook():
        return client.post(
            "/api/v1/payments/webhook/simplefi",
            json={
                "id": f"evt-{external_id}",
                "event_type": "new_card_payment",
                "entity_type": "payment_request",
                "entity_id": external_id,
                "data": {
                    "payment_request": {
                        "id": external_id,
                        "order_id": 1,
                        "amount": 100,
                        "amount_paid": 100,
                        "currency": "ARS",
                        "reference": {},
                        "status": "approved",
                        "status_detail": "approved",
                        "transactions": [],
                        "card_payment": None,
                        "payments": [],
                        "installment_plan_id": None,
                    },
                    "new_payment": None,
                },
            },
        )

    return payment_id, line_id, events, release, webhook


@pytest.mark.parametrize("first", ["return", "webhook"])
def test_confirmation_and_replays_dispatch_once(
    confirmed_purchase, db, test_engine, first
):
    payment_id, line_id, events, release, webhook = confirmed_purchase
    with Session(test_engine) as stale_session:
        stale_payment = stale_session.get(Payments, payment_id)
        assert stale_payment.status == "pending"
        if first == "return":
            response = release()
            assert response.status_code == 409
            detail = response.json()["detail"]
            assert set(detail) == {"code", "message", "redirect_url"}
            assert detail["code"] == "previous_payment_completed"
            assert detail["message"] == "Your previous payment was completed."
            assert detail["redirect_url"].endswith("/passes")
        else:
            assert webhook().status_code == 200
        assert dict(events) == {"meta": [payment_id], "ga4": [payment_id]}
        assert release().json() == {"released": False}
        assert webhook().status_code == 200
        assert webhook().status_code == 200
        # Approval must refresh preloaded PENDING state under its existing lock.
        assert (
            payments_crud.approve_payment(stale_session, payment_id).status
            == "approved"
        )

    db.expire_all()
    assert db.get(Payments, payment_id).status == PaymentStatus.APPROVED.value
    assert (
        len(
            db.exec(
                select(AttendeeProducts).where(
                    AttendeeProducts.payment_product_id == line_id
                )
            ).all()
        )
        == 1
    )
    assert dict(events) == {"meta": [payment_id], "ga4": [payment_id]}


def test_concurrent_approvals_dispatch_once(confirmed_purchase, test_engine):
    payment_id, _, events, _, _ = confirmed_purchase
    ready = Barrier(2)

    def approve():
        with Session(test_engine) as session:
            assert session.get(Payments, payment_id).status == "pending"
            ready.wait(timeout=10)
            return payments_crud.approve_payment(session, payment_id).status

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(approve) for _ in range(2)]
        assert [future.result(timeout=30) for future in futures] == [
            "approved",
            "approved",
        ]
    assert dict(events) == {"meta": [payment_id], "ga4": [payment_id]}


@pytest.mark.parametrize("failed_provider", ["meta", "ga4"])
def test_notification_failure_does_not_undo_return_confirmation(
    confirmed_purchase, db, monkeypatch, failed_provider
):
    payment_id, _, events, release, _ = confirmed_purchase

    def fail(**_kwargs):
        raise RuntimeError("Notification unavailable")

    monkeypatch.setattr(
        meta_capi if failed_provider == "meta" else ga4_mp,
        "fire_and_forget_purchase_event",
        fail,
    )
    response = release()
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "previous_payment_completed"
    db.expire_all()
    assert db.get(Payments, payment_id).status == "approved"
    other_provider = "ga4" if failed_provider == "meta" else "meta"
    assert dict(events) == {other_provider: [payment_id]}


def test_failed_fulfillment_does_not_dispatch_purchase(
    confirmed_purchase, db, monkeypatch
):
    payment_id, _, events, release, _ = confirmed_purchase

    def reject(*_args, **_kwargs):
        raise HTTPException(status_code=422, detail="Recipient could not be fulfilled")

    monkeypatch.setattr(payments_crud, "_reconcile_payment_fulfillment", reject)
    assert release().status_code == 422
    db.expire_all()
    assert db.get(Payments, payment_id).status == "pending"
    assert dict(events) == {}
