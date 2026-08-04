"""Tests for tenant-level publishable-key admin endpoints."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def disable_rl() -> None:
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_admin_can_create_tenant_publishable_key(
    client: TestClient,
    admin_token_tenant_a: str,
) -> None:
    resp = client.post(
        "/api/v1/publishable-keys",
        json={"name": "External", "allowed_origins": ["https://checkout.example.com"]},
        headers=_bearer(admin_token_tenant_a),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["key"].startswith("pk_live_")
    assert body["allowed_origins"] == ["https://checkout.example.com"]
    # Tenant-level key: not bound to any popup.
    assert body["popup_id"] is None


def test_admin_can_list_and_revoke_publishable_key(
    client: TestClient,
    admin_token_tenant_a: str,
) -> None:
    created = client.post(
        "/api/v1/publishable-keys",
        json={"name": "K", "allowed_origins": []},
        headers=_bearer(admin_token_tenant_a),
    )
    assert created.status_code == 201, created.text
    key_id = created.json()["id"]

    listed = client.get(
        "/api/v1/publishable-keys",
        headers=_bearer(admin_token_tenant_a),
    )
    assert listed.status_code == 200, listed.text
    assert any(k["id"] == key_id for k in listed.json())

    revoked = client.delete(
        f"/api/v1/publishable-keys/{key_id}",
        headers=_bearer(admin_token_tenant_a),
    )
    assert revoked.status_code == 204, revoked.text

    listed2 = client.get(
        "/api/v1/publishable-keys",
        headers=_bearer(admin_token_tenant_a),
    )
    assert all(k["id"] != key_id for k in listed2.json())


def test_viewer_cannot_create_publishable_key(
    client: TestClient,
    viewer_token_tenant_a: str,
) -> None:
    resp = client.post(
        "/api/v1/publishable-keys",
        json={"name": "X", "allowed_origins": []},
        headers=_bearer(viewer_token_tenant_a),
    )
    assert resp.status_code == 403, resp.text


def test_keys_are_scoped_per_tenant(
    client: TestClient,
    admin_token_tenant_a: str,
    admin_token_tenant_b: str,
) -> None:
    """A key minted under tenant A must not appear in tenant B's list."""
    created = client.post(
        "/api/v1/publishable-keys",
        json={"name": "A-only", "allowed_origins": []},
        headers=_bearer(admin_token_tenant_a),
    )
    assert created.status_code == 201, created.text
    key_id = created.json()["id"]

    listed_b = client.get(
        "/api/v1/publishable-keys",
        headers=_bearer(admin_token_tenant_b),
    )
    assert listed_b.status_code == 200, listed_b.text
    assert all(k["id"] != key_id for k in listed_b.json())
