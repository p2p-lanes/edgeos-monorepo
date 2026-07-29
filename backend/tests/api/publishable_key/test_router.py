"""Tests for popup publishable-key admin endpoints."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.tenant.models import Tenants
from tests.api.checkout.test_purchase import _make_popup


@pytest.fixture(autouse=True)
def disable_rl() -> None:
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_admin_can_create_publishable_key(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_token_tenant_a: str,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="pkapi")
    db.commit()

    resp = client.post(
        f"/api/v1/popups/{popup.id}/publishable-keys",
        json={"name": "External", "allowed_origins": ["https://checkout.example.com"]},
        headers=_bearer(admin_token_tenant_a),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["key"].startswith("pk_live_")
    assert body["allowed_origins"] == ["https://checkout.example.com"]


def test_admin_can_list_and_revoke_publishable_key(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_token_tenant_a: str,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="pkapi2")
    db.commit()

    created = client.post(
        f"/api/v1/popups/{popup.id}/publishable-keys",
        json={"name": "K", "allowed_origins": []},
        headers=_bearer(admin_token_tenant_a),
    )
    assert created.status_code == 201, created.text
    key_id = created.json()["id"]

    listed = client.get(
        f"/api/v1/popups/{popup.id}/publishable-keys",
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
        f"/api/v1/popups/{popup.id}/publishable-keys",
        headers=_bearer(admin_token_tenant_a),
    )
    assert all(k["id"] != key_id for k in listed2.json())


def test_viewer_cannot_create_publishable_key(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    viewer_token_tenant_a: str,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="pkapi3")
    db.commit()

    resp = client.post(
        f"/api/v1/popups/{popup.id}/publishable-keys",
        json={"name": "X", "allowed_origins": []},
        headers=_bearer(viewer_token_tenant_a),
    )
    assert resp.status_code == 403, resp.text
