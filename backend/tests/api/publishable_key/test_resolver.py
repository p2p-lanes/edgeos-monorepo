"""Tests for the publishable-key branch of resolve_public_tenant."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.publishable_key import crud
from app.api.tenant.models import Tenants
from tests.api.checkout.test_purchase import _make_popup, _make_product


@pytest.fixture(autouse=True)
def disable_rl() -> None:
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield


def _seed(db: Session, tenant: Tenants):
    popup = _make_popup(db, tenant, slug_prefix="pkres")
    product = _make_product(db, popup, price="10.00")
    db.commit()
    return popup, product


def _preview_body(product) -> dict:
    return {"products": [{"product_id": str(product.id), "quantity": 1}]}


def test_publishable_key_resolves_tenant(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup, product = _seed(db, tenant_a)
    _, raw = crud.create_publishable_key(
        db,
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        name="k",
        allowed_origins=["https://checkout.example.com"],
    )

    resp = client.post(
        f"/api/v1/checkout/{popup.slug}/checkout/preview",
        json=_preview_body(product),
        headers={
            "X-EdgeOS-Publishable-Key": raw,
            "Origin": "https://checkout.example.com",
        },
    )
    assert resp.status_code == 200, resp.text


def test_publishable_key_origin_not_allowed_is_403(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup, product = _seed(db, tenant_a)
    _, raw = crud.create_publishable_key(
        db,
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        name="k",
        allowed_origins=["https://checkout.example.com"],
    )

    resp = client.post(
        f"/api/v1/checkout/{popup.slug}/checkout/preview",
        json=_preview_body(product),
        headers={
            "X-EdgeOS-Publishable-Key": raw,
            "Origin": "https://evil.example.com",
        },
    )
    assert resp.status_code == 403, resp.text


def test_invalid_publishable_key_is_401(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup, product = _seed(db, tenant_a)

    resp = client.post(
        f"/api/v1/checkout/{popup.slug}/checkout/preview",
        json=_preview_body(product),
        headers={"X-EdgeOS-Publishable-Key": "pk_live_notarealkey"},
    )
    assert resp.status_code == 401, resp.text
