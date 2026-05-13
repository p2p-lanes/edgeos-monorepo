"""Integration tests for Product sale-window CRUD (spec: product-sale-window).

Scenarios:
1. PATCH sets sale window → ProductPublic returns verbatim (T1.7a / Scenario 1)
2. PATCH clears both to null → ProductPublic returns null on both (T1.7a / Scenario 2)
3. POST with inverted window → 422 validation error (validator round-trip)
"""

import uuid

from fastapi.testclient import TestClient

from app.api.popup.models import Popups


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_product_payload(popup_id: uuid.UUID, *, suffix: str) -> dict:
    return {
        "popup_id": str(popup_id),
        "name": f"Sale Window Test Product {suffix}",
        "price": "50.00",
        "category": "ticket",
    }


# ---------------------------------------------------------------------------
# T1.7a — Scenario 1: PATCH sets sale window, response returns verbatim
# ---------------------------------------------------------------------------


def test_patch_product_sets_sale_window(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """Admin PATCHes sale_starts_at and sale_ends_at → both returned verbatim."""
    suffix = uuid.uuid4().hex[:8]

    # 1. Create product
    create_resp = client.post(
        "/api/v1/products",
        headers=_admin_headers(admin_token_tenant_a),
        json=_create_product_payload(popup_tenant_a.id, suffix=suffix),
    )
    assert create_resp.status_code == 201, create_resp.text
    product_id = create_resp.json()["id"]

    # 2. PATCH with sale window (date-only; backend stores datetime internally)
    patch_resp = client.patch(
        f"/api/v1/products/{product_id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "sale_starts_at": "2026-06-01",
            "sale_ends_at": "2026-07-01",
        },
    )
    assert patch_resp.status_code == 200, patch_resp.text
    data = patch_resp.json()

    # Response exposes the inclusive day the operator picked, verbatim.
    assert data["sale_starts_at"] == "2026-06-01"
    assert data["sale_ends_at"] == "2026-07-01"


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
