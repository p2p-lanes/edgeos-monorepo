"""Tests for POST /checkout/{slug}/purchase — CAP-C."""

import base64
import hashlib
import hmac
import json
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.attendee.models import Attendees
from app.api.coupon.models import Coupons
from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.payment.models import Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.utils.encryption import encrypt
from tests.conftest import with_origin


@pytest.fixture(autouse=True)
def disable_purchase_rate_limit() -> None:
    """Keep purchase tests isolated from shared rate-limit state.

    The dedicated rate-limit test overrides this fixture with its own mocked
    Redis client to keep asserting the 429 behavior.
    """
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    sale_type: str = SaleType.direct.value,
    status: str = "active",
    slug_prefix: str = "purchase",
) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Purchase Popup {slug_prefix}",
        slug=f"{slug_prefix}-{uuid.uuid4().hex[:6]}",
        sale_type=sale_type,
        status=status,
        simplefi_api_key="simplefi_test_key",
        currency="USD",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_product(
    db: Session,
    popup: Popups,
    *,
    name: str = "GA",
    price: str = "100.00",
    sale_starts_at: datetime | None = None,
    sale_ends_at: datetime | None = None,
) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=name,
        slug=f"prod-{uuid.uuid4().hex[:6]}",
        price=price,
        category="ticket",
        is_active=True,
        sale_starts_at=sale_starts_at,
        sale_ends_at=sale_ends_at,
    )
    db.add(product)
    db.flush()
    return product


def _make_coupon(
    db: Session,
    popup: Popups,
    *,
    code: str,
    discount_value: int,
) -> Coupons:
    coupon = Coupons(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        code=code,
        discount_value=discount_value,
        is_active=True,
    )
    db.add(coupon)
    db.flush()
    return coupon


def _make_section(
    db: Session, popup: Popups, *, label: str = "Buyer Info"
) -> FormSections:
    section = FormSections(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        label=label,
        order=0,
        kind="standard",
    )
    db.add(section)
    db.flush()
    return section


def _make_field(
    db: Session, popup: Popups, section: FormSections, *, required: bool = True
) -> FormFields:
    field = FormFields(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        section_id=section.id,
        name=f"first_name_{uuid.uuid4().hex[:4]}",
        label="Nombre",
        field_type="text",
        required=required,
        position=0,
    )
    db.add(field)
    db.flush()
    return field


def test_purchase_happy_path_creates_payment_and_attendees(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="happy")
    product = _make_product(db, popup, price="120.00")
    section = _make_section(db, popup)
    field = _make_field(db, popup, section)
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_purchase_1",
            status="pending",
            checkout_url="https://simplefi.test/checkout/happy",
            is_installment_plan=False,
        )

        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 2}],
                "buyer": {
                    "email": "buyer@test.com",
                    "first_name": "Matias",
                    "last_name": "Walter",
                    "form_data": {field.name: "Matias"},
                },
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "pending"
    assert body["checkout_url"] == "https://simplefi.test/checkout/happy"
    assert body["amount"] == "240.00"
    assert body["currency"] == "USD"

    payment = db.exec(select(Payments).where(Payments.popup_id == popup.id)).first()
    assert payment is not None
    attendees = list(
        db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all()
    )
    # New design: 1 attendee per (human, popup), 2 AttendeeProducts rows for qty=2
    assert len(attendees) == 1


def test_purchase_pending_open_checkout_sends_initiate_checkout_capi(
    client: TestClient,
    db: Session,
) -> None:
    tenant = Tenants(
        id=uuid.uuid4(),
        name="CAPI Checkout Tenant",
        slug=f"capi-checkout-{uuid.uuid4().hex[:6]}",
        meta_tracking_enabled=True,
        meta_pixel_id="123456789",
        meta_capi_access_token_encrypted=encrypt("test-token"),
    )
    db.add(tenant)
    db.flush()
    popup = _make_popup(db, tenant, slug_prefix="capi-checkout")
    popup.currency = "ARS"
    product = _make_product(db, popup, name="ARS Pass", price="7500.00")
    db.commit()

    sent_events: list[object] = []

    async def capture_event(event: object) -> None:
        sent_events.append(event)

    with (
        patch("app.services.meta_capi.send_prepared_purchase_event", capture_event),
        patch("app.services.simplefi.get_simplefi_client") as mock_get_client,
    ):
        mock_get_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_capi_checkout_1",
            status="pending",
            checkout_url="https://simplefi.test/checkout/capi",
            is_installment_plan=False,
        )

        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 2}],
                "buyer": {
                    "email": "buyer@test.com",
                    "first_name": "Meta",
                    "last_name": "Buyer",
                    "form_data": {},
                },
                "fbc": "fb.1.1710000000.click",
                "fbp": "fb.1.1710000000.browser",
            },
            headers={
                "X-Tenant-Id": str(tenant.id),
                "User-Agent": "Checkout Test UA",
                "X-Forwarded-For": "203.0.113.20",
            },
        )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "pending"
    assert len(sent_events) == 1
    event = sent_events[0]
    payload_event = event.payload["data"][0]
    payment_id = response.json()["payment_id"]
    assert event.event_id == f"EVT_INITIATE_CHECKOUT_{payment_id}"
    assert payload_event["event_name"] == "InitiateCheckout"
    assert payload_event["custom_data"] == {
        "currency": "ARS",
        "value": 15000.0,
        "content_ids": [str(product.id)],
        "contents": [
            {
                "id": str(product.id),
                "quantity": 2,
                "item_price": 7500.0,
                "title": "ARS Pass",
            }
        ],
        "num_items": 2,
        "popup_id": str(popup.id),
        "popup_slug": popup.slug,
        "popup_name": popup.name,
    }
    user_data = payload_event["user_data"]
    assert user_data["em"]
    assert user_data["fn"]
    assert user_data["ln"]
    assert user_data["fbc"] == "fb.1.1710000000.click"
    assert user_data["fbp"] == "fb.1.1710000000.browser"
    assert user_data["client_ip_address"] == "203.0.113.20"
    assert user_data["client_user_agent"] == "Checkout Test UA"


def test_purchase_non_pending_open_checkout_does_not_send_initiate_checkout_capi(
    client: TestClient,
    db: Session,
) -> None:
    tenant = Tenants(
        id=uuid.uuid4(),
        name="CAPI Approved Checkout Tenant",
        slug=f"capi-approved-checkout-{uuid.uuid4().hex[:6]}",
        meta_tracking_enabled=True,
        meta_pixel_id="123456789",
        meta_capi_access_token_encrypted=encrypt("test-token"),
    )
    db.add(tenant)
    db.flush()
    popup = _make_popup(db, tenant, slug_prefix="capi-approved-checkout")
    product = _make_product(db, popup, price="100.00")
    db.commit()

    async def noop_send_confirmation(*_args: object, **_kwargs: object) -> None:
        return None

    with (
        patch(
            "app.api.checkout.router.enqueue_initiate_checkout_event"
        ) as mock_initiate,
        patch("app.api.checkout.router.enqueue_purchase_event"),
        patch(
            "app.api.checkout.router._send_payment_confirmed_email",
            noop_send_confirmation,
        ),
        patch("app.services.simplefi.get_simplefi_client") as mock_get_client,
    ):
        mock_get_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_capi_approved_checkout_1",
            status="approved",
            checkout_url="https://simplefi.test/checkout/approved",
            is_installment_plan=False,
        )

        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 1}],
                "buyer": {
                    "email": "buyer@test.com",
                    "first_name": "Meta",
                    "last_name": "Buyer",
                    "form_data": {},
                },
            },
            headers={"X-Tenant-Id": str(tenant.id)},
        )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "approved"
    assert response.json()["checkout_url"] == "https://simplefi.test/checkout/approved"
    mock_initiate.assert_not_called()


def test_purchase_initiate_checkout_capi_failure_does_not_block_response(
    client: TestClient,
    db: Session,
) -> None:
    tenant = Tenants(
        id=uuid.uuid4(),
        name="CAPI Failure Tenant",
        slug=f"capi-failure-{uuid.uuid4().hex[:6]}",
        meta_tracking_enabled=True,
        meta_pixel_id="123456789",
        meta_capi_access_token_encrypted=encrypt("test-token"),
    )
    db.add(tenant)
    db.flush()
    popup = _make_popup(db, tenant, slug_prefix="capi-failure")
    product = _make_product(db, popup, price="100.00")
    db.commit()

    async def fail_send(_event: object) -> None:
        raise RuntimeError("Meta is unavailable")

    with (
        patch("app.services.meta_capi.send_prepared_purchase_event", fail_send),
        patch("app.services.simplefi.get_simplefi_client") as mock_get_client,
    ):
        mock_get_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_capi_failure_1",
            status="pending",
            checkout_url="https://simplefi.test/checkout/failure",
            is_installment_plan=False,
        )

        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 1}],
                "buyer": {
                    "email": "buyer@test.com",
                    "first_name": "Meta",
                    "last_name": "Buyer",
                    "form_data": {},
                },
            },
            headers={"X-Tenant-Id": str(tenant.id)},
        )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "pending"


def test_purchase_unknown_slug_returns_404(
    client: TestClient, tenant_a: Tenants
) -> None:
    response = client.post(
        "/api/v1/checkout/does-not-exist/purchase",
        json={
            "products": [{"product_id": str(uuid.uuid4()), "quantity": 1}],
            "buyer": {
                "email": "buyer@test.com",
                "first_name": "Matias",
                "last_name": "Walter",
                "form_data": {},
            },
        },
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )
    assert response.status_code == 404, response.text


def test_purchase_application_popup_returns_403(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(
        db, tenant_a, sale_type=SaleType.application.value, slug_prefix="app"
    )
    product = _make_product(db, popup)
    db.commit()

    response = client.post(
        f"/api/v1/checkout/{popup.slug}/purchase",
        json={
            "products": [{"product_id": str(product.id), "quantity": 1}],
            "buyer": {
                "email": "buyer@test.com",
                "first_name": "Matias",
                "last_name": "Walter",
                "form_data": {},
            },
        },
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )
    assert response.status_code == 403, response.text


def test_purchase_missing_required_field_returns_422(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="missing")
    product = _make_product(db, popup)
    section = _make_section(db, popup)
    _make_field(db, popup, section, required=True)
    db.commit()

    response = client.post(
        f"/api/v1/checkout/{popup.slug}/purchase",
        json={
            "products": [{"product_id": str(product.id), "quantity": 1}],
            "buyer": {
                "email": "buyer@test.com",
                "first_name": "Matias",
                "last_name": "Walter",
                "form_data": {},
            },
        },
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )
    assert response.status_code == 422, response.text


def test_purchase_provider_failure_returns_502(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="provider-fail")
    product = _make_product(db, popup)
    section = _make_section(db, popup)
    field = _make_field(db, popup, section)
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.side_effect = RuntimeError("boom")

        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 1}],
                "buyer": {
                    "email": "buyer@test.com",
                    "first_name": "Matias",
                    "last_name": "Walter",
                    "form_data": {field.name: "Matias"},
                },
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )

    assert response.status_code == 502, response.text


def test_zero_amount_purchase_attempts_capi_when_email_fails(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="free-capi")
    product = _make_product(db, popup, price="75.00")
    _make_coupon(db, popup, code="FREEPASS", discount_value=100)
    db.commit()

    async def failing_email(*_args, **_kwargs) -> None:
        raise RuntimeError("email failed")

    with (
        patch("app.api.checkout.router._send_payment_confirmed_email", failing_email),
        patch("app.api.checkout.router.enqueue_purchase_event") as mock_enqueue,
        patch("app.services.simplefi.get_simplefi_client") as mock_get_client,
    ):
        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 1}],
                "buyer": {
                    "email": "buyer@test.com",
                    "first_name": "Matias",
                    "last_name": "Walter",
                    "form_data": {},
                },
                "coupon_code": "FREEPASS",
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "approved"
    mock_get_client.assert_not_called()
    mock_enqueue.assert_called_once()


def test_zero_amount_purchase_returns_custom_success_redirect_url(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    """A zero-amount approval bypasses SimpleFi, so the response carries the
    popup's custom open-checkout success URL in redirect_url for the portal to
    redirect to. checkout_url stays empty (no provider checkout)."""
    popup = _make_popup(db, tenant_a, slug_prefix="free-redirect")
    popup.open_checkout_success_url = "https://brand.example.com/thank-you"
    db.add(popup)
    product = _make_product(db, popup, price="75.00")
    _make_coupon(db, popup, code="FREEPASS", discount_value=100)
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 1}],
                "buyer": {
                    "email": "buyer@test.com",
                    "first_name": "Matias",
                    "last_name": "Walter",
                    "form_data": {},
                },
                "coupon_code": "FREEPASS",
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "approved"
    assert body["checkout_url"] == ""
    assert body["redirect_url"] == "https://brand.example.com/thank-you"
    mock_get_client.assert_not_called()


def _verify_signed_redirect(url: str, secret: str) -> dict:
    """Verify a signed thank-you URL the way an external page would, returning
    the recovered payload. Raises AssertionError on a bad signature."""
    query = parse_qs(urlparse(url).query)
    d = query["d"][0]
    sig = query["sig"][0]
    expected = hmac.new(secret.encode(), d.encode("ascii"), hashlib.sha256).hexdigest()
    assert hmac.compare_digest(sig, expected), "signature mismatch"
    padding = "=" * (-len(d) % 4)
    return json.loads(base64.urlsafe_b64decode(d + padding))


def test_paid_purchase_signs_order_payload_into_simplefi_success_url(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    """A paid open-checkout purchase hands SimpleFi a success URL carrying the
    HMAC-signed order snapshot, so the external thank-you page can verify it."""
    secret = "amanita-secret"
    popup = _make_popup(db, tenant_a, slug_prefix="paid-signed")
    popup.open_checkout_success_url = "https://brand.example.com/thank-you"
    popup.open_checkout_signing_secret = secret
    db.add(popup)
    product = _make_product(db, popup, price="120.00")
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_signed_1",
            status="pending",
            checkout_url="https://simplefi.test/checkout/signed",
            is_installment_plan=False,
        )
        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 2}],
                "buyer": {
                    "email": "buyer@test.com",
                    "first_name": "Matias",
                    "last_name": "Walter",
                    "form_data": {},
                },
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )

        assert response.status_code == 200, response.text
        success_url = mock_get_client.return_value.create_payment.call_args.kwargs[
            "success_path"
        ]

    assert success_url.startswith("https://brand.example.com/thank-you")
    payload = _verify_signed_redirect(success_url, secret)
    assert payload["first_name"] == "Matias"
    assert payload["amount_total"] == "240.00"
    assert payload["currency"] == "USD"
    assert payload["items"] == [{"name": product.name, "quantity": 2}]
    assert payload["email_hash"] == hashlib.sha256(b"buyer@test.com").hexdigest()


def test_zero_amount_purchase_signs_order_payload_into_redirect_url(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    """A zero-amount purchase returns redirect_url with the signed order payload
    when the popup configures a signing secret."""
    secret = "amanita-secret"
    popup = _make_popup(db, tenant_a, slug_prefix="free-signed")
    popup.open_checkout_success_url = "https://brand.example.com/thank-you"
    popup.open_checkout_signing_secret = secret
    db.add(popup)
    product = _make_product(db, popup, price="75.00")
    _make_coupon(db, popup, code="FREEPASS", discount_value=100)
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 1}],
                "buyer": {
                    "email": "buyer@test.com",
                    "first_name": "Matias",
                    "last_name": "Walter",
                    "form_data": {},
                },
                "coupon_code": "FREEPASS",
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "approved"
    assert body["checkout_url"] == ""
    payload = _verify_signed_redirect(body["redirect_url"], secret)
    assert payload["amount_total"] == "0.00"
    assert payload["items"] == [{"name": product.name, "quantity": 1}]
    mock_get_client.assert_not_called()


def _decode_data_param(url: str) -> dict:
    """Decode the unsigned ``data`` param from a portal thank-you URL."""
    data = parse_qs(urlparse(url).query)["data"][0]
    padding = "=" * (-len(data) % 4)
    return json.loads(base64.urlsafe_b64decode(data + padding))


def test_paid_purchase_injects_order_data_into_portal_thank_you(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    """With no custom success URL, the paid flow sends SimpleFi the portal
    thank-you URL carrying the (unsigned) order data so the page can render it."""
    popup = _make_popup(db, tenant_a, slug_prefix="paid-internal-data")
    product = _make_product(db, popup, price="120.00")
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_internal_1",
            status="pending",
            checkout_url="https://simplefi.test/checkout/internal",
            is_installment_plan=False,
        )
        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 2}],
                "buyer": {
                    "email": "buyer@test.com",
                    "first_name": "Matias",
                    "last_name": "Walter",
                    "form_data": {},
                },
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 200, response.text
        success_url = mock_get_client.return_value.create_payment.call_args.kwargs[
            "success_path"
        ]

    assert f"/checkout/{popup.slug}/thank-you" in success_url
    assert "sig=" not in success_url  # portal page is ours — no signature
    payload = _decode_data_param(success_url)
    assert payload["first_name"] == "Matias"
    assert payload["amount_total"] == "240.00"
    assert payload["items"] == [{"name": product.name, "quantity": 2}]


def test_zero_amount_purchase_injects_order_data_into_portal_thank_you(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    """With no custom success URL, the zero-amount flow returns the portal
    thank-you URL with the order data so the page can render the summary."""
    popup = _make_popup(db, tenant_a, slug_prefix="free-internal-data")
    product = _make_product(db, popup, price="75.00")
    _make_coupon(db, popup, code="FREEPASS", discount_value=100)
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 1}],
                "buyer": {
                    "email": "buyer@test.com",
                    "first_name": "Matias",
                    "last_name": "Walter",
                    "form_data": {},
                },
                "coupon_code": "FREEPASS",
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "approved"
    redirect_url = body["redirect_url"]
    assert f"/checkout/{popup.slug}/thank-you" in redirect_url
    payload = _decode_data_param(redirect_url)
    assert payload["amount_total"] == "0.00"
    assert payload["items"] == [{"name": product.name, "quantity": 1}]
    mock_get_client.assert_not_called()


def test_purchase_with_ended_sale_window_returns_422(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    """Product whose sale_ends_at has already passed cannot be purchased."""
    popup = _make_popup(db, tenant_a, slug_prefix="ended")
    # sale_ends_at = yesterday 00:00 UTC → exclusive instant, means last on-sale
    # day was the day before yesterday. derive_product_state → ended.
    yesterday_midnight = datetime.now(UTC).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) - timedelta(days=1)
    product = _make_product(db, popup, sale_ends_at=yesterday_midnight)
    section = _make_section(db, popup)
    field = _make_field(db, popup, section)
    db.commit()

    response = client.post(
        f"/api/v1/checkout/{popup.slug}/purchase",
        json={
            "products": [{"product_id": str(product.id), "quantity": 1}],
            "buyer": {
                "email": "buyer@test.com",
                "first_name": "Matias",
                "last_name": "Walter",
                "form_data": {field.name: "Matias"},
            },
        },
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 422, response.text
    assert "not on sale" in response.json()["detail"]


def test_purchase_with_upcoming_sale_window_returns_422(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    """Product whose sale_starts_at is in the future cannot be purchased yet."""
    popup = _make_popup(db, tenant_a, slug_prefix="upcoming")
    tomorrow_midnight = datetime.now(UTC).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) + timedelta(days=2)
    product = _make_product(db, popup, sale_starts_at=tomorrow_midnight)
    section = _make_section(db, popup)
    field = _make_field(db, popup, section)
    db.commit()

    response = client.post(
        f"/api/v1/checkout/{popup.slug}/purchase",
        json={
            "products": [{"product_id": str(product.id), "quantity": 1}],
            "buyer": {
                "email": "buyer@test.com",
                "first_name": "Matias",
                "last_name": "Walter",
                "form_data": {field.name: "Matias"},
            },
        },
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 422, response.text
    assert "not on sale" in response.json()["detail"]


def test_purchase_rate_limit_returns_429(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="rate-limit")
    product = _make_product(db, popup)
    section = _make_section(db, popup)
    field = _make_field(db, popup, section)
    db.commit()

    mock_redis = __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock()
    mock_redis.get.return_value = "10"
    mock_redis.ttl.return_value = 50

    with patch("app.core.rate_limit.get_redis", return_value=mock_redis):
        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 1}],
                "buyer": {
                    "email": "buyer@test.com",
                    "first_name": "Matias",
                    "last_name": "Walter",
                    "form_data": {field.name: "Matias"},
                },
            },
            headers={"X-Forwarded-For": "7.7.7.7", "X-Tenant-Id": str(tenant_a.id)},
        )

    assert response.status_code == 429, response.text
    assert "Retry-After" in response.headers


# ---------------------------------------------------------------------------
# Phase 3 — Tenant-scoped purchase tests (T-3.1)
# ---------------------------------------------------------------------------


def test_purchase_resolves_per_tenant(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    """Purchase with origin resolving to tenant A hits tenant A's popup."""
    popup = _make_popup(db, tenant_a, slug_prefix="per-tenant")
    product = _make_product(db, popup, price="50.00")
    section = _make_section(db, popup)
    field = _make_field(db, popup, section)
    db.commit()

    mock_redis = __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock()
    mock_redis.get.return_value = None  # no prior requests — bypass rate limit
    mock_redis.ttl.return_value = -1

    with (
        patch("app.services.simplefi.get_simplefi_client") as mock_client,
        patch("app.core.rate_limit.get_redis", return_value=mock_redis),
    ):
        mock_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_per_tenant_1",
            status="pending",
            checkout_url="https://simplefi.test/checkout/per-tenant",
            is_installment_plan=False,
        )

        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 1}],
                "buyer": {
                    "email": "buyer@test.com",
                    "first_name": "Test",
                    "last_name": "User",
                    "form_data": {field.name: "Test"},
                },
            },
            headers=with_origin("test-tenant-a.localhost"),
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "pending"


def test_purchase_unknown_origin_returns_404(
    client: TestClient,
) -> None:
    """No Origin and no X-Tenant-Id → 404 from resolver, no payment created."""
    response = client.post(
        "/api/v1/checkout/summer-fest/purchase",
        json={
            "products": [{"product_id": str(uuid.uuid4()), "quantity": 1}],
            "buyer": {
                "email": "buyer@test.com",
                "first_name": "Test",
                "last_name": "User",
                "form_data": {},
            },
        },
    )
    assert response.status_code == 404, response.text


def test_purchase_creates_installment_plan_when_popup_enabled(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    """Open-ticketing checkout must honor the popup's installments config —
    the same eligibility the pass-purchase path applies."""
    popup = _make_popup(db, tenant_a, slug_prefix="instplan")
    popup.installments_enabled = True
    popup.installments_deadline = datetime.now(UTC) + timedelta(days=365)
    popup.installments_max = 6
    popup.installments_interval = "month"
    popup.installments_interval_count = 1
    product = _make_product(db, popup, price="300.00")
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_plan_1",
            status="pending",
            checkout_url="https://simplefi.test/plan/sf_plan_1",
            is_installment_plan=True,
        )

        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 1}],
                "buyer": {
                    "email": "plan-buyer@test.com",
                    "first_name": "Plan",
                    "last_name": "Buyer",
                    "form_data": {},
                },
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )

    assert response.status_code == 200, response.text

    call_kwargs = mock_get_client.return_value.create_payment.call_args.kwargs
    assert call_kwargs["max_installments"] is not None
    assert call_kwargs["max_installments"] >= 2
    assert call_kwargs["user_email"] == "plan-buyer@test.com"
    assert call_kwargs["plan_name"] == popup.name

    payment = db.exec(select(Payments).where(Payments.popup_id == popup.id)).first()
    assert payment is not None
    assert payment.is_installment_plan is True
    assert payment.installments_paid == 0
    assert payment.external_id == "sf_plan_1"


def test_purchase_one_shot_when_installments_deadline_too_close(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    """Installments enabled but fewer than 2 monthly cycles fit before the
    deadline — fall back to a one-shot payment request."""
    popup = _make_popup(db, tenant_a, slug_prefix="instclose")
    popup.installments_enabled = True
    popup.installments_deadline = datetime.now(UTC) + timedelta(days=20)
    popup.installments_max = 6
    popup.installments_interval = "month"
    popup.installments_interval_count = 1
    product = _make_product(db, popup, price="300.00")
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_oneshot_1",
            status="pending",
            checkout_url="https://simplefi.test/checkout/sf_oneshot_1",
            is_installment_plan=False,
        )

        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 1}],
                "buyer": {
                    "email": "oneshot-buyer@test.com",
                    "first_name": "One",
                    "last_name": "Shot",
                    "form_data": {},
                },
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )

    assert response.status_code == 200, response.text

    call_kwargs = mock_get_client.return_value.create_payment.call_args.kwargs
    assert call_kwargs["max_installments"] is None

    payment = db.exec(select(Payments).where(Payments.popup_id == popup.id)).first()
    assert payment is not None
    assert payment.is_installment_plan is False
    assert payment.installments_paid is None
