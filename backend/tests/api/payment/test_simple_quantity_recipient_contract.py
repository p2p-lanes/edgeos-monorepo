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
from app.api.payment.models import PaymentProducts, PaymentRecipients, Payments
from app.api.product.models import Products
from app.api.ticketing_step.models import TicketingSteps
from app.core.security import create_access_token
from tests.api.payment.test_typed_payment_writes import (
    _open_context,
    _post_open,
    _product,
    _provider,
)

FIXTURE = (
    Path(__file__).resolve().parents[4] / "e2e/fixtures/simple-quantity-purchase.json"
)


@pytest.mark.parametrize("signed_in", [False, True])
@pytest.mark.parametrize("existing_attendee", [False, True])
@pytest.mark.parametrize("free", [False, True])
def test_portal_simple_quantity_contract_assigns_each_unit_to_buyer(
    client, db, tenant_a, signed_in, existing_attendee, free
):
    popup, flow = _open_context(db, tenant_a)
    # Keep the exact wire contract; namespace ids for the session-scoped DB.
    raw = FIXTURE.read_text()
    fixture = json.loads(raw)
    for product_id in {line["product_id"] for line in fixture["products"]}:
        raw = raw.replace(product_id, str(uuid.uuid4()))
    body = json.loads(raw)
    body["buyer"]["email"] = f"buyer-{uuid.uuid4().hex[:8]}@example.com"
    primary_category = db.exec(
        select(AttendeeCategories).where(
            AttendeeCategories.sales_flow_id == flow.id,
            AttendeeCategories.is_primary.is_(True),
        )
    ).one()

    ticket_id = uuid.UUID(body["products"][0]["product_id"])
    merch_id = uuid.UUID(body["products"][1]["product_id"])
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
                price=0 if free else price,
                is_active=True,
            )
        )
    headers = {"X-Tenant-Id": str(tenant_a.id)}
    if signed_in or existing_attendee:
        human = Humans(tenant_id=tenant_a.id, email=body["buyer"]["email"])
        db.add(human)
        db.flush()
    if signed_in:
        headers["Authorization"] = (
            f"Bearer {create_access_token(subject=human.id, token_type='human')}"
        )
    if existing_attendee:
        existing = Attendees(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            human_id=human.id,
            name="Returning Buyer",
            email=human.email,
        )
        db.add(existing)
    db.commit()

    with (
        patch("app.core.rate_limit.get_redis", return_value=None),
        patch("app.services.simplefi.get_simplefi_client") as provider,
        patch("app.api.checkout.router._send_payment_confirmed_email"),
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
    if free:
        assert response.json()["status"] == "approved"
        provider.assert_not_called()
    else:
        assert response.json()["checkout_url"] == "https://pay.test/simple-quantity"
        provider.return_value.create_payment.assert_called_once()
        assert len(
            db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all()
        ) == int(existing_attendee)
    payment_id = uuid.UUID(response.json()["payment_id"])
    payment = db.get(Payments, payment_id)
    assert payment is not None
    recipients = db.exec(
        select(PaymentRecipients).where(PaymentRecipients.payment_id == payment_id)
    ).all()
    lines = db.exec(
        select(PaymentProducts).where(PaymentProducts.payment_id == payment_id)
    ).all()
    assert len(recipients) == 1
    recipient = recipients[0]
    assert recipient.human_id == payment.buyer_human_id
    assert recipient.existing_attendee_id is None
    assert recipient.category_id == primary_category.id
    assert recipient.name == "Taylor Buyer"
    assert recipient.email == body["buyer"]["email"]
    assert {p.payment_recipient_id for p in lines if p.product_id == ticket_id} == {
        recipient.id
    }
    assert all(
        p.payment_recipient_id is None for p in lines if p.product_id == merch_id
    )
    payments_crud.approve_payment(db, payment_id)
    attendees = db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all()
    assert len(attendees) == 1
    attendee = attendees[0]
    assert attendee.human_id == payment.buyer_human_id
    assert attendee.managed_by_human_id is None
    if existing_attendee:
        assert attendee.id == existing.id
    tickets = db.exec(
        select(AttendeeProducts).where(AttendeeProducts.product_id == ticket_id)
    ).all()
    assert len(tickets) == 3
    assert {t.attendee_id for t in tickets} == {attendee.id}
    assert len({t.check_in_code for t in tickets}) == 3
    # Repeated webhooks must preserve both the person and the issued tickets.
    ticket_ids = {t.id for t in tickets}
    payments_crud.approve_payment(db, payment_id)
    assert {
        t.id
        for t in db.exec(
            select(AttendeeProducts).where(AttendeeProducts.product_id == ticket_id)
        ).all()
    } == ticket_ids
    assert (
        len(db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all()) == 1
    )


@pytest.mark.parametrize("existing_companion", [False, True])
@pytest.mark.parametrize("companion_key", ["guest", "open-ticket:guest"])
def test_open_tickets_share_explicit_buyer_and_preserve_companion(
    client, db, tenant_a, existing_companion, companion_key
):
    popup, flow = _open_context(db, tenant_a)
    ticket = _product(db, popup, "access")
    other_ticket = _product(db, popup, "access")
    buyer = Humans(tenant_id=tenant_a.id, email=f"buyer-{uuid.uuid4()}@example.com")
    db.add(buyer)
    db.flush()
    companion = {
        "recipient_key": companion_key,
        "name": "Identified Companion",
        "email": buyer.email,
    }
    if existing_companion:
        attendee = Attendees(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            managed_by_human_id=buyer.id,
            name=companion["name"],
            email=buyer.email,
        )
        db.add(attendee)
        db.flush()
        companion["existing_attendee_id"] = str(attendee.id)
    db.commit()

    with (
        patch("app.core.rate_limit.get_redis", return_value=None),
        patch("app.services.simplefi.get_simplefi_client") as provider,
    ):
        _provider(provider)
        response = _post_open(
            client,
            tenant_a,
            popup,
            flow,
            products=[
                {"product_id": str(ticket.id), "quantity": 2},
                {"product_id": str(other_ticket.id)},
                {"product_id": str(ticket.id), "recipient_key": "self"},
                {
                    "product_id": str(ticket.id),
                    "recipient_key": companion_key,
                    "quantity": 2,
                },
            ],
            recipients=[
                {"recipient_key": "self", "human_id": str(buyer.id), "name": "Buyer"},
                companion,
            ],
            email=buyer.email,
        )
    assert response.status_code == 200, response.text
    payment_id = uuid.UUID(response.json()["payment_id"])
    recipients = db.exec(
        select(PaymentRecipients).where(PaymentRecipients.payment_id == payment_id)
    ).all()
    assert len(recipients) == 2
    buyer_snapshot = next(r for r in recipients if r.human_id == buyer.id)
    companion_snapshot = next(r for r in recipients if r.recipient_key == companion_key)
    assert buyer_snapshot.recipient_key == "self"
    assert companion_snapshot.human_id is None
    assert companion_snapshot.category_id is None

    payments_crud.approve_payment(db, payment_id)
    payments_crud.approve_payment(db, payment_id)
    db.refresh(buyer_snapshot)
    db.refresh(companion_snapshot)
    assert companion_snapshot.attendee_id != buyer_snapshot.attendee_id
    if existing_companion:
        assert companion_snapshot.attendee_id == attendee.id
    tickets = db.exec(
        select(AttendeeProducts).where(AttendeeProducts.payment_id == payment_id)
    ).all()
    assert len(tickets) == 6
    assert sum(t.attendee_id == buyer_snapshot.attendee_id for t in tickets) == 4
    assert sum(t.attendee_id == companion_snapshot.attendee_id for t in tickets) == 2
    assert (
        len(db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all()) == 2
    )


@pytest.mark.parametrize("restriction", ["companion_role", "required_field"])
def test_default_ticket_holder_still_enforces_flow_role_rules(
    client, db, tenant_a, restriction
):
    popup, flow = _open_context(db, tenant_a)
    ticket = _product(db, popup, "access")
    if restriction == "companion_role":
        category = AttendeeCategories(
            tenant_id=tenant_a.id, popup_id=popup.id, sales_flow_id=flow.id, key="guest"
        )
        db.add(category)
        db.flush()
        step = db.exec(
            select(TicketingSteps).where(
                TicketingSteps.sales_flow_id == flow.id,
                TicketingSteps.template == "ticket-select",
            )
        ).one()
        step.template_config = {
            "sections": [
                {
                    "product_ids": [str(ticket.id)],
                    "attendee_categories": [str(category.id)],
                }
            ]
        }
        db.add(step)
    else:
        category = db.exec(
            select(AttendeeCategories).where(
                AttendeeCategories.sales_flow_id == flow.id,
                AttendeeCategories.is_primary.is_(True),
            )
        ).one()
        category.required_fields = [
            {"name": "birth_date", "type": "date", "required": True}
        ]
        db.add(category)
    db.commit()
    with (
        patch("app.core.rate_limit.get_redis", return_value=None),
        patch("app.services.simplefi.get_simplefi_client") as provider,
    ):
        response = _post_open(
            client, tenant_a, popup, flow, [{"product_id": str(ticket.id)}]
        )
    assert response.status_code == 422, response.text
    provider.assert_not_called()
    assert db.exec(select(Payments).where(Payments.popup_id == popup.id)).all() == []
