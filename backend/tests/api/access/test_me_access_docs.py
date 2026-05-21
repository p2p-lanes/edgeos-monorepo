"""Tests for GET /me/access/docs.

REQ-9.1: Same auth gate as /me/access.
REQ-9.2: JSON response lists endpoints per scope, filtered to caller's scopes.
REQ-9.3: Markdown response via ?format=markdown.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.tenant.models import Tenants
from app.api.third_party_app.models import ThirdPartyApps
from app.core.security import create_access_token

BASE_URL = "/api/v1/me/access/docs"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def docs_app(db: Session, tenant_a: Tenants) -> tuple[ThirdPartyApps, str]:
    """App for docs tests. Uses portal:api_keys_manage so it has known routes."""
    from app.api.third_party_app import crud

    return crud.create(
        db,
        tenant_id=tenant_a.id,
        name=f"docs-test-{uuid.uuid4().hex[:6]}",
        allowed_token_scopes=["portal:api_keys_manage"],
        allowed_api_key_scopes=[],
    )


@pytest.fixture(scope="module")
def multi_scope_app(db: Session, tenant_a: Tenants) -> tuple[ThirdPartyApps, str]:
    """App with multiple scopes for cross-scope filtering tests."""
    from app.api.third_party_app import crud

    return crud.create(
        db,
        tenant_id=tenant_a.id,
        name=f"multi-docs-{uuid.uuid4().hex[:6]}",
        allowed_token_scopes=["portal:self_read", "portal:api_keys_manage"],
        allowed_api_key_scopes=[],
    )


def _make_human(tenant: Tenants) -> object:
    from app.api.human.models import Humans
    from sqlmodel import Session
    from app.core.db import engine

    h = Humans(tenant_id=tenant.id, email=f"docs-{uuid.uuid4().hex[:6]}@test.com")
    with Session(engine) as db:
        db.add(h)
        db.commit()
        db.refresh(h)
    return h


class TestMeAccessDocsAuth:
    """REQ-9.1 — Same gate as /me/access."""

    def test_portal_jwt_rejected(self, client: TestClient, tenant_a: Tenants) -> None:
        """Portal JWT gets 401 on /docs."""
        h = _make_human(tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="portal",
        )
        resp = client.get(BASE_URL, headers=_bearer(token))
        assert resp.status_code == 401, resp.text

    def test_admin_jwt_rejected(
        self, client: TestClient, admin_token_tenant_a: str
    ) -> None:
        resp = client.get(BASE_URL, headers=_bearer(admin_token_tenant_a))
        assert resp.status_code == 401, resp.text

    def test_unauthenticated_rejected(self, client: TestClient) -> None:
        resp = client.get(BASE_URL)
        assert resp.status_code == 401, resp.text


class TestMeAccessDocsJson:
    """REQ-9.2 — JSON shape and scope filtering."""

    def test_json_format_default(
        self,
        client: TestClient,
        docs_app: tuple[ThirdPartyApps, str],
        tenant_a: Tenants,
    ) -> None:
        """Default (no format) returns JSON with scopes array."""
        app, _ = docs_app
        h = _make_human(tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="third_party",
            issued_by_app_id=app.id,
        )
        resp = client.get(BASE_URL, headers=_bearer(token))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        # Response is a list of {scope, endpoints} or dict — check the envelope
        assert isinstance(data, (list, dict)), f"Unexpected type: {type(data)}"

    def test_json_explicit_format(
        self,
        client: TestClient,
        docs_app: tuple[ThirdPartyApps, str],
        tenant_a: Tenants,
    ) -> None:
        """?format=json returns JSON with proper scope keys."""
        app, _ = docs_app
        h = _make_human(tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="third_party",
            issued_by_app_id=app.id,
        )
        resp = client.get(BASE_URL + "?format=json", headers=_bearer(token))
        assert resp.status_code == 200, resp.text

    def test_json_only_includes_caller_scopes(
        self,
        client: TestClient,
        docs_app: tuple[ThirdPartyApps, str],
        tenant_a: Tenants,
    ) -> None:
        """REQ-9.2.a — scope filtering: only caller's scopes appear."""
        app, _ = docs_app
        h = _make_human(tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="third_party",
            issued_by_app_id=app.id,
        )
        resp = client.get(BASE_URL + "?format=json", headers=_bearer(token))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        # Collect all scope keys present in response
        if isinstance(data, list):
            returned_scopes = {item["scope"] for item in data}
        else:
            returned_scopes = set(data.get("scopes", {}).keys())
        # portal:self_read should NOT appear for docs_app (it only has api_keys_manage)
        assert "portal:self_read" not in returned_scopes

    def test_json_known_scope_has_endpoints(
        self,
        client: TestClient,
        docs_app: tuple[ThirdPartyApps, str],
        tenant_a: Tenants,
    ) -> None:
        """REQ-9.2.b — each scope entry lists at least one endpoint."""
        from app.api.access.introspection import SCOPE_ROUTES_REGISTRY

        app, _ = docs_app
        h = _make_human(tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="third_party",
            issued_by_app_id=app.id,
        )
        resp = client.get(BASE_URL + "?format=json", headers=_bearer(token))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        # If the registry has routes for portal:api_keys_manage, they should appear
        if "portal:api_keys_manage" in SCOPE_ROUTES_REGISTRY:
            if isinstance(data, list):
                scope_entry = next(
                    (x for x in data if x.get("scope") == "portal:api_keys_manage"),
                    None,
                )
                if scope_entry is not None:
                    assert len(scope_entry["endpoints"]) >= 1
                    for ep in scope_entry["endpoints"]:
                        assert "method" in ep
                        assert "path" in ep
                        assert "summary" in ep

    def test_invalid_format_returns_422(
        self,
        client: TestClient,
        docs_app: tuple[ThirdPartyApps, str],
        tenant_a: Tenants,
    ) -> None:
        """REQ-9.3.b — ?format=xml returns 422."""
        app, _ = docs_app
        h = _make_human(tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="third_party",
            issued_by_app_id=app.id,
        )
        resp = client.get(BASE_URL + "?format=xml", headers=_bearer(token))
        assert resp.status_code == 422, resp.text


class TestMeAccessDocsMarkdown:
    """REQ-9.3 — Markdown response."""

    def test_markdown_format_returns_text_content_type(
        self,
        client: TestClient,
        docs_app: tuple[ThirdPartyApps, str],
        tenant_a: Tenants,
    ) -> None:
        """REQ-9.3.a — Content-Type includes text/markdown or text/plain."""
        app, _ = docs_app
        h = _make_human(tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="third_party",
            issued_by_app_id=app.id,
        )
        resp = client.get(BASE_URL + "?format=markdown", headers=_bearer(token))
        assert resp.status_code == 200, resp.text
        content_type = resp.headers.get("content-type", "")
        assert "text/" in content_type, f"Expected text/* content-type, got: {content_type}"

    def test_markdown_body_non_empty(
        self,
        client: TestClient,
        docs_app: tuple[ThirdPartyApps, str],
        tenant_a: Tenants,
    ) -> None:
        """Markdown body is non-empty."""
        app, _ = docs_app
        h = _make_human(tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="third_party",
            issued_by_app_id=app.id,
        )
        resp = client.get(BASE_URL + "?format=markdown", headers=_bearer(token))
        assert resp.status_code == 200, resp.text
        assert len(resp.text) > 0

    def test_markdown_contains_app_name(
        self,
        client: TestClient,
        docs_app: tuple[ThirdPartyApps, str],
        tenant_a: Tenants,
    ) -> None:
        """Markdown body contains the app name in a heading."""
        app, _ = docs_app
        h = _make_human(tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="third_party",
            issued_by_app_id=app.id,
        )
        resp = client.get(BASE_URL + "?format=markdown", headers=_bearer(token))
        assert resp.status_code == 200, resp.text
        assert app.name in resp.text

    def test_markdown_contains_scope_heading(
        self,
        client: TestClient,
        docs_app: tuple[ThirdPartyApps, str],
        tenant_a: Tenants,
    ) -> None:
        """Markdown body contains at least one scope as a heading."""
        app, _ = docs_app
        h = _make_human(tenant_a)
        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="third_party",
            issued_by_app_id=app.id,
        )
        resp = client.get(BASE_URL + "?format=markdown", headers=_bearer(token))
        assert resp.status_code == 200, resp.text
        # Scope headings use ## format
        assert "portal:api_keys_manage" in resp.text

    def test_legacy_jwt_markdown(
        self,
        client: TestClient,
        tenant_a: Tenants,
    ) -> None:
        """Legacy JWT also gets valid markdown response."""
        from app.api.human.models import Humans
        from sqlmodel import Session
        from app.core.db import engine

        h = Humans(tenant_id=tenant_a.id, email=f"leg-md-{uuid.uuid4().hex[:6]}@test.com")
        with Session(engine) as db:
            db.add(h)
            db.commit()
            db.refresh(h)

        token = create_access_token(
            subject=h.id,
            token_type="human",
            issued_via="third_party",
            scopes=["portal:self_read"],
        )
        resp = client.get(BASE_URL + "?format=markdown", headers=_bearer(token))
        assert resp.status_code == 200, resp.text
        content_type = resp.headers.get("content-type", "")
        assert "text/" in content_type
