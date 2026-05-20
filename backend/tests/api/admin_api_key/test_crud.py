"""Admin API keys CRUD contract tests.

RED-phase for Block 6. All tests should FAIL until:
  - POST /backoffice/api-keys is implemented.
  - GET /backoffice/api-keys is implemented.
  - GET /backoffice/api-keys/{key_id} is implemented.
  - DELETE /backoffice/api-keys/{key_id} is implemented.
  - app/api/admin_api_key/ module exists and is wired.

REQ-BA-01 ... REQ-BA-05, REQ-AK-06
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.api_key import crud as api_key_crud
from app.api.api_key.models import ApiKeys
from app.api.tenant.models import Tenants
from app.api.user.models import Users

BASE_URL = "/api/v1/backoffice/api-keys"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _tenant_header(tenant_id: uuid.UUID) -> dict[str, str]:
    return {"X-Tenant-Id": str(tenant_id)}


def _auth_tenant(token: str, tenant_id: uuid.UUID) -> dict[str, str]:
    return {**_bearer(token), **_tenant_header(tenant_id)}


def _future_expiry() -> str:
    return (datetime.now(UTC) + timedelta(days=7)).isoformat()


class TestCreateAdminApiKey:
    """REQ-BA-04, REQ-AK-06."""

    def test_admin_can_create_admin_api_key(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """ADMIN creates a key with an allowed scope. Response contains raw key."""
        resp = client.post(
            BASE_URL,
            headers=_bearer(admin_token_tenant_a),
            json={"name": "my-events-key", "scopes": ["events:read"]},
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert "raw_key" in data
        assert data["raw_key"].startswith("eos_live_")
        assert data["scopes"] == ["events:read"]
        assert "prefix" in data
        assert "id" in data

    def test_admin_can_create_key_with_write_scope_and_expiry(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """Write scope requires expires_at — key is created when expiry is provided."""
        resp = client.post(
            BASE_URL,
            headers=_bearer(admin_token_tenant_a),
            json={
                "name": "write-key",
                "scopes": ["attendees:write"],
                "expires_at": _future_expiry(),
            },
        )
        assert resp.status_code == 201, resp.text

    def test_write_scope_without_expiry_returns_422(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Write scope without expires_at returns 422 (schema validation)."""
        resp = client.post(
            BASE_URL,
            headers=_bearer(admin_token_tenant_a),
            json={"name": "write-no-expiry", "scopes": ["attendees:write"]},
        )
        assert resp.status_code == 422, resp.text

    def test_viewer_cannot_create_admin_api_key(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER is rejected with 403. REQ-BA-02."""
        resp = client.post(
            BASE_URL,
            headers=_bearer(viewer_token_tenant_a),
            json={"name": "viewer-key", "scopes": ["events:read"]},
        )
        assert resp.status_code == 403, resp.text

    def test_excluded_scope_returns_422(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Scope outside ADMIN_API_KEY_SCOPES returns 422. REQ-AK-06."""
        resp = client.post(
            BASE_URL,
            headers=_bearer(admin_token_tenant_a),
            json={
                "name": "excluded-scope",
                "scopes": ["email_templates:write"],
            },
        )
        assert resp.status_code == 422, resp.text

    def test_payments_write_excluded_scope_returns_422(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """payments:write is explicitly excluded from ADMIN_API_KEY_SCOPES → 422."""
        resp = client.post(
            BASE_URL,
            headers=_bearer(admin_token_tenant_a),
            json={
                "name": "payments-write-key",
                "scopes": ["payments:write"],
            },
        )
        assert resp.status_code == 422, resp.text

    def test_created_key_has_user_id_and_null_human_id(
        self,
        client: TestClient,
        db: Session,
        admin_user_tenant_a: Users,
        admin_token_tenant_a: str,
    ) -> None:
        """XOR constraint: created admin key has user_id set and human_id=None."""
        from sqlmodel import select

        resp = client.post(
            BASE_URL,
            headers=_bearer(admin_token_tenant_a),
            json={"name": "ownership-check", "scopes": ["events:read"]},
        )
        assert resp.status_code == 201, resp.text
        key_id = uuid.UUID(resp.json()["id"])

        row = db.exec(select(ApiKeys).where(ApiKeys.id == key_id)).first()
        assert row is not None
        assert row.user_id == admin_user_tenant_a.id
        assert row.human_id is None


class TestListAdminApiKeys:
    """REQ-BA-03: visibility rules."""

    def test_admin_sees_only_own_keys(
        self,
        client: TestClient,
        db: Session,
        admin_user_tenant_a: Users,
        admin_user_tenant_b: Users,
        admin_token_tenant_a: str,
        admin_api_key_factory,
    ) -> None:
        """ADMIN list returns only keys belonging to current user."""
        # Create one key for admin_a, one for admin_b (different user)
        row_a, _ = admin_api_key_factory(scopes=["events:read"])

        resp = client.get(BASE_URL, headers=_bearer(admin_token_tenant_a))
        assert resp.status_code == 200, resp.text
        items = resp.json()
        returned_ids = {item["id"] for item in items}

        assert str(row_a.id) in returned_ids
        # Verify every returned key belongs to admin_a
        from sqlmodel import select

        for item in items:
            row = db.exec(select(ApiKeys).where(ApiKeys.id == uuid.UUID(item["id"]))).first()
            assert row is not None
            assert row.user_id == admin_user_tenant_a.id

    def test_viewer_cannot_list_keys(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER receives 403 on GET /backoffice/api-keys."""
        resp = client.get(BASE_URL, headers=_bearer(viewer_token_tenant_a))
        assert resp.status_code == 403, resp.text

    def test_list_does_not_include_raw_key(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        admin_api_key_factory,
    ) -> None:
        """Listing keys never exposes the raw secret."""
        admin_api_key_factory(scopes=["events:read"])

        resp = client.get(BASE_URL, headers=_bearer(admin_token_tenant_a))
        assert resp.status_code == 200, resp.text
        for item in resp.json():
            assert "raw_key" not in item
            assert "key_hash" not in item

    def test_superadmin_sees_all_keys_in_tenant(
        self,
        client: TestClient,
        db: Session,
        superadmin_token: str,
        admin_user_tenant_a: Users,
        tenant_a: Tenants,
        admin_api_key_factory,
    ) -> None:
        """SUPERADMIN with X-Tenant-Id header sees all keys for that tenant."""
        row, _ = admin_api_key_factory(scopes=["events:read"])

        resp = client.get(
            BASE_URL,
            headers={**_bearer(superadmin_token), **_tenant_header(tenant_a.id)},
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()
        returned_ids = {item["id"] for item in items}
        assert str(row.id) in returned_ids


class TestGetAdminApiKey:
    """GET /backoffice/api-keys/{key_id}."""

    def test_admin_can_get_own_key(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        admin_api_key_factory,
    ) -> None:
        """ADMIN can retrieve a specific key they own."""
        row, _ = admin_api_key_factory(scopes=["events:read"])

        resp = client.get(f"{BASE_URL}/{row.id}", headers=_bearer(admin_token_tenant_a))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["id"] == str(row.id)
        assert "raw_key" not in data

    def test_admin_cannot_get_another_users_key(
        self,
        client: TestClient,
        db: Session,
        admin_user_tenant_b: Users,
        admin_token_tenant_a: str,
        tenant_b: Tenants,
    ) -> None:
        """ADMIN from tenant_a gets 404 for a key owned by admin_b (not 403 — no existence leak)."""
        raw = api_key_crud.generate_raw_key()
        row_b = ApiKeys(
            tenant_id=tenant_b.id,
            human_id=None,
            user_id=admin_user_tenant_b.id,
            name="other-admin-key",
            key_hash=api_key_crud.hash_key(raw),
            prefix=api_key_crud.display_prefix(raw),
            scopes=["events:read"],
        )
        db.add(row_b)
        db.commit()
        db.refresh(row_b)

        resp = client.get(f"{BASE_URL}/{row_b.id}", headers=_bearer(admin_token_tenant_a))
        assert resp.status_code == 404, resp.text

        # Cleanup
        db.delete(row_b)
        db.commit()

    def test_get_nonexistent_key_returns_404(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Non-existent key_id returns 404."""
        resp = client.get(f"{BASE_URL}/{uuid.uuid4()}", headers=_bearer(admin_token_tenant_a))
        assert resp.status_code == 404, resp.text


class TestRevokeAdminApiKey:
    """DELETE /backoffice/api-keys/{key_id} — revocation rules (REQ-BA-05, REQ-OW-05)."""

    def test_admin_can_revoke_own_key(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        admin_api_key_factory,
    ) -> None:
        """ADMIN revokes their own key. revoked_at is set; response is 204."""

        row, _ = admin_api_key_factory(scopes=["events:read"])

        resp = client.delete(f"{BASE_URL}/{row.id}", headers=_bearer(admin_token_tenant_a))
        assert resp.status_code == 204, resp.text

        db.refresh(row)
        assert row.revoked_at is not None

    def test_admin_cannot_revoke_another_users_key(
        self,
        client: TestClient,
        db: Session,
        admin_user_tenant_b: Users,
        admin_token_tenant_a: str,
        tenant_b: Tenants,
    ) -> None:
        """ADMIN can only revoke their own keys. Foreign key → 403."""
        raw = api_key_crud.generate_raw_key()
        row_b = ApiKeys(
            tenant_id=tenant_b.id,
            human_id=None,
            user_id=admin_user_tenant_b.id,
            name="other-admin-revoke",
            key_hash=api_key_crud.hash_key(raw),
            prefix=api_key_crud.display_prefix(raw),
            scopes=["events:read"],
        )
        db.add(row_b)
        db.commit()
        db.refresh(row_b)

        resp = client.delete(f"{BASE_URL}/{row_b.id}", headers=_bearer(admin_token_tenant_a))
        assert resp.status_code in (403, 404), resp.text

        # Cleanup
        db.delete(row_b)
        db.commit()

    def test_revoke_nonexistent_key_returns_404(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Non-existent key_id returns 404."""
        resp = client.delete(f"{BASE_URL}/{uuid.uuid4()}", headers=_bearer(admin_token_tenant_a))
        assert resp.status_code == 404, resp.text

    def test_viewer_cannot_revoke_key(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
        admin_api_key_factory,
    ) -> None:
        """VIEWER cannot revoke keys — 403."""
        row, _ = admin_api_key_factory(scopes=["events:read"])
        resp = client.delete(f"{BASE_URL}/{row.id}", headers=_bearer(viewer_token_tenant_a))
        assert resp.status_code == 403, resp.text

    def test_superadmin_can_revoke_any_key_in_tenant(
        self,
        client: TestClient,
        db: Session,
        superadmin_token: str,
        tenant_a: Tenants,
        admin_api_key_factory,
    ) -> None:
        """SUPERADMIN can revoke any admin key in their tenant scope."""
        row, _ = admin_api_key_factory(scopes=["events:read"])

        resp = client.delete(
            f"{BASE_URL}/{row.id}",
            headers={**_bearer(superadmin_token), **_tenant_header(tenant_a.id)},
        )
        assert resp.status_code == 204, resp.text

        db.refresh(row)
        assert row.revoked_at is not None


class TestAdminApiKeyCannotMintAnotherKey:
    """Admin api keys cannot mint more admin api keys (same security argument as portal)."""

    def test_admin_api_key_token_cannot_call_create_endpoint(
        self,
        client: TestClient,
        db: Session,
        admin_user_tenant_a: Users,
        tenant_a: Tenants,
        admin_api_key_factory,
    ) -> None:
        """A request authenticated via admin api-key cannot mint more admin keys."""
        from unittest.mock import patch

        from app.core.security import _resolve_api_key

        row, raw = admin_api_key_factory(scopes=["events:read"])

        with patch("app.core.security.engine", db.get_bind()):
            _resolve_api_key(raw)

        # Build an api-key style token to send as Bearer
        from app.core.security import create_access_token

        api_key_token = create_access_token(
            subject=admin_user_tenant_a.id,
            token_type="user",
            via_api_key=True,
            api_key_id=str(row.id),
            scopes=row.scopes,
        )

        resp = client.post(
            BASE_URL,
            headers=_bearer(api_key_token),
            json={"name": "recursive-key", "scopes": ["events:read"]},
        )
        assert resp.status_code == 403, resp.text
