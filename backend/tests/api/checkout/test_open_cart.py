"""Tests for the anonymous open-checkout cart endpoints.

- PUT /checkout/{slug}/cart  — upsert an email-keyed cart, return a signed token
- GET /checkout/{slug}/cart  — restore a cart from a signed (cid, sig) link
"""

import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.cart.models import Carts
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.utils.checkout_signing import build_cart_restore_token


@pytest.fixture(autouse=True)
def disable_cart_rate_limit() -> None:
    """Isolate cart tests from shared rate-limit state."""
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    slug_prefix: str = "cart",
    signing_secret: str | None = None,
) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Cart Popup {slug_prefix}",
        slug=f"{slug_prefix}-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.direct.value,
        status="active",
        simplefi_api_key="simplefi_test_key",
        currency="USD",
        open_checkout_signing_secret=signing_secret,
    )
    db.add(popup)
    db.flush()
    return popup


def _make_product(db: Session, popup: Popups, *, price: str = "100.00") -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name="GA",
        slug=f"prod-{uuid.uuid4().hex[:6]}",
        price=price,
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.flush()
    return product


def _items(product: Products, *, promo_code: str | None = None) -> dict:
    return {
        "passes": [
            {
                "attendee_id": "att-1",
                "product_id": str(product.id),
                "quantity": 2,
            }
        ],
        "promo_code": promo_code,
        "current_step": "tickets",
    }


def test_upsert_open_cart_creates_cart_and_returns_restore_token(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="create", signing_secret="s3cr3t")
    product = _make_product(db, popup)
    db.commit()

    response = client.put(
        f"/api/v1/checkout/{popup.slug}/cart",
        json={"email": "buyer@test.com", "items": _items(product, promo_code="X10")},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["email"] == "buyer@test.com"
    assert body["items"]["promo_code"] == "X10"
    assert body["restore_token"] == build_cart_restore_token(body["id"], "s3cr3t")

    cart = db.exec(
        select(Carts).where(Carts.popup_id == popup.id, Carts.human_id.is_(None))
    ).first()
    assert cart is not None
    assert cart.email == "buyer@test.com"


def test_upsert_open_cart_without_secret_has_null_restore_token(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="nosecret", signing_secret=None)
    product = _make_product(db, popup)
    db.commit()

    response = client.put(
        f"/api/v1/checkout/{popup.slug}/cart",
        json={"email": "buyer@test.com", "items": _items(product)},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    assert response.json()["restore_token"] is None


def test_upsert_open_cart_is_idempotent_per_email(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="idem", signing_secret="s3cr3t")
    product = _make_product(db, popup)
    db.commit()

    first = client.put(
        f"/api/v1/checkout/{popup.slug}/cart",
        json={"email": "buyer@test.com", "items": _items(product, promo_code="A")},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )
    second = client.put(
        f"/api/v1/checkout/{popup.slug}/cart",
        json={"email": "buyer@test.com", "items": _items(product, promo_code="B")},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert second.json()["items"]["promo_code"] == "B"

    carts = list(
        db.exec(
            select(Carts).where(Carts.popup_id == popup.id, Carts.human_id.is_(None))
        ).all()
    )
    assert len(carts) == 1


def test_restore_open_cart_with_valid_signature_returns_items(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="restore", signing_secret="s3cr3t")
    product = _make_product(db, popup)
    db.commit()

    created = client.put(
        f"/api/v1/checkout/{popup.slug}/cart",
        json={"email": "buyer@test.com", "items": _items(product, promo_code="X10")},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    ).json()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/cart",
        params={"cid": created["id"], "sig": created["restore_token"]},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == created["id"]
    assert body["email"] == "buyer@test.com"
    assert body["items"]["promo_code"] == "X10"
    assert body["items"]["passes"][0]["quantity"] == 2


def test_restore_open_cart_invalid_signature_returns_403(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="badsig", signing_secret="s3cr3t")
    product = _make_product(db, popup)
    db.commit()

    created = client.put(
        f"/api/v1/checkout/{popup.slug}/cart",
        json={"email": "buyer@test.com", "items": _items(product)},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    ).json()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/cart",
        params={"cid": created["id"], "sig": "tampered"},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 403, response.text


def test_restore_open_cart_without_secret_returns_404(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(
        db, tenant_a, slug_prefix="restore-nosecret", signing_secret=None
    )
    product = _make_product(db, popup)
    db.commit()

    created = client.put(
        f"/api/v1/checkout/{popup.slug}/cart",
        json={"email": "buyer@test.com", "items": _items(product)},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    ).json()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/cart",
        params={"cid": created["id"], "sig": "anything"},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 404, response.text


def test_restore_open_cart_unknown_cid_returns_404(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="unknown", signing_secret="s3cr3t")
    db.commit()

    missing_cid = str(uuid.uuid4())
    valid_sig = build_cart_restore_token(missing_cid, "s3cr3t")

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/cart",
        params={"cid": missing_cid, "sig": valid_sig},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 404, response.text
