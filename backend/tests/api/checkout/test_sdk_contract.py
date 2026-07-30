"""End-to-end contract test for the headless checkout SDK (@edgeos/checkout-core).

An external client consumes the anonymous checkout API exclusively through a
per-popup **publishable key** (no JWT, no X-Tenant-Id), walking:

    GET  /checkout/{slug}/runtime        → products + steps + form schema
    POST /coupons/validate-public        → coupon check
    POST /checkout/{slug}/preview        → authoritative price breakdown
    POST /checkout/{slug}/purchase       → payment + SimpleFi checkout url

The SDK re-declares the response shapes by hand in
``packages/checkout-core/src/types/api.ts`` (money fields as decimal strings).
This test pins those shapes against the REAL FastAPI responses so any backend
schema drift that would break the SDK fails here — and asserts the money
authority contract the SDK relies on: preview.total == purchase.amount.

If a key set below changes, update the SDK's api.ts to match (or vice versa).
"""

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.publishable_key import crud as pk_crud
from app.api.tenant.models import Tenants
from tests.api.checkout.test_purchase import (
    _make_coupon,
    _make_field,
    _make_popup,
    _make_product,
    _make_section,
)

ORIGIN = "https://checkout.acme.example"

# --- Field sets the SDK's TS types depend on (packages/checkout-core/src/types/api.ts).
RUNTIME_KEYS = {
    "popup",
    "products",
    "buyer_form",
    "ticketing_steps",
    "attendee_categories",
    "form_schema",
}
RUNTIME_PRODUCT_KEYS = {
    "tenant_id",
    "popup_id",
    "id",
    "name",
    "slug",
    "price",
    "category",
    "currency",
    "is_active",
    "insurance_eligible",
}
PREVIEW_KEYS = {
    "lines",
    "discountable_amount",
    "non_discountable_amount",
    "coupon_code",
    "discount_value",
    "discount_amount",
    "post_discount_amount",
    "insurance_amount",
    "contribution_amount",
    "total",
    "currency",
}
PREVIEW_LINE_KEYS = {
    "product_id",
    "quantity",
    "unit_price",
    "line_total",
    "discountable",
}
PURCHASE_KEYS = {
    "payment_id",
    "status",
    "checkout_url",
    "redirect_url",
    "amount",
    "currency",
}
COUPON_KEYS = {"code", "discount_type", "discount_value", "valid"}


@pytest.fixture(autouse=True)
def _disable_rate_limit():
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield


def _pk_headers(raw_key: str) -> dict:
    """Exactly what the SDK's fetch transport sends for an external origin."""
    return {"X-EdgeOS-Publishable-Key": raw_key, "Origin": ORIGIN}


def _seed(db: Session, tenant: Tenants):
    popup = _make_popup(db, tenant, slug_prefix="sdk")
    product = _make_product(db, popup, price="120.00")
    section = _make_section(db, popup)
    field = _make_field(db, popup, section)
    _make_coupon(db, popup, code="HALF", discount_value=50)
    _, raw = pk_crud.create_publishable_key(
        db,
        tenant_id=tenant.id,
        popup_id=popup.id,
        name="external-checkout",
        allowed_origins=[ORIGIN],
    )
    db.commit()
    return popup, product, field, raw


def test_sdk_journey_via_publishable_key_matches_core_types(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup, product, field, raw = _seed(db, tenant_a)
    headers = _pk_headers(raw)

    # 1) GET /runtime — resolves tenant via the publishable key alone.
    runtime = client.get(f"/api/v1/checkout/{popup.slug}/runtime", headers=headers)
    assert runtime.status_code == 200, runtime.text
    rt = runtime.json()
    assert RUNTIME_KEYS <= rt.keys(), rt.keys()
    assert isinstance(rt["products"], list) and rt["products"], "expected the product"
    prod = next(p for p in rt["products"] if p["id"] == str(product.id))
    assert RUNTIME_PRODUCT_KEYS <= prod.keys(), prod.keys()
    # Money is serialized as a decimal STRING (the SDK's Money type), not a number.
    assert prod["price"] == "120.00"
    assert isinstance(prod["price"], str)

    # 2) POST /coupons/validate-public — coupon check via the same key.
    coupon = client.post(
        "/api/v1/coupons/validate-public",
        json={"popup_slug": popup.slug, "code": "HALF"},
        headers=headers,
    )
    assert coupon.status_code == 200, coupon.text
    cp = coupon.json()
    assert COUPON_KEYS <= cp.keys(), cp.keys()
    assert cp["valid"] is True
    assert cp["code"] == "HALF"

    # 3) POST /preview — authoritative price breakdown for 2 units, coupon applied.
    preview = client.post(
        f"/api/v1/checkout/{popup.slug}/preview",
        json={
            "products": [{"product_id": str(product.id), "quantity": 2}],
            "coupon_code": "HALF",
        },
        headers=headers,
    )
    assert preview.status_code == 200, preview.text
    pv = preview.json()
    assert PREVIEW_KEYS <= pv.keys(), pv.keys()
    assert pv["lines"] and PREVIEW_LINE_KEYS <= pv["lines"][0].keys()
    # 2 * 120 = 240 gross discountable; 50% coupon → 120 discount, 120 net.
    # NOTE: `discountable_amount` is the POST-discount discountable portion
    # (crud.py mutates it in place), NOT the pre-discount subtotal. A consumer
    # showing "you saved X" must read `discount_amount`. The per-line
    # `line_total` values still hold the gross per-line amounts.
    assert pv["discount_amount"] == "120.00"
    assert pv["discountable_amount"] == "120.00"
    assert pv["post_discount_amount"] == "120.00"
    assert pv["total"] == "120.00"
    assert pv["lines"][0]["line_total"] == "240.00"  # gross, pre-discount
    assert isinstance(pv["total"], str)

    # 4) POST /purchase — same inputs; SimpleFi mocked. The money authority
    #    contract: purchase.amount MUST equal preview.total for identical inputs.
    with patch("app.services.simplefi.get_simplefi_client") as mock_client:
        mock_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_sdk_contract",
            status="pending",
            checkout_url="https://simplefi.test/checkout/sdk",
            is_installment_plan=False,
        )
        purchase = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 2}],
                "coupon_code": "HALF",
                "buyer": {
                    "email": "buyer@acme.example",
                    "first_name": "Ada",
                    "last_name": "Lovelace",
                    "form_data": {field.name: "Ada"},
                },
            },
            headers=headers,
        )
    assert purchase.status_code == 200, purchase.text
    pu = purchase.json()
    assert PURCHASE_KEYS <= pu.keys(), pu.keys()
    assert pu["status"] == "pending"
    assert pu["checkout_url"] == "https://simplefi.test/checkout/sdk"
    # The core shows preview.total; the server charges purchase.amount. They must match.
    assert pu["amount"] == pv["total"] == "120.00"
    assert pu["currency"] == "USD"


def test_sdk_purchase_rejected_when_origin_not_allowed(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """A key scoped to one origin cannot drive purchase from another origin."""
    popup, product, field, raw = _seed(db, tenant_a)

    resp = client.post(
        f"/api/v1/checkout/{popup.slug}/purchase",
        json={
            "products": [{"product_id": str(product.id), "quantity": 1}],
            "buyer": {
                "email": "buyer@acme.example",
                "first_name": "Ada",
                "last_name": "Lovelace",
                "form_data": {field.name: "Ada"},
            },
        },
        headers={
            "X-EdgeOS-Publishable-Key": raw,
            "Origin": "https://evil.example",
        },
    )
    assert resp.status_code == 403, resp.text


def test_cors_preflight_allows_publishable_key_header(client: TestClient) -> None:
    """The browser sends a CORS preflight for the custom publishable-key header.

    It must be in the CORS allow_headers list or every cross-origin request from
    an external checkout is blocked before it reaches the API. Regression guard
    for the header being added to the auth path but not to CORS.
    """
    resp = client.options(
        "/api/v1/checkout/any/preview",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-edgeos-publishable-key",
        },
    )
    assert resp.status_code == 200, resp.text
    allowed = resp.headers.get("access-control-allow-headers", "").lower()
    assert "x-edgeos-publishable-key" in allowed
