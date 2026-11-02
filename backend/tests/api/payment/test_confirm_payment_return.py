"""Owned Portal confirmation reads provider status without cancelling checkout."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlmodel import Session, select

from app.api.attendee.models import AttendeeProducts
from app.api.payment.models import PaymentProducts, Payments
from app.core.security import create_access_token
from tests.api.payment.test_pending_release_return import _make_human
from tests.api.payment.test_purchase_confirmation_events import (
    confirmed_purchase,  # noqa: F401
)


@pytest.fixture
def returned_payment(request, db, monkeypatch):
    payment_id, _, events, _, webhook = request.getfixturevalue("confirmed_purchase")
    payment = db.get(Payments, payment_id)
    provider = MagicMock()
    provider.get_payment_request_status.return_value = SimpleNamespace(
        id=payment.external_id, status="approved"
    )
    factory = MagicMock(return_value=provider)
    monkeypatch.setattr("app.services.simplefi.get_simplefi_client", factory)
    headers = {
        "Authorization": f"Bearer {create_access_token(subject=payment.application.human_id, token_type='human')}",
        "X-Tenant-Id": str(payment.tenant_id),
    }
    path = f"/api/v1/payments/my/{payment_id}/confirm"
    return payment, provider, factory, headers, path, events, webhook


def test_return_confirms_once_without_cancel(returned_payment, client, db):
    payment, provider, _, headers, path, events, webhook = returned_payment
    response = client.post(path, headers=headers)
    assert response.status_code == 200
    assert response.json() == {"id": str(payment.id), "status": "approved"}
    assert client.post(path, headers=headers).json() == response.json()
    assert webhook().status_code == 200
    db.refresh(payment)
    assert payment.status == "approved"
    assert dict(events) == {"meta": [payment.id], "ga4": [payment.id]}
    provider.get_payment_request_status.assert_called_once_with(payment.external_id)
    provider.cancel_payment_request.assert_not_called()


@pytest.mark.parametrize("remote_status", ["pending", "rejected", "unknown"])
def test_unconfirmed_return_never_approves_or_cancels(
    returned_payment, client, db, remote_status
):
    payment, provider, _, headers, path, events, _ = returned_payment
    provider.get_payment_request_status.return_value.status = remote_status
    response = client.post(path, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "pending"
    db.refresh(payment)
    assert payment.status == "pending"
    assert not events
    provider.cancel_payment_request.assert_not_called()


@pytest.mark.parametrize("failure", ["unreachable", "mismatched_reference"])
def test_provider_failure_does_not_change_payment(
    returned_payment, client, db, failure
):
    payment, provider, _, headers, path, events, _ = returned_payment
    if failure == "unreachable":
        provider.get_payment_request_status.side_effect = RuntimeError(
            "provider unavailable"
        )
    else:
        provider.get_payment_request_status.return_value.id = "another-payment"
    response = client.post(path, headers=headers)
    assert response.status_code == 502
    db.refresh(payment)
    assert payment.status == "pending"
    assert not events
    provider.cancel_payment_request.assert_not_called()


def test_confirmation_requires_owner_before_provider(
    returned_payment, client, db, tenant_a, tenant_b
):
    payment, provider, _, headers, path, events, _ = returned_payment
    stranger = _make_human(db, tenant_a)
    db.commit()
    wrong_owner = {
        **headers,
        "Authorization": f"Bearer {create_access_token(subject=stranger.id, token_type='human')}",
    }
    assert client.post(path, headers=wrong_owner).status_code == 404
    other_tenant_human = _make_human(db, tenant_b)
    db.commit()
    other_tenant_headers = {
        "Authorization": f"Bearer {create_access_token(subject=other_tenant_human.id, token_type='human')}",
        "X-Tenant-Id": str(tenant_b.id),
    }
    assert client.post(path, headers=other_tenant_headers).status_code == 404
    assert client.post(
        path, headers={"X-Tenant-Id": str(payment.tenant_id)}
    ).status_code in (401, 403)
    provider.get_payment_request_status.assert_not_called()
    assert not events


def test_webhook_before_return_does_not_redispatch(returned_payment, client):
    payment, provider, _, headers, path, events, webhook = returned_payment
    assert webhook().status_code == 200
    response = client.post(path, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "approved"
    assert dict(events) == {"meta": [payment.id], "ga4": [payment.id]}
    provider.get_payment_request_status.assert_not_called()


def test_confirmation_keeps_local_status_get_read_only(returned_payment, client, db):
    payment, provider, _, headers, path, events, _ = returned_payment
    response = client.get(path.removesuffix("/confirm") + "/status", headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "pending"
    db.refresh(payment)
    assert payment.status == "pending"
    provider.get_payment_request_status.assert_not_called()
    assert not events


@pytest.mark.parametrize("local_state", ["cancelled", "expired", "rejected"])
def test_terminal_local_payment_is_not_revived(
    returned_payment, client, db, local_state
):
    payment, provider, _, headers, path, events, _ = returned_payment
    payment.status = local_state
    db.add(payment)
    db.commit()
    response = client.post(path, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == local_state
    db.refresh(payment)
    assert payment.status == local_state
    assert not events
    provider.get_payment_request_status.assert_not_called()


@pytest.mark.parametrize("terminal", ["cancelled", "expired", "rejected"])
def test_provider_approval_does_not_override_a_concurrent_cancellation(
    returned_payment, client, db, test_engine, terminal
):
    payment, provider, _, headers, path, events, _ = returned_payment

    def read_provider_status(_external_id):
        with Session(test_engine) as concurrent:
            row = concurrent.get(Payments, payment.id)
            row.status = terminal
            concurrent.add(row)
            concurrent.commit()
        return SimpleNamespace(id=payment.external_id, status="approved")

    provider.get_payment_request_status.side_effect = read_provider_status
    response = client.post(path, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == terminal
    db.refresh(payment)
    assert payment.status == terminal
    assert not events


@pytest.mark.parametrize("unsupported", ["fee", "installment", "other_source"])
def test_other_payment_paths_keep_their_confirmation_handling(
    returned_payment, client, db, unsupported
):
    payment, provider, _, headers, path, events, _ = returned_payment
    if unsupported == "fee":
        payment.payment_type = "application_fee"
    elif unsupported == "installment":
        payment.is_installment_plan = True
    else:
        payment.source = "Stripe"
    db.add(payment)
    db.commit()
    response = client.post(path, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "pending"
    db.refresh(payment)
    assert payment.status == "pending"
    assert not events
    provider.get_payment_request_status.assert_not_called()


def test_webhook_during_provider_read(returned_payment, client, db):
    payment, provider, _, headers, path, events, webhook = returned_payment

    def provider_read(_external_id):
        assert webhook().status_code == 200
        return SimpleNamespace(id=payment.external_id, status="approved")

    provider.get_payment_request_status.side_effect = provider_read
    assert client.post(path, headers=headers).json() == {
        "id": str(payment.id),
        "status": "approved",
    }
    assert dict(events) == {"meta": [payment.id], "ga4": [payment.id]}
    db.expire_all()
    line_ids = [
        line.id
        for line in db.exec(
            select(PaymentProducts).where(PaymentProducts.payment_id == payment.id)
        ).all()
    ]
    lines = db.exec(
        select(AttendeeProducts).where(
            AttendeeProducts.payment_product_id.in_(line_ids)
        )
    ).all()
    assert len(lines) == 1
    provider.cancel_payment_request.assert_not_called()


def test_unsigned_client_approval_is_ignored(returned_payment, client, db):
    payment, provider, _, headers, path, events, _ = returned_payment
    provider.get_payment_request_status.return_value.status = "pending"
    response = client.post(
        path + "?status=approved&data=approved",
        headers=headers,
        json={"status": "approved", "paid": True},
    )
    assert response.status_code == 200
    assert response.json() == {"id": str(payment.id), "status": "pending"}
    db.refresh(payment)
    assert payment.status == "pending"
    assert not events
    provider.cancel_payment_request.assert_not_called()
