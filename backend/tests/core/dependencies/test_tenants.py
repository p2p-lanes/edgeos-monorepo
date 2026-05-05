"""Unit tests for resolve_public_tenant dependency — Phase 2 (T-2.1).

All 11 test scenarios from the spec (REQ-A.1 to REQ-A.4, ADR-1, ADR-5).
Tests use a minimal FastAPI TestClient + monkeypatch to keep them isolated
from the real DB and Redis — matching the pattern in test_rate_limit.py.

Scenarios:
 1. test_origin_resolves_known_tenant
 2. test_origin_unrecognized_raises_404
 3. test_referer_fallback_when_origin_absent
 4. test_x_tenant_id_fallback_when_origin_absent
 5. test_x_tenant_id_unknown_uuid_raises_404
 6. test_both_headers_absent_raises_404
 7. test_both_headers_absent_emits_debug_log
 8. test_null_origin_skipped
 9. test_origin_with_port_normalized
10. test_cache_hit_returns_tenant
11. test_cache_null_sentinel_skips_to_next_signal
"""

import uuid
from typing import Any
from unittest.mock import ANY, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TENANT_A_ID = uuid.uuid4()


def _make_tenant(tenant_id: uuid.UUID = _TENANT_A_ID) -> MagicMock:
    """Return a mock Tenants ORM instance with enough fields for TenantPublic.model_validate."""
    t = MagicMock()
    t.id = tenant_id
    t.deleted = False
    t.name = "Test Tenant"
    t.slug = "test-tenant"
    t.sender_email = None
    t.sender_name = None
    t.image_url = None
    t.icon_url = None
    t.logo_url = None
    t.custom_domain = None
    t.custom_domain_active = False
    return t


def _make_tenant_public_json(tenant_id: uuid.UUID = _TENANT_A_ID) -> str:
    """Return a minimal TenantPublic JSON string as stored in domain_cache."""
    return (
        f'{{"id":"{tenant_id}","name":"Test","slug":"test",'
        f'"deleted":false,"sender_email":null,"sender_name":null,'
        f'"image_url":null,"icon_url":null,"logo_url":null,'
        f'"custom_domain":null,"custom_domain_active":false}}'
    )


def _make_app() -> FastAPI:
    """Build a minimal FastAPI app that exposes the resolve_public_tenant dependency."""
    from fastapi import Depends

    from app.core.dependencies.tenants import resolve_public_tenant

    app = FastAPI()

    @app.get("/probe")
    async def probe(tenant: Any = Depends(resolve_public_tenant)) -> dict:  # type: ignore[assignment]
        return {"tenant_id": str(tenant.id)}

    return app


# ---------------------------------------------------------------------------
# Shared patches helper
# ---------------------------------------------------------------------------

def _make_client(
    *,
    cache_return: str | None = None,
    resolve_return: Any = None,
    tenants_get_return: Any = None,
    portal_domain: str = "dev.edgeos.world",
) -> TestClient:
    """Create a TestClient with domain_cache and tenants_crud patched."""
    app = _make_app()
    client = TestClient(app, raise_server_exceptions=False)

    mock_cache = MagicMock()
    mock_cache.get.return_value = cache_return
    mock_cache.set.return_value = None

    mock_crud = MagicMock()
    mock_crud.resolve_by_host.return_value = resolve_return
    mock_crud.get.return_value = tenants_get_return

    with (
        patch("app.core.dependencies.tenants.domain_cache", mock_cache),
        patch("app.core.dependencies.tenants.tenants_crud", mock_crud),
        patch("app.core.dependencies.tenants.settings") as mock_settings,
    ):
        mock_settings.PORTAL_DOMAIN = portal_domain
        yield client, mock_cache, mock_crud


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_origin_resolves_known_tenant() -> None:
    """Origin header resolves to a known tenant → dependency returns that tenant."""
    tenant = _make_tenant()

    app = _make_app()

    mock_cache = MagicMock()
    mock_cache.get.return_value = None  # cache miss

    mock_crud = MagicMock()
    mock_crud.resolve_by_host.return_value = tenant

    with (
        patch("app.core.dependencies.tenants.domain_cache", mock_cache),
        patch("app.core.dependencies.tenants.tenants_crud", mock_crud),
        patch("app.core.dependencies.tenants.settings") as mock_settings,
    ):
        mock_settings.PORTAL_DOMAIN = "dev.edgeos.world"
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get(
            "/probe", headers={"Origin": "https://tenant-a.dev.edgeos.world"}
        )

    assert response.status_code == 200
    assert response.json()["tenant_id"] == str(_TENANT_A_ID)
    mock_crud.resolve_by_host.assert_called_once()


def test_origin_unrecognized_raises_404() -> None:
    """Origin present but host resolves to no tenant AND no X-Tenant-Id → 404."""
    app = _make_app()

    mock_cache = MagicMock()
    mock_cache.get.return_value = None

    mock_crud = MagicMock()
    mock_crud.resolve_by_host.return_value = None  # unknown host

    with (
        patch("app.core.dependencies.tenants.domain_cache", mock_cache),
        patch("app.core.dependencies.tenants.tenants_crud", mock_crud),
        patch("app.core.dependencies.tenants.settings") as mock_settings,
    ):
        mock_settings.PORTAL_DOMAIN = "dev.edgeos.world"
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get(
            "/probe", headers={"Origin": "https://unknown.example.com"}
        )

    assert response.status_code == 404


def test_referer_fallback_when_origin_absent() -> None:
    """No Origin → Referer header used as fallback; resolves to known tenant."""
    tenant = _make_tenant()
    app = _make_app()

    mock_cache = MagicMock()
    mock_cache.get.return_value = None

    mock_crud = MagicMock()
    mock_crud.resolve_by_host.return_value = tenant

    with (
        patch("app.core.dependencies.tenants.domain_cache", mock_cache),
        patch("app.core.dependencies.tenants.tenants_crud", mock_crud),
        patch("app.core.dependencies.tenants.settings") as mock_settings,
    ):
        mock_settings.PORTAL_DOMAIN = "dev.edgeos.world"
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get(
            "/probe",
            headers={"Referer": "https://tenant-a.dev.edgeos.world/some/path"},
        )

    assert response.status_code == 200
    assert response.json()["tenant_id"] == str(_TENANT_A_ID)
    # resolve_by_host was called with the host extracted from Referer
    call_args = mock_crud.resolve_by_host.call_args
    assert call_args[0][1] == "tenant-a.dev.edgeos.world"


def test_x_tenant_id_fallback_when_origin_absent() -> None:
    """No Origin, no Referer, valid X-Tenant-Id UUID → returns that tenant (REQ-A.2)."""
    tenant = _make_tenant()
    app = _make_app()

    mock_cache = MagicMock()
    mock_cache.get.return_value = None

    mock_crud = MagicMock()
    mock_crud.resolve_by_host.return_value = None
    mock_crud.get.return_value = tenant

    with (
        patch("app.core.dependencies.tenants.domain_cache", mock_cache),
        patch("app.core.dependencies.tenants.tenants_crud", mock_crud),
        patch("app.core.dependencies.tenants.settings") as mock_settings,
    ):
        mock_settings.PORTAL_DOMAIN = "dev.edgeos.world"
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get(
            "/probe", headers={"X-Tenant-Id": str(_TENANT_A_ID)}
        )

    assert response.status_code == 200
    assert response.json()["tenant_id"] == str(_TENANT_A_ID)


def test_x_tenant_id_unknown_uuid_raises_404() -> None:
    """No Origin, X-Tenant-Id present but UUID not in DB → 404 (REQ-A.2 Scenario 4)."""
    app = _make_app()
    unknown_id = uuid.uuid4()

    mock_cache = MagicMock()
    mock_cache.get.return_value = None

    mock_crud = MagicMock()
    mock_crud.resolve_by_host.return_value = None
    mock_crud.get.return_value = None  # not found

    with (
        patch("app.core.dependencies.tenants.domain_cache", mock_cache),
        patch("app.core.dependencies.tenants.tenants_crud", mock_crud),
        patch("app.core.dependencies.tenants.settings") as mock_settings,
    ):
        mock_settings.PORTAL_DOMAIN = "dev.edgeos.world"
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get(
            "/probe", headers={"X-Tenant-Id": str(unknown_id)}
        )

    assert response.status_code == 404


def test_both_headers_absent_raises_404() -> None:
    """No Origin, no Referer, no X-Tenant-Id → HTTP 404 (REQ-A.3)."""
    app = _make_app()

    mock_cache = MagicMock()
    mock_cache.get.return_value = None

    mock_crud = MagicMock()
    mock_crud.resolve_by_host.return_value = None

    with (
        patch("app.core.dependencies.tenants.domain_cache", mock_cache),
        patch("app.core.dependencies.tenants.tenants_crud", mock_crud),
        patch("app.core.dependencies.tenants.settings") as mock_settings,
    ):
        mock_settings.PORTAL_DOMAIN = "dev.edgeos.world"
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/probe")

    assert response.status_code == 404


def test_both_headers_absent_emits_debug_log() -> None:
    """No headers → 404 AND a DEBUG log entry is emitted (REQ-A.3).

    loguru routes to its own sinks, not Python logging. We patch logger.debug
    in the module under test to assert the call was made with the expected
    keyword arguments.
    """
    app = _make_app()

    mock_cache = MagicMock()
    mock_cache.get.return_value = None

    mock_crud = MagicMock()
    mock_crud.resolve_by_host.return_value = None

    mock_logger_debug = MagicMock()

    with (
        patch("app.core.dependencies.tenants.domain_cache", mock_cache),
        patch("app.core.dependencies.tenants.tenants_crud", mock_crud),
        patch("app.core.dependencies.tenants.settings") as mock_settings,
        patch("app.core.dependencies.tenants.logger") as mock_logger,
    ):
        mock_settings.PORTAL_DOMAIN = "dev.edgeos.world"
        mock_logger.debug = mock_logger_debug
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/probe")

    assert response.status_code == 404
    # The debug call must have been made
    assert mock_logger_debug.called
    # Verify the call included origin and x_tenant_id_present keyword args
    call_kwargs = mock_logger_debug.call_args.kwargs
    assert "origin" in call_kwargs
    assert "x_tenant_id_present" in call_kwargs
    assert call_kwargs["x_tenant_id_present"] is False


def test_null_origin_skipped() -> None:
    """Origin: null (sandboxed iframe) is treated as missing → falls through to X-Tenant-Id (ADR-5)."""
    tenant = _make_tenant()
    app = _make_app()

    mock_cache = MagicMock()
    mock_cache.get.return_value = None

    mock_crud = MagicMock()
    mock_crud.resolve_by_host.return_value = None
    mock_crud.get.return_value = tenant

    with (
        patch("app.core.dependencies.tenants.domain_cache", mock_cache),
        patch("app.core.dependencies.tenants.tenants_crud", mock_crud),
        patch("app.core.dependencies.tenants.settings") as mock_settings,
    ):
        mock_settings.PORTAL_DOMAIN = "dev.edgeos.world"
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get(
            "/probe",
            headers={"Origin": "null", "X-Tenant-Id": str(_TENANT_A_ID)},
        )

    assert response.status_code == 200
    assert response.json()["tenant_id"] == str(_TENANT_A_ID)
    # resolve_by_host must NOT have been called (Origin "null" was skipped)
    mock_crud.resolve_by_host.assert_not_called()


def test_origin_with_port_normalized() -> None:
    """Origin with port (https://host:8443) → port stripped → hostname passed to resolver (ADR-5)."""
    tenant = _make_tenant()
    app = _make_app()

    mock_cache = MagicMock()
    mock_cache.get.return_value = None

    mock_crud = MagicMock()
    mock_crud.resolve_by_host.return_value = tenant

    with (
        patch("app.core.dependencies.tenants.domain_cache", mock_cache),
        patch("app.core.dependencies.tenants.tenants_crud", mock_crud),
        patch("app.core.dependencies.tenants.settings") as mock_settings,
    ):
        mock_settings.PORTAL_DOMAIN = "dev.edgeos.world"
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get(
            "/probe",
            headers={"Origin": "https://tenant.dev.edgeos.world:8443"},
        )

    assert response.status_code == 200
    call_args = mock_crud.resolve_by_host.call_args
    # The host passed must NOT contain the port
    resolved_host: str = call_args[0][1]
    assert ":" not in resolved_host
    assert resolved_host == "tenant.dev.edgeos.world"


def test_cache_hit_returns_tenant() -> None:
    """domain_cache returns valid TenantPublic JSON → DB fetched by id (ADR-1 cache strategy)."""
    tenant = _make_tenant()
    app = _make_app()

    cached_json = _make_tenant_public_json(_TENANT_A_ID)

    mock_cache = MagicMock()
    mock_cache.get.return_value = cached_json  # cache hit

    mock_crud = MagicMock()
    mock_crud.get.return_value = tenant  # re-fetch by id from DB

    with (
        patch("app.core.dependencies.tenants.domain_cache", mock_cache),
        patch("app.core.dependencies.tenants.tenants_crud", mock_crud),
        patch("app.core.dependencies.tenants.settings") as mock_settings,
    ):
        mock_settings.PORTAL_DOMAIN = "dev.edgeos.world"
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get(
            "/probe", headers={"Origin": "https://tenant-a.dev.edgeos.world"}
        )

    assert response.status_code == 200
    assert response.json()["tenant_id"] == str(_TENANT_A_ID)
    # resolve_by_host must NOT have been called — we hit the cache
    mock_crud.resolve_by_host.assert_not_called()
    # But crud.get WAS called to get the live ORM instance
    mock_crud.get.assert_called_once_with(ANY, _TENANT_A_ID)


def test_cache_null_sentinel_skips_to_next_signal() -> None:
    """domain_cache returns the sentinel "null" for Origin host → falls through to X-Tenant-Id (ADR-1)."""
    tenant = _make_tenant()
    app = _make_app()

    mock_cache = MagicMock()
    mock_cache.get.return_value = "null"  # sentinel — domain known to be unresolvable

    mock_crud = MagicMock()
    mock_crud.resolve_by_host.return_value = None
    mock_crud.get.return_value = tenant

    with (
        patch("app.core.dependencies.tenants.domain_cache", mock_cache),
        patch("app.core.dependencies.tenants.tenants_crud", mock_crud),
        patch("app.core.dependencies.tenants.settings") as mock_settings,
    ):
        mock_settings.PORTAL_DOMAIN = "dev.edgeos.world"
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get(
            "/probe",
            headers={
                "Origin": "https://unknown.dev.edgeos.world",
                "X-Tenant-Id": str(_TENANT_A_ID),
            },
        )

    assert response.status_code == 200
    assert response.json()["tenant_id"] == str(_TENANT_A_ID)
    # resolve_by_host must NOT have been called — sentinel said "not found"
    mock_crud.resolve_by_host.assert_not_called()
