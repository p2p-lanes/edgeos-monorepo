"""Third-party key rotation and revocation endpoint tests.

RED-phase for Block 7. All tests should FAIL until:
  - POST /tenants/{tenant_id}/third-party-key/rotate is wired up.
  - DELETE /tenants/{tenant_id}/third-party-key is wired up.
  - ThirdPartyKeyRotated schema is added to tenant/schemas.py.

REQ-TR-01 ... REQ-TR-04
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.tenant.models import Tenants

ROTATE_URL = "/api/v1/tenants/{tenant_id}/third-party-key/rotate"
REVOKE_URL = "/api/v1/tenants/{tenant_id}/third-party-key"
LOGIN_URL = "/api/v1/auth/human/third-party/login"


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _superadmin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class TestThirdPartyKeyRotate:
    """REQ-TR-02, REQ-TR-04."""

    def test_admin_rotate_returns_raw_key_once(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN can rotate. Response includes raw api_key and prefix."""
        url = ROTATE_URL.format(tenant_id=tenant_a.id)
        resp = client.post(url, headers=_admin_headers(admin_token_tenant_a))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "api_key" in data
        assert "prefix" in data
        assert len(data["api_key"]) >= 10

        # Hash must be stored on tenant row
        db.refresh(tenant_a)
        assert tenant_a.third_party_api_key_hash is not None
        assert tenant_a.third_party_key_prefix == data["prefix"]

    def test_rotate_invalidates_old_key_on_next_login(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """After rotation, the old raw key is rejected at login."""
        # First rotate to get a known key
        url = ROTATE_URL.format(tenant_id=tenant_a.id)
        resp1 = client.post(url, headers=_admin_headers(admin_token_tenant_a))
        assert resp1.status_code == 200, resp1.text
        old_key = resp1.json()["api_key"]

        # Rotate again — old_key should now be invalid
        resp2 = client.post(url, headers=_admin_headers(admin_token_tenant_a))
        assert resp2.status_code == 200, resp2.text

        # Try to login with old key
        login_resp = client.post(
            LOGIN_URL,
            headers={
                "X-Tenant-Id": str(tenant_a.id),
                "X-Third-Party-Api-Key": old_key,
            },
            json={"email": "anyone@example.com"},
        )
        assert login_resp.status_code == 401

    def test_viewer_cannot_rotate(
        self,
        client: TestClient,
        tenant_a: Tenants,
        viewer_token_tenant_a: str,
    ) -> None:
        """REQ-TR-04: VIEWER must receive 403."""
        url = ROTATE_URL.format(tenant_id=tenant_a.id)
        resp = client.post(url, headers=_admin_headers(viewer_token_tenant_a))
        assert resp.status_code == 403

    def test_superadmin_can_rotate_any_tenant(
        self,
        client: TestClient,
        db: Session,
        tenant_b: Tenants,
        superadmin_token: str,
    ) -> None:
        """SUPERADMIN can rotate keys for any tenant."""
        url = ROTATE_URL.format(tenant_id=tenant_b.id)
        resp = client.post(url, headers=_superadmin_headers(superadmin_token))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "api_key" in data

        db.refresh(tenant_b)
        assert tenant_b.third_party_api_key_hash is not None

    def test_admin_cannot_rotate_other_tenant(
        self,
        client: TestClient,
        tenant_b: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN of tenant A must not rotate tenant B key → 403."""
        url = ROTATE_URL.format(tenant_id=tenant_b.id)
        resp = client.post(url, headers=_admin_headers(admin_token_tenant_a))
        assert resp.status_code == 403


class TestThirdPartyKeyRevoke:
    """DELETE endpoint disables third-party login for the tenant."""

    def test_delete_clears_hash_and_prefix(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """After DELETE the tenant's hash and prefix columns are NULL → 204."""
        # Ensure key is set first
        rotate_url = ROTATE_URL.format(tenant_id=tenant_a.id)
        r = client.post(rotate_url, headers=_admin_headers(admin_token_tenant_a))
        assert r.status_code == 200

        delete_url = REVOKE_URL.format(tenant_id=tenant_a.id)
        resp = client.delete(delete_url, headers=_admin_headers(admin_token_tenant_a))
        assert resp.status_code == 204

        db.refresh(tenant_a)
        assert tenant_a.third_party_api_key_hash is None
        assert tenant_a.third_party_key_prefix is None

    def test_viewer_cannot_delete_key(
        self,
        client: TestClient,
        tenant_a: Tenants,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER must receive 403 on DELETE."""
        url = REVOKE_URL.format(tenant_id=tenant_a.id)
        resp = client.delete(url, headers=_admin_headers(viewer_token_tenant_a))
        assert resp.status_code == 403
