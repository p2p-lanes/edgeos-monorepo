"""Tests for GET /checkout/{slug}/share.

Unauthenticated OpenGraph share-preview endpoint. Social crawlers send no JWT,
so the route is public — but it must only ever expose active direct-sale popups
that belong to the resolved tenant.

Scenarios:
  - active direct popup     -> 200 with {name, tagline, location, image_url}
  - unknown slug            -> 404 (opaque)
  - application popup       -> 404 (opaque, not 403)
  - inactive direct popup   -> 404 (opaque, not 403)
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    status: str = "active",
    sale_type: SaleType = SaleType.direct,
    slug_prefix: str = "share",
    tagline: str | None = "The edge of the world",
    location: str | None = "Cairo",
    image_url: str | None = "https://cdn.example.com/cover.png",
) -> Popups:
    slug = f"{slug_prefix}-{uuid.uuid4().hex[:8]}"
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Share Popup {slug}",
        slug=slug,
        sale_type=sale_type.value,
        status=status,
        tagline=tagline,
        location=location,
        image_url=image_url,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _share_url(slug: str) -> str:
    return f"/api/v1/checkout/{slug}/share"


def _tenant_headers(tenant: Tenants) -> dict[str, str]:
    return {"X-Tenant-Id": str(tenant.id)}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_active_direct_popup_returns_share_meta(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a)
    res = client.get(_share_url(popup.slug), headers=_tenant_headers(tenant_a))
    assert res.status_code == 200
    body = res.json()
    assert body["id"] == str(popup.id)
    assert body["name"] == popup.name
    assert body["tagline"] == popup.tagline
    assert body["location"] == popup.location
    assert body["image_url"] == popup.image_url


def test_unknown_slug_returns_opaque_404(
    client: TestClient,
    tenant_a: Tenants,
) -> None:
    res = client.get(
        _share_url("does-not-exist"),
        headers=_tenant_headers(tenant_a),
    )
    assert res.status_code == 404
    assert res.json()["detail"] == "Not found"


def test_application_popup_returns_opaque_404(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, sale_type=SaleType.application)
    res = client.get(_share_url(popup.slug), headers=_tenant_headers(tenant_a))
    assert res.status_code == 404
    assert res.json()["detail"] == "Not found"


def test_inactive_direct_popup_returns_opaque_404(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, status="draft")
    res = client.get(_share_url(popup.slug), headers=_tenant_headers(tenant_a))
    assert res.status_code == 404
    assert res.json()["detail"] == "Not found"
