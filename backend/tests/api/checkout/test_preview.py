"""Tests for POST /checkout/{slug}/preview."""

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.tenant.models import Tenants
from tests.api.checkout.test_purchase import (
    _default_flow,
    _make_field,
    _make_popup,
    _make_product,
    _make_section,
    _recipient,
)


@pytest.fixture(autouse=True)
def disable_preview_rate_limit() -> None:
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield


def test_preview_request_requires_products() -> None:
    from app.api.checkout.schemas import CheckoutPreviewRequest

    with pytest.raises(ValueError):
        CheckoutPreviewRequest(products=[])


def test_preview_open_ticketing_computes_breakdown(
    db: Session,
    tenant_a: Tenants,
) -> None:
    from app.api.checkout.schemas import CheckoutPreviewRequest
    from app.api.payment.crud import payments_crud

    popup = _make_popup(db, tenant_a, slug_prefix="prev")
    product = _make_product(db, popup, price="120.00")
    db.commit()

    obj = CheckoutPreviewRequest(
        products=[{"product_id": str(product.id), "quantity": 2}]
    )
    result = payments_crud.preview_open_ticketing(
        db, obj, popup, _default_flow(db, popup)
    )

    assert result.total == Decimal("240.00")
    assert result.post_discount_amount == Decimal("240.00")
    assert result.currency == "USD"
    assert len(result.lines) == 1
    assert result.lines[0].discountable is True


def test_preview_route_happy_path(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="prevroute")
    product = _make_product(db, popup, price="50.00")
    db.commit()

    response = client.post(
        f"/api/v1/checkout/{popup.slug}/checkout/preview",
        json={"products": [{"product_id": str(product.id), "quantity": 3}]},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == "150.00"
    assert body["currency"] == "USD"
    assert len(body["lines"]) == 1


def test_preview_total_matches_purchase_amount(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="parity")
    product = _make_product(db, popup, price="120.00")
    section = _make_section(db, popup)
    field = _make_field(db, popup, section)
    db.commit()

    preview = client.post(
        f"/api/v1/checkout/{popup.slug}/checkout/preview",
        json={"products": [{"product_id": str(product.id), "quantity": 2}]},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )
    assert preview.status_code == 200, preview.text

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_parity_1",
            status="pending",
            checkout_url="https://simplefi.test/checkout/parity",
            is_installment_plan=False,
        )
        purchase = client.post(
            f"/api/v1/checkout/{popup.slug}/checkout/purchase",
            json={
                "products": [
                    {
                        "product_id": str(product.id),
                        "quantity": 2,
                        "recipient_key": "buyer",
                    }
                ],
                "recipients": [_recipient(product)],
                "buyer": {
                    "email": "parity@test.com",
                    "first_name": "P",
                    "last_name": "Q",
                    "form_data": {field.name: "P"},
                },
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
    assert purchase.status_code == 200, purchase.text
    assert preview.json()["total"] == purchase.json()["amount"]
