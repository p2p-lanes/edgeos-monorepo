"""Tests for the per-tenant portal help button config (help_enabled / help_email).

Covers the three validation layers:
- TenantBase / TenantCreate: complete state, definitive schema check
- TenantUpdate: payload-level check (enable + explicit clear in one request)
- PATCH router: merged-state check against the DB row
"""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlmodel import Session

from app.api.tenant.models import Tenants
from app.api.tenant.schemas import TenantBase, TenantCreate, TenantUpdate

# --- Defaults: opt-in, off for everyone until configured ---


def test_tenant_base_help_defaults_off() -> None:
    tenant = TenantBase(name="Test", slug="test")
    assert tenant.help_enabled is False
    assert tenant.help_email is None


def test_tenant_create_help_defaults_off() -> None:
    tenant = TenantCreate(name="Test")
    assert tenant.help_enabled is False
    assert tenant.help_email is None


def test_tenant_base_accepts_enabled_with_email() -> None:
    tenant = TenantBase(
        name="Test", slug="test", help_enabled=True, help_email="help@example.com"
    )
    assert tenant.help_enabled is True
    assert tenant.help_email == "help@example.com"


# --- TenantCreate: complete state, so the schema check is definitive ---


def test_tenant_create_rejects_enabled_without_email() -> None:
    with pytest.raises(ValidationError, match="help_enabled requires a help_email"):
        TenantCreate(name="Test", help_enabled=True)


def test_tenant_create_rejects_enabled_with_blank_email() -> None:
    """A whitespace-only address is not a destination."""
    with pytest.raises(ValidationError):
        TenantCreate(name="Test", help_enabled=True, help_email="   ")


def test_tenant_create_accepts_enabled_with_email() -> None:
    tenant = TenantCreate(name="Test", help_enabled=True, help_email="help@example.com")
    assert tenant.help_enabled is True


def test_tenant_create_accepts_email_without_enabling() -> None:
    """Configuring the address while leaving the button off is a valid state."""
    tenant = TenantCreate(name="Test", help_email="help@example.com")
    assert tenant.help_enabled is False


# --- TenantUpdate: payload-level only (None means "unchanged") ---


def test_tenant_update_help_defaults_none() -> None:
    update = TenantUpdate()
    assert update.help_enabled is None
    assert update.help_email is None


def test_tenant_update_rejects_enable_while_clearing_email() -> None:
    """Enabling and explicitly nulling the address in one payload is incoherent."""
    with pytest.raises(ValidationError, match="help_enabled requires a help_email"):
        TenantUpdate(help_enabled=True, help_email=None)


def test_tenant_update_allows_enable_without_mentioning_email() -> None:
    """Omitted help_email means "unchanged" — the router decides against the DB row."""
    update = TenantUpdate(help_enabled=True)
    assert update.help_enabled is True
    assert "help_email" not in update.model_fields_set


def test_tenant_update_allows_disable_and_clear_together() -> None:
    update = TenantUpdate(help_enabled=False, help_email=None)
    assert update.help_enabled is False


def test_tenant_update_rejects_invalid_email() -> None:
    with pytest.raises(ValidationError):
        TenantUpdate(help_enabled=True, help_email="not-an-email")


# --- PATCH router: merged-state check ---


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_patch_rejects_enable_when_row_has_no_email(
    client: TestClient, tenant_a: Tenants, admin_token_tenant_a: str, db: Session
) -> None:
    """PATCH {help_enabled: true} alone cannot be judged by the schema — the row has no email."""
    tenant_a.help_enabled = False
    tenant_a.help_email = None
    db.add(tenant_a)
    db.commit()

    resp = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json={"help_enabled": True},
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 422, resp.text
    assert "help_enabled requires a help_email" in resp.text

    db.refresh(tenant_a)
    assert tenant_a.help_enabled is False


def test_patch_rejects_clearing_email_while_enabled(
    client: TestClient, tenant_a: Tenants, admin_token_tenant_a: str, db: Session
) -> None:
    """The inverse gap: nulling the address on a row that already has help enabled."""
    tenant_a.help_enabled = True
    tenant_a.help_email = "help@example.com"
    db.add(tenant_a)
    db.commit()

    resp = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json={"help_email": None},
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 422, resp.text

    db.refresh(tenant_a)
    assert tenant_a.help_email == "help@example.com"


def test_patch_accepts_enable_with_email_in_same_payload(
    client: TestClient, tenant_a: Tenants, admin_token_tenant_a: str, db: Session
) -> None:
    tenant_a.help_enabled = False
    tenant_a.help_email = None
    db.add(tenant_a)
    db.commit()

    resp = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json={"help_enabled": True, "help_email": "support@example.com"},
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["help_enabled"] is True
    assert data["help_email"] == "support@example.com"


def test_patch_accepts_enable_when_row_already_has_email(
    client: TestClient, tenant_a: Tenants, admin_token_tenant_a: str, db: Session
) -> None:
    """Address configured earlier, button flipped on later — merged state is valid."""
    tenant_a.help_enabled = False
    tenant_a.help_email = "support@example.com"
    db.add(tenant_a)
    db.commit()

    resp = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json={"help_enabled": True},
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["help_enabled"] is True


def test_patch_allows_disabling_and_clearing(
    client: TestClient, tenant_a: Tenants, admin_token_tenant_a: str, db: Session
) -> None:
    tenant_a.help_enabled = True
    tenant_a.help_email = "support@example.com"
    db.add(tenant_a)
    db.commit()

    resp = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json={"help_enabled": False, "help_email": None},
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["help_enabled"] is False
    assert data["help_email"] is None


# --- Portal exposure: the anonymous payload must carry both fields ---


def test_public_slug_endpoint_exposes_help_config(
    client: TestClient, tenant_a: Tenants, db: Session
) -> None:
    """The portal reads these from the unauthenticated endpoint."""
    tenant_a.help_enabled = True
    tenant_a.help_email = "support@example.com"
    db.add(tenant_a)
    db.commit()

    resp = client.get(f"/api/v1/tenants/public/{tenant_a.slug}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["help_enabled"] is True
    assert data["help_email"] == "support@example.com"
