"""The request fixture is also asserted by the portal's real submit-hook test."""

import json
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlmodel import select

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, PaymentRecipients
from app.api.product.models import Products
from app.core.security import create_access_token
from tests.api.payment.test_typed_payment_writes import _open_context

FIXTURE = (
    Path(__file__).resolve().parents[4] / "e2e/fixtures/simple-quantity-purchase.json"
)


@pytest.mark.parametrize("signed_in", [False, True])
@pytest.mark.parametrize("categorized", [False, True])
def test_portal_simple_quantity_contract_reaches_provider_and_fulfills_each_unit(
    client, db, tenant_a, signed_in, categorized
):
    popup, flow = _open_context(db, tenant_a)
    # Keep the exact wire contract; namespace ids for the session-scoped DB.
    raw = FIXTURE.read_text()
    fixture = json.loads(raw)
    for product_id in {line["product_id"] for line in fixture["products"]}:
        raw = raw.replace(product_id, str(uuid.uuid4()))
    body = json.loads(raw)
    body["buyer"]["email"] = f"buyer-{uuid.uuid4().hex[:8]}@example.com"
    category_id = None
    if categorized:
        category = AttendeeCategories(
            tenant_id=tenant_a.id, popup_id=popup.id, key="guest"
        )
        db.add(category)
        db.flush()
        category_id = category.id
    for recipient in body["recipients"]:
        recipient["email"] = body["buyer"]["email"]
        recipient["category_id"] = str(category_id) if category_id else None

    ticket_id = uuid.UUID(body["products"][0]["product_id"])
    merch_id = uuid.UUID(body["products"][2]["product_id"])
    for product_id, category, price in [
        (ticket_id, "ticket", 999),
        (merch_id, "merch", 20),
    ]:
        db.add(
            Products(
                id=product_id,
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                name="The Luxor Eclipse Gathering"
                if category == "ticket"
                else "T-shirt",
                slug=f"product-{product_id}",
                category=category,
                price=price,
                attendee_category_id=category_id if category == "ticket" else None,
                is_active=True,
            )
        )
    headers = {"X-Tenant-Id": str(tenant_a.id)}
    if signed_in:
        human = Humans(tenant_id=tenant_a.id, email=body["buyer"]["email"])
        db.add(human)
        db.flush()
        headers["Authorization"] = (
            f"Bearer {create_access_token(subject=human.id, token_type='human')}"
        )
    db.commit()

    with (
        patch("app.core.rate_limit.get_redis", return_value=None),
        patch("app.services.simplefi.get_simplefi_client") as provider,
    ):
        provider.return_value.create_payment.return_value = SimpleNamespace(
            id=f"provider-{uuid.uuid4()}",
            status="pending",
            checkout_url="https://pay.test/simple-quantity",
            is_installment_plan=False,
        )
        response = client.post(
            f"/api/v1/checkout/{popup.slug}/{flow.slug}/purchase",
            headers=headers,
            json=body,
        )
    assert response.status_code == 200, response.text
    assert response.json()["checkout_url"] == "https://pay.test/simple-quantity"
    provider.return_value.create_payment.assert_called_once()
    payment_id = uuid.UUID(response.json()["payment_id"])
    recipients = db.exec(
        select(PaymentRecipients).where(PaymentRecipients.payment_id == payment_id)
    ).all()
    lines = db.exec(
        select(PaymentProducts).where(PaymentProducts.payment_id == payment_id)
    ).all()
    assert len(recipients) == 2
    assert all(
        r.human_id is None and r.existing_attendee_id is None for r in recipients
    )
    assert (
        len({p.payment_recipient_id for p in lines if p.product_id == ticket_id}) == 2
    )
    assert all(
        p.payment_recipient_id is None for p in lines if p.product_id == merch_id
    )
    assert db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all() == []

    payments_crud.approve_payment(db, payment_id)
    attendees = db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all()
    assert len(attendees) == 2
    assert all(a.category_id == category_id for a in attendees)
    tickets = db.exec(
        select(AttendeeProducts).where(AttendeeProducts.product_id == ticket_id)
    ).all()
    assert len(tickets) == 2
    assert len({t.attendee_id for t in tickets}) == 2
    # Reconciliation must not mint another pair if a webhook is delivered twice.
    payments_crud.approve_payment(db, payment_id)
    assert (
        len(
            db.exec(
                select(AttendeeProducts).where(AttendeeProducts.product_id == ticket_id)
            ).all()
        )
        == 2
    )
