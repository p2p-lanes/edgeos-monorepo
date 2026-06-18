"""Integration tests for tenant router — landing_mode feature (Tasks 5.2, 5.3, 5.6).

Covers:
- 5.2: TenantUpdate model_validator (T-2, T-3, T-4, T-5)
- 5.3: GET /api/v1/tenants/public/by-domain/{domain} shape (T-7, T-8, T-9)
- 5.6: Cache invalidation on landing_mode change (T-6)
"""

import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.api.shared.enums import LandingMode, SaleType
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _superadmin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_tenant(
    db: Session,
    *,
    suffix: str,
    custom_domain: str | None = None,
    custom_domain_active: bool = False,
) -> Tenants:
    t = Tenants(
        name=f"LM Tenant {suffix}",
        slug=f"lm-tenant-{suffix}",
        custom_domain=custom_domain,
        custom_domain_active=custom_domain_active,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _make_active_direct_popup(db: Session, tenant: Tenants, *, slug: str) -> Popups:
    p = Popups(
        name=f"Popup {slug}",
        slug=slug,
        tenant_id=tenant.id,
        status=PopupStatus.active,
        sale_type=SaleType.direct,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


# ---------------------------------------------------------------------------
# 5.2 — router PATCH role-gate and merged-state validation
# ---------------------------------------------------------------------------


def test_admin_cannot_set_landing_mode(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    """Scenario T-5: ADMIN PATCH landing_mode → 403.

    The payload must pass schema-level validation (include custom_domain + active=True)
    so the router role gate is the one that rejects it, not the schema validator.
    """
    # First ensure tenant_a has a valid custom_domain so schema accepts the payload
    suffix = uuid.uuid4().hex[:6]
    domain = f"admin-gate-{suffix}.example.com"
    tenant_a.custom_domain = domain
    tenant_a.custom_domain_active = True
    db.add(tenant_a)
    db.commit()
    db.refresh(tenant_a)

    resp = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json={
            "landing_mode": "checkout",
            "custom_domain": domain,
            "custom_domain_active": True,
        },
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 403, resp.text


def test_superadmin_can_set_landing_mode_checkout_when_domain_active(
    client: TestClient,
    db: Session,
    superadmin_token: str,
) -> None:
    """Scenario T-4: SUPERADMIN sets landing_mode=checkout with domain active → 200."""
    suffix = uuid.uuid4().hex[:6]
    t = _make_tenant(
        db,
        suffix=suffix,
        custom_domain=f"tickets-{suffix}.example.com",
        custom_domain_active=True,
    )
    resp = client.patch(
        f"/api/v1/tenants/{t.id}",
        json={"landing_mode": "checkout"},
        headers=_superadmin_headers(superadmin_token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["landing_mode"] == "checkout"


def test_superadmin_rejected_checkout_when_domain_inactive(
    client: TestClient,
    db: Session,
    superadmin_token: str,
) -> None:
    """Scenario T-2: merged-state check rejects checkout when custom_domain_active=False."""
    suffix = uuid.uuid4().hex[:6]
    t = _make_tenant(
        db,
        suffix=suffix,
        custom_domain=f"inactive-{suffix}.example.com",
        custom_domain_active=False,
    )
    resp = client.patch(
        f"/api/v1/tenants/{t.id}",
        json={"landing_mode": "checkout"},
        headers=_superadmin_headers(superadmin_token),
    )
    assert resp.status_code == 422, resp.text


def test_superadmin_rejected_checkout_when_no_custom_domain(
    client: TestClient,
    db: Session,
    superadmin_token: str,
) -> None:
    """Scenario T-3: merged-state check rejects checkout when custom_domain=None."""
    suffix = uuid.uuid4().hex[:6]
    t = _make_tenant(db, suffix=suffix)  # no custom_domain
    resp = client.patch(
        f"/api/v1/tenants/{t.id}",
        json={"landing_mode": "checkout"},
        headers=_superadmin_headers(superadmin_token),
    )
    assert resp.status_code == 422, resp.text


# ---------------------------------------------------------------------------
# 5.3 — GET /by-domain response shape (T-7, T-8, T-9)
# ---------------------------------------------------------------------------


def test_by_domain_checkout_with_active_popup(
    client: TestClient,
    db: Session,
) -> None:
    """Scenario T-7: checkout mode + active popup → active_popup_slug populated."""
    suffix = uuid.uuid4().hex[:6]
    domain = f"t7-{suffix}.example.com"
    t = _make_tenant(db, suffix=suffix, custom_domain=domain, custom_domain_active=True)
    t.landing_mode = LandingMode.checkout
    db.add(t)
    db.commit()
    db.refresh(t)

    popup_slug = f"t7-popup-{suffix}"
    _make_active_direct_popup(db, t, slug=popup_slug)

    resp = client.get(f"/api/v1/tenants/public/by-domain/{domain}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["landing_mode"] == "checkout"
    assert data["active_popup_slug"] == popup_slug
    assert "meta_capi_configured" not in data


def test_public_slug_does_not_expose_meta_capi_configured(
    client: TestClient,
    db: Session,
) -> None:
    suffix = uuid.uuid4().hex[:6]
    t = _make_tenant(db, suffix=suffix)
    t.meta_tracking_enabled = True
    t.meta_pixel_id = "1234567890"
    t.meta_capi_access_token_encrypted = "encrypted-token"
    db.add(t)
    db.commit()
    db.refresh(t)

    resp = client.get(f"/api/v1/tenants/public/{t.slug}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["meta_tracking_enabled"] is True
    assert data["meta_pixel_id"] == "1234567890"
    assert "meta_capi_configured" not in data


def test_by_domain_checkout_no_active_popup(
    client: TestClient,
    db: Session,
) -> None:
    """Scenario T-8: checkout mode + no popup → active_popup_slug=null."""
    suffix = uuid.uuid4().hex[:6]
    domain = f"t8-{suffix}.example.com"
    t = _make_tenant(db, suffix=suffix, custom_domain=domain, custom_domain_active=True)
    t.landing_mode = LandingMode.checkout
    db.add(t)
    db.commit()
    db.refresh(t)

    resp = client.get(f"/api/v1/tenants/public/by-domain/{domain}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["landing_mode"] == "checkout"
    assert data["active_popup_slug"] is None


def test_by_domain_portal_mode_no_popup_slug(
    client: TestClient,
    db: Session,
) -> None:
    """Scenario T-9: portal mode → active_popup_slug=null regardless of popups."""
    suffix = uuid.uuid4().hex[:6]
    domain = f"t9-{suffix}.example.com"
    t = _make_tenant(db, suffix=suffix, custom_domain=domain, custom_domain_active=True)
    # landing_mode defaults to portal

    # Add an active direct popup — should NOT be included in slug because mode is portal
    _make_active_direct_popup(db, t, slug=f"t9-popup-{suffix}")

    resp = client.get(f"/api/v1/tenants/public/by-domain/{domain}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["landing_mode"] == "portal"
    assert data["active_popup_slug"] is None


# ---------------------------------------------------------------------------
# 5.6 — Cache invalidation on landing_mode change (T-6)
# ---------------------------------------------------------------------------


def test_cache_invalidated_on_landing_mode_change(
    client: TestClient,
    db: Session,
    superadmin_token: str,
) -> None:
    """Scenario T-6: Redis entry evicted when landing_mode changes."""
    suffix = uuid.uuid4().hex[:6]
    domain = f"t6-{suffix}.example.com"
    # Start in checkout mode so we can flip it to portal (an actual change)
    t = _make_tenant(db, suffix=suffix, custom_domain=domain, custom_domain_active=True)
    t.landing_mode = LandingMode.checkout
    db.add(t)
    db.commit()
    db.refresh(t)

    invalidate_calls: list[str] = []

    original_invalidate = __import__(
        "app.core.redis", fromlist=["domain_cache"]
    ).domain_cache.invalidate

    def capture_invalidate(d: str) -> None:
        invalidate_calls.append(d)
        original_invalidate(d)

    with patch(
        "app.core.redis.domain_cache.invalidate", side_effect=capture_invalidate
    ):
        resp = client.patch(
            f"/api/v1/tenants/{t.id}",
            # Flip from checkout → portal (an actual landing_mode change)
            json={"landing_mode": "portal"},
            headers=_superadmin_headers(superadmin_token),
        )
    assert resp.status_code == 200, resp.text
    # domain_cache.invalidate should have been called for the tenant's custom_domain
    assert domain in invalidate_calls


def test_cache_also_invalidated_on_custom_domain_active_flip(
    client: TestClient,
    db: Session,
    superadmin_token: str,
) -> None:
    """ADR-2 latent gap fix: cache invalidated when custom_domain_active flips."""
    suffix = uuid.uuid4().hex[:6]
    domain = f"t6b-{suffix}.example.com"
    t = _make_tenant(
        db, suffix=suffix, custom_domain=domain, custom_domain_active=False
    )

    invalidate_calls: list[str] = []
    original_invalidate = __import__(
        "app.core.redis", fromlist=["domain_cache"]
    ).domain_cache.invalidate

    def capture_invalidate(d: str) -> None:
        invalidate_calls.append(d)
        original_invalidate(d)

    with patch(
        "app.core.redis.domain_cache.invalidate", side_effect=capture_invalidate
    ):
        resp = client.patch(
            f"/api/v1/tenants/{t.id}",
            json={"custom_domain_active": True},
            headers=_superadmin_headers(superadmin_token),
        )
    assert resp.status_code == 200, resp.text
    assert domain in invalidate_calls
