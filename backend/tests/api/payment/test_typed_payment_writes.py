import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlmodel import select

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, PaymentRecipients, Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.core.security import create_access_token
from tests._flow_helpers import seed_default_steps
from tests.api.payment.test_payment_recipients import _payment_context


@pytest.fixture(autouse=True)
def disable_purchase_rate_limit():
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield


def _application_context(db, tenant):
    popup, flow, human, _, application, _ = _payment_context(db, tenant)
    return popup, flow, human, application


def _open_context(db, tenant):
    popup = Popups(
        tenant_id=tenant.id,
        name="Typed open writes",
        slug=f"typed-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.direct.value,
        status="active",
        simplefi_api_key="test-key",
        currency="USD",
    )
    db.add(popup)
    db.flush()
    flow = seed_default_steps(db, popup, sale_type=SaleType.direct.value)
    db.commit()
    return popup, flow


def _product(db, popup, fulfillment_type, price="25"):
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"{fulfillment_type or 'legacy'} product",
        slug=f"typed-product-{uuid.uuid4().hex[:8]}",
        price=Decimal(price),
        category="ticket",
        fulfillment_type=fulfillment_type,
        is_active=True,
    )
    db.add(product)
    db.commit()
    return product


def _auth(human):
    token = create_access_token(subject=human.id, token_type="human")
    return {"Authorization": f"Bearer {token}"}


def _provider(mock_get_client, label="typed"):
    mock_get_client.return_value.create_payment.return_value = SimpleNamespace(
        id=f"provider-{label}-{uuid.uuid4().hex[:6]}",
        status="pending",
        checkout_url=f"https://pay.test/{label}",
        is_installment_plan=False,
    )


def _recipient(key, **values):
    return {"recipient_key": key, "name": key.title(), **values}


def _rows(db, model, payment_id):
    return db.exec(select(model).where(model.payment_id == payment_id)).all()


def _attendees(db, popup):
    return db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all()


def _post_authenticated(client, human, application, products, recipients=()):
    return client.post(
        "/api/v1/payments/my",
        headers=_auth(human),
        json={
            "application_id": str(application.id),
            "products": products,
            "recipients": list(recipients),
        },
    )


def _post_open(
    client, tenant, popup, flow, products, recipients=(), email="open@test.com"
):
    return client.post(
        f"/api/v1/checkout/{popup.slug}/{flow.slug}/purchase",
        headers={"X-Tenant-Id": str(tenant.id)},
        json={
            "products": products,
            "recipients": list(recipients),
            "buyer": {"email": email, "first_name": "Open", "last_name": "Buyer"},
        },
    )


@pytest.mark.parametrize("fulfillment_type", ["access", "participant"])
@pytest.mark.parametrize("identity", ["missing", "dual"])
def test_authenticated_recipient_lines_require_one_structural_identity(
    client, db, tenant_a, fulfillment_type, identity
):
    popup, _, human, application = _application_context(db, tenant_a)
    product = _product(db, popup, fulfillment_type)
    line = {"product_id": str(product.id)}
    recipients = []
    if identity == "dual":
        line |= {"attendee_id": str(uuid.uuid4()), "recipient_key": "guest"}
        recipients = [_recipient("guest")]

    with patch("app.services.simplefi.get_simplefi_client") as provider:
        response = _post_authenticated(client, human, application, [line], recipients)

    assert response.status_code == 422
    if identity == "missing":
        assert response.json()["detail"] == "Payment product identity is not valid"
    provider.assert_not_called()


@pytest.mark.parametrize("identity", [None, "attendee", "recipient"])
def test_authenticated_scoped_legacy_order_identity_is_validated_then_discarded(
    client, db, tenant_a, identity
):
    popup, _, human, application = _application_context(db, tenant_a)
    product = _product(db, popup, "order")
    line = {"product_id": str(product.id)}
    recipients = []
    if identity is None:
        line["fulfillment_type"] = "access"
    elif identity == "attendee":
        attendee = Attendees(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            application_id=application.id,
            name="Legacy scoped attendee",
        )
        db.add(attendee)
        db.commit()
        line["attendee_id"] = str(attendee.id)
    else:
        line["recipient_key"] = "legacy-order"
        recipients = [_recipient("legacy-order")]

    with patch("app.services.simplefi.get_simplefi_client") as provider:
        _provider(provider, f"normalized-{identity}")
        response = _post_authenticated(client, human, application, [line], recipients)

    assert response.status_code == 201, response.text
    payment_id = response.json()["id"]
    snapshot = _rows(db, PaymentProducts, payment_id)[0]
    assert (
        snapshot.fulfillment_type,
        snapshot.attendee_id,
        snapshot.payment_recipient_id,
    ) == (
        "order",
        None,
        None,
    )
    assert _rows(db, PaymentRecipients, payment_id) == []
    payment = db.get(Payments, payment_id)
    assert (payment.status, payment.buyer_human_id) == ("pending", human.id)
    if identity is None:
        assert _attendees(db, popup) == []
    provider.assert_called_once()


def test_unclassified_product_rejects_before_supersede_or_provider(
    client, db, tenant_a
):
    popup, _, human, application = _application_context(db, tenant_a)
    product = _product(db, popup, None)

    with (
        patch("app.core.config.settings.SUPERSEDE_PENDING_ENABLED", True),
        patch.object(payments_crud, "supersede_pending_payments") as supersede,
        patch("app.services.simplefi.get_simplefi_client") as provider,
    ):
        response = _post_authenticated(
            client, human, application, [{"product_id": str(product.id)}]
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Some products are not available or inactive"
    supersede.assert_not_called()
    provider.assert_not_called()


def test_authenticated_mixed_lines_keep_typed_separate_ownership(client, db, tenant_a):
    popup, _, human, application = _application_context(db, tenant_a)
    products = {
        kind: _product(db, popup, kind) for kind in ("access", "participant", "order")
    }
    ownership = [
        ("access", "access-owner", "order"),
        ("participant", "meal-owner", "access"),
        ("order", "order-old", "participant"),
    ]
    recipients = [_recipient(key) for _, key, _ in ownership]
    lines = [
        {
            "product_id": str(products[kind].id),
            "recipient_key": key,
            "fulfillment_type": spoof,
        }
        for kind, key, spoof in ownership
    ]

    with patch("app.services.simplefi.get_simplefi_client") as provider:
        _provider(provider, "mixed")
        response = _post_authenticated(client, human, application, lines, recipients)

    assert response.status_code == 201, response.text
    payment_id = response.json()["id"]
    snapshots = {
        row.fulfillment_type: row for row in _rows(db, PaymentProducts, payment_id)
    }
    assert set(snapshots) == {"access", "participant", "order"}
    assert snapshots["access"].payment_recipient_id is not None
    assert snapshots["participant"].payment_recipient_id is not None
    assert (
        snapshots["access"].payment_recipient_id
        != snapshots["participant"].payment_recipient_id
    )
    assert (
        snapshots["order"].attendee_id,
        snapshots["order"].payment_recipient_id,
    ) == (
        None,
        None,
    )
    recipient_keys = {
        row.recipient_key for row in _rows(db, PaymentRecipients, payment_id)
    }
    assert recipient_keys == {"access-owner", "meal-owner"}
    assert _attendees(db, popup) == []


def test_open_side_only_order_is_pending_without_recipient_or_attendee(
    client, db, tenant_a
):
    popup, flow = _open_context(db, tenant_a)
    product = _product(db, popup, "order")

    with patch("app.services.simplefi.get_simplefi_client") as provider:
        _provider(provider, "open-order")
        response = _post_open(
            client,
            tenant_a,
            popup,
            flow,
            [
                {
                    "product_id": str(product.id),
                    "quantity": 2,
                    "fulfillment_type": "access",
                }
            ],
            email="open-order@test.com",
        )

    assert response.status_code == 200, response.text
    payment = db.get(Payments, uuid.UUID(response.json()["payment_id"]))
    snapshots = _rows(db, PaymentProducts, payment.id)
    assert (payment.status, payment.buyer_human_id is not None) == ("pending", True)
    assert len(snapshots) == 2
    assert all(
        (row.fulfillment_type, row.attendee_id, row.payment_recipient_id)
        == ("order", None, None)
        for row in snapshots
    )
    assert _rows(db, PaymentRecipients, payment.id) == []
    assert _attendees(db, popup) == []


def test_open_unclassified_product_rejects_before_supersede_or_provider(
    client, db, tenant_a
):
    popup, flow = _open_context(db, tenant_a)
    product = _product(db, popup, None)
    with (
        patch.object(payments_crud, "supersede_pending_payments") as supersede,
        patch("app.services.simplefi.get_simplefi_client") as provider,
    ):
        response = _post_open(
            client, tenant_a, popup, flow, [{"product_id": str(product.id)}]
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "Some products are not available or inactive"
    supersede.assert_not_called()
    provider.assert_not_called()


def test_zero_amount_access_snapshots_server_fulfillment_type(client, db, tenant_a):
    popup, _, human, application = _application_context(db, tenant_a)
    product = _product(db, popup, "access", price="0")
    recipient = _recipient("free-access")
    lines = [{"product_id": str(product.id), "recipient_key": "free-access"}]

    with patch("app.services.simplefi.get_simplefi_client") as provider:
        response = _post_authenticated(client, human, application, lines, [recipient])

    assert response.status_code == 201, response.text
    assert response.json()["status"] == "approved"
    payment_id = response.json()["id"]
    snapshot = _rows(db, PaymentProducts, payment_id)[0]
    assert (snapshot.fulfillment_type, snapshot.payment_recipient_id is not None) == (
        "access",
        True,
    )
    provider.assert_not_called()


def test_zero_amount_order_approves_without_recipient_attendee_or_holding(
    client, db, tenant_a
):
    popup, _, human, application = _application_context(db, tenant_a)
    product = _product(db, popup, "order", price="0")

    response = _post_authenticated(
        client, human, application, [{"product_id": str(product.id)}]
    )

    assert response.status_code == 201, response.text
    payment_id = response.json()["id"]
    snapshot = _rows(db, PaymentProducts, payment_id)[0]
    assert response.json()["status"] == "approved"
    assert (snapshot.fulfillment_type, snapshot.attendee_id) == ("order", None)
    assert _rows(db, PaymentRecipients, payment_id) == []
    assert _rows(db, AttendeeProducts, payment_id) == []
    assert _attendees(db, popup) == []
