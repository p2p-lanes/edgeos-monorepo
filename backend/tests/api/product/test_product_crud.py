"""Integration tests for Product sale-window CRUD (spec: product-sale-window).

Scenarios:
1. PATCH sets sale window → ProductPublic returns verbatim (T1.7a / Scenario 1)
2. PATCH clears both to null → ProductPublic returns null on both (T1.7a / Scenario 2)
3. POST with inverted window → 422 validation error (validator round-trip)
"""

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants

TYPE_INPUTS = ("access", "participant", "order", "missing", None, "unsupported")


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_product_payload(popup_id: uuid.UUID, *, suffix: str) -> dict:
    return {
        "popup_id": str(popup_id),
        "name": f"Sale Window Test Product {suffix}",
        "price": "50.00",
        "category": "ticket",
        "fulfillment_type": "access",
    }


@pytest.mark.parametrize("endpoint", ["create", "batch"])
@pytest.mark.parametrize("fulfillment_type", TYPE_INPUTS)
def test_product_create_and_batch_enforce_fulfillment_type(
    endpoint: str,
    fulfillment_type: str | None,
    client: TestClient,
    admin_token_tenant_a: str,
    superadmin_token: str,
    popup_tenant_a: Popups,
    tenant_a: Tenants,
) -> None:
    item = _create_product_payload(popup_tenant_a.id, suffix=str(fulfillment_type))
    if fulfillment_type == "missing":
        item.pop("fulfillment_type")
    else:
        item["fulfillment_type"] = fulfillment_type
    batch = endpoint == "batch"
    response = client.post(
        "/api/v1/products/batch" if batch else "/api/v1/products",
        headers=(
            {**_admin_headers(superadmin_token), "X-Tenant-Id": str(tenant_a.id)}
            if batch
            else _admin_headers(admin_token_tenant_a)
        ),
        json={"popup_id": str(popup_tenant_a.id), "products": [item]}
        if batch
        else item,
    )
    valid = fulfillment_type in {"access", "participant", "order"}
    assert response.status_code == ((207 if batch else 201) if valid else 422), (
        response.text
    )
    if valid:
        body = response.json()[0] if batch else response.json()
        assert body["fulfillment_type"] == fulfillment_type


def test_product_public_reads_legacy_null_fulfillment_type(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
    tenant_a: Tenants,
) -> None:
    product = Products(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        name="Legacy unclassified product",
        slug=f"legacy-unclassified-{uuid.uuid4().hex[:8]}",
        price=10,
        fulfillment_type=None,
    )
    db.add(product)
    db.commit()
    response = client.get(
        f"/api/v1/products/{product.id}",
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert response.status_code == 200, response.text
    assert response.json()["fulfillment_type"] is None


def test_product_patch_distinguishes_omitted_from_explicit_null_type(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    created = client.post(
        "/api/v1/products",
        headers=_admin_headers(admin_token_tenant_a),
        json=_create_product_payload(popup_tenant_a.id, suffix="patch-type"),
    )
    assert created.status_code == 201, created.text
    product_id = created.json()["id"]
    omitted = client.patch(
        f"/api/v1/products/{product_id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={"name": "Renamed without classification"},
    )
    assert omitted.status_code == 200, omitted.text
    assert omitted.json()["fulfillment_type"] == "access"
    for invalid in (None, "unsupported"):
        rejected = client.patch(
            f"/api/v1/products/{product_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"fulfillment_type": invalid},
        )
        assert rejected.status_code == 422, rejected.text
    changed = client.patch(
        f"/api/v1/products/{product_id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={"fulfillment_type": "order"},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["fulfillment_type"] == "order"


# ---------------------------------------------------------------------------
# T1.7a — Scenario 1: PATCH sets sale window, response returns verbatim
# ---------------------------------------------------------------------------


def test_patch_product_sets_sale_window(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """Admin PATCHes sale_starts_at and sale_ends_at → both returned as the
    exact datetime instants (the window now carries a precise time-of-day)."""
    suffix = uuid.uuid4().hex[:8]

    # 1. Create product
    create_resp = client.post(
        "/api/v1/products",
        headers=_admin_headers(admin_token_tenant_a),
        json=_create_product_payload(popup_tenant_a.id, suffix=suffix),
    )
    assert create_resp.status_code == 201, create_resp.text
    product_id = create_resp.json()["id"]

    # 2. PATCH with a precise sale window (e.g. a Friday 11:59 PM cutoff).
    patch_resp = client.patch(
        f"/api/v1/products/{product_id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "sale_starts_at": "2026-06-01T00:00:00Z",
            "sale_ends_at": "2026-07-01T23:59:59Z",
        },
    )
    assert patch_resp.status_code == 200, patch_resp.text
    data = patch_resp.json()

    # Response exposes the exact instants the operator set.
    assert datetime.fromisoformat(data["sale_starts_at"]) == datetime(
        2026, 6, 1, 0, 0, 0, tzinfo=UTC
    )
    assert datetime.fromisoformat(data["sale_ends_at"]) == datetime(
        2026, 7, 1, 23, 59, 59, tzinfo=UTC
    )


# ---------------------------------------------------------------------------
# T1.7a — Scenario 2: PATCH clears both to null → both fields return null
# ---------------------------------------------------------------------------


def test_patch_product_clears_sale_window(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """Admin PATCHes null/null → both sale window fields return null."""
    suffix = uuid.uuid4().hex[:8]

    # 1. Create product
    create_resp = client.post(
        "/api/v1/products",
        headers=_admin_headers(admin_token_tenant_a),
        json=_create_product_payload(popup_tenant_a.id, suffix=suffix),
    )
    assert create_resp.status_code == 201, create_resp.text
    product_id = create_resp.json()["id"]

    # 2. Set sale window first
    set_resp = client.patch(
        f"/api/v1/products/{product_id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "sale_starts_at": "2026-06-01",
            "sale_ends_at": "2026-07-01",
        },
    )
    assert set_resp.status_code == 200, set_resp.text

    # 3. Clear both
    clear_resp = client.patch(
        f"/api/v1/products/{product_id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "sale_starts_at": None,
            "sale_ends_at": None,
        },
    )
    assert clear_resp.status_code == 200, clear_resp.text
    data = clear_resp.json()
    assert data["sale_starts_at"] is None
    assert data["sale_ends_at"] is None


# ---------------------------------------------------------------------------
# Validator: inverted window → 422
# ---------------------------------------------------------------------------


def test_create_product_with_inverted_sale_window_returns_422(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """sale_starts_at > sale_ends_at must return 422."""
    suffix = uuid.uuid4().hex[:8]
    payload = {
        **_create_product_payload(popup_tenant_a.id, suffix=suffix),
        "sale_starts_at": "2026-07-01",  # starts after ends
        "sale_ends_at": "2026-06-01",
    }

    resp = client.post(
        "/api/v1/products",
        headers=_admin_headers(admin_token_tenant_a),
        json=payload,
    )
    assert resp.status_code == 422, resp.text


# ---------------------------------------------------------------------------
# CREATE seeds total_stock_remaining when only total_stock_cap is provided
# Regression: backoffice form sends only cap, leaving remaining=NULL silently
# treated as unlimited despite the admin setting a ceiling.
# ---------------------------------------------------------------------------


def test_create_product_with_cap_seeds_remaining(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """POST cap=50 with no remaining → product has cap=50, remaining=50."""
    suffix = uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/products",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            **_create_product_payload(popup_tenant_a.id, suffix=suffix),
            "total_stock_cap": 50,
        },
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["total_stock_cap"] == 50
    assert data["total_stock_remaining"] == 50


def test_create_product_without_cap_stays_unlimited(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """POST without cap → both fields null (unlimited tracking preserved)."""
    suffix = uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/products",
        headers=_admin_headers(admin_token_tenant_a),
        json=_create_product_payload(popup_tenant_a.id, suffix=suffix),
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["total_stock_cap"] is None
    assert data["total_stock_remaining"] is None


def test_create_product_with_explicit_remaining_respected(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """POST cap=50 remaining=10 → explicit remaining preserved (not overwritten)."""
    suffix = uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/products",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            **_create_product_payload(popup_tenant_a.id, suffix=suffix),
            "total_stock_cap": 50,
            "total_stock_remaining": 10,
        },
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["total_stock_cap"] == 50
    assert data["total_stock_remaining"] == 10


# ---------------------------------------------------------------------------
# total_stock_cap update preserves `sold = old_cap - old_remaining`
# Regression: bare cap change used to fail the CHECK constraint
# (total_stock_remaining <= total_stock_cap) when remaining > new_cap.
# ---------------------------------------------------------------------------


def test_patch_lowers_total_stock_cap_with_no_sales(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """cap=100 remaining=100 → PATCH cap=50 → remaining auto-clamped to 50."""
    suffix = uuid.uuid4().hex[:8]
    create_resp = client.post(
        "/api/v1/products",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            **_create_product_payload(popup_tenant_a.id, suffix=suffix),
            "total_stock_cap": 100,
            "total_stock_remaining": 100,
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    product_id = create_resp.json()["id"]

    patch_resp = client.patch(
        f"/api/v1/products/{product_id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={"total_stock_cap": 50},
    )
    assert patch_resp.status_code == 200, patch_resp.text
    data = patch_resp.json()
    assert data["total_stock_cap"] == 50
    assert data["total_stock_remaining"] == 50


def test_patch_lowers_total_stock_cap_preserves_sold_count(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """cap=100 remaining=80 (20 sold) → PATCH cap=50 → remaining=30 (preserves sold=20)."""
    suffix = uuid.uuid4().hex[:8]
    create_resp = client.post(
        "/api/v1/products",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            **_create_product_payload(popup_tenant_a.id, suffix=suffix),
            "total_stock_cap": 100,
            "total_stock_remaining": 80,
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    product_id = create_resp.json()["id"]

    patch_resp = client.patch(
        f"/api/v1/products/{product_id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={"total_stock_cap": 50},
    )
    assert patch_resp.status_code == 200, patch_resp.text
    data = patch_resp.json()
    assert data["total_stock_cap"] == 50
    assert data["total_stock_remaining"] == 30


def test_patch_clears_total_stock_cap_to_unlimited(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """cap=100 remaining=80 → PATCH cap=null → remaining=null (unlimited)."""
    suffix = uuid.uuid4().hex[:8]
    create_resp = client.post(
        "/api/v1/products",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            **_create_product_payload(popup_tenant_a.id, suffix=suffix),
            "total_stock_cap": 100,
            "total_stock_remaining": 80,
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    product_id = create_resp.json()["id"]

    patch_resp = client.patch(
        f"/api/v1/products/{product_id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={"total_stock_cap": None},
    )
    assert patch_resp.status_code == 200, patch_resp.text
    data = patch_resp.json()
    assert data["total_stock_cap"] is None
    assert data["total_stock_remaining"] is None


def test_patch_sets_total_stock_cap_from_unlimited(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """cap=null remaining=null → PATCH cap=50 → remaining=50 (starts tracking)."""
    suffix = uuid.uuid4().hex[:8]
    create_resp = client.post(
        "/api/v1/products",
        headers=_admin_headers(admin_token_tenant_a),
        json=_create_product_payload(popup_tenant_a.id, suffix=suffix),
    )
    assert create_resp.status_code == 201, create_resp.text
    product_id = create_resp.json()["id"]

    patch_resp = client.patch(
        f"/api/v1/products/{product_id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={"total_stock_cap": 50},
    )
    assert patch_resp.status_code == 200, patch_resp.text
    data = patch_resp.json()
    assert data["total_stock_cap"] == 50
    assert data["total_stock_remaining"] == 50
