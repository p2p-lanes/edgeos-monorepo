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

    # 2. PATCH with sale window
    patch_resp = client.patch(
        f"/api/v1/products/{product_id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "sale_starts_at": "2026-06-01T00:00:00Z",
            "sale_ends_at": "2026-07-01T00:00:00Z",
        },
    )
    assert patch_resp.status_code == 200, patch_resp.text
    data = patch_resp.json()

    assert data["sale_starts_at"] is not None
    assert data["sale_ends_at"] is not None
    # ISO strings must round-trip; compare by date portion only (tz formatting may vary)
    assert data["sale_starts_at"].startswith("2026-06-01")
    assert data["sale_ends_at"].startswith("2026-07-01")


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
            "sale_starts_at": "2026-06-01T00:00:00Z",
            "sale_ends_at": "2026-07-01T00:00:00Z",
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
        "sale_starts_at": "2026-07-01T00:00:00Z",  # starts after ends
        "sale_ends_at": "2026-06-01T00:00:00Z",
    }

    resp = client.post(
        "/api/v1/products",
        headers=_admin_headers(admin_token_tenant_a),
        json=payload,
    )
    assert resp.status_code == 422, resp.text
