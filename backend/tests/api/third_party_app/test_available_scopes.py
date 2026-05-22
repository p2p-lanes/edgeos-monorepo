"""Tests for GET /third-party-apps/available-scopes.

REQ-7.1: Returns the platform MAX constants.
         Requires admin auth.
         Route declared BEFORE /{id} so it doesn't get swallowed.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.security import (
    THIRD_PARTY_API_KEY_SCOPES_MAX,
    THIRD_PARTY_TOKEN_SCOPES_MAX,
)

BASE_URL = "/api/v1/third-party-apps"
SCOPES_URL = f"{BASE_URL}/available-scopes"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _auth(token: str) -> dict[str, str]:
    return _bearer(token)


class TestAvailableScopes:
    """REQ-7.1 — available-scopes endpoint."""

    def test_returns_200_for_admin(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Admin can call available-scopes."""
        resp = client.get(SCOPES_URL, headers=_auth(admin_token_tenant_a))
        assert resp.status_code == 200, resp.text

    def test_returns_platform_max_constants(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """REQ-7.1.a — response equals THIRD_PARTY_TOKEN/API_KEY_SCOPES_MAX."""
        resp = client.get(SCOPES_URL, headers=_auth(admin_token_tenant_a))
        assert resp.status_code == 200
        data = resp.json()
        assert "token_scopes" in data
        assert "api_key_scopes" in data
        assert set(data["token_scopes"]) == set(THIRD_PARTY_TOKEN_SCOPES_MAX)
        assert set(data["api_key_scopes"]) == set(THIRD_PARTY_API_KEY_SCOPES_MAX)

    def test_unauthenticated_returns_401(self, client: TestClient) -> None:
        """REQ-7.1.b — no auth → 401."""
        resp = client.get(SCOPES_URL)
        assert resp.status_code == 401, resp.text

    def test_viewer_returns_403(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER → 403."""
        resp = client.get(SCOPES_URL, headers=_auth(viewer_token_tenant_a))
        assert resp.status_code == 403, resp.text

    def test_superadmin_can_access(
        self,
        client: TestClient,
        superadmin_token: str,
    ) -> None:
        """SUPERADMIN can also call available-scopes."""

        resp = client.get(SCOPES_URL, headers=_auth(superadmin_token))
        # SUPERADMIN may need X-Tenant-Id for tenant session but available-scopes
        # is stateless — should return 200 regardless.
        assert resp.status_code == 200, resp.text


class TestRouteOrdering:
    """The /available-scopes route must be matched before /{id}."""

    def test_available_scopes_not_caught_by_id_route(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """GET /available-scopes returns 200, not 404 or 422 (not caught as invalid UUID)."""
        resp = client.get(SCOPES_URL, headers=_auth(admin_token_tenant_a))
        # If routing is wrong, FastAPI tries to parse "available-scopes" as UUID → 422
        assert resp.status_code == 200, (
            f"Route ordering bug: got {resp.status_code} instead of 200. "
            f"Response: {resp.text}"
        )
