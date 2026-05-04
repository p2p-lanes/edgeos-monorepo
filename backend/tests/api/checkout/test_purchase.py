"""Tests for POST /checkout/{slug}/purchase — CAP-C."""

import uuid
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.attendee.models import Attendees
from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.payment.models import Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants


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
    db: Session, popup: Popups, *, name: str = "GA", price: str = "100.00"
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
    )
    db.add(product)
    db.flush()
    return product


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
    assert len(attendees) == 2


def test_purchase_unknown_slug_returns_404(client: TestClient) -> None:
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
        )

    assert response.status_code == 502, response.text


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
            headers={"X-Forwarded-For": "7.7.7.7"},
        )

    assert response.status_code == 429, response.text
    assert "Retry-After" in response.headers
