"""Tests for POST /coupons/validate-public — CAP-B.

TDD phase: RED → GREEN.

Scenarios:
1. Valid coupon returns 200 with correct shape
2. Unknown coupon code returns 400 with uniform message
3. Expired coupon returns 400 with identical shape (no differentiation)
4. Application popup returns 403
5. Rate-limit: 31st request returns 429 (mocked)
"""

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.coupon.models import Coupons
from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from tests.conftest import with_origin

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_direct_popup(
    db: Session, tenant: Tenants, *, slug_suffix: str = ""
) -> Popups:
    slug = f"val-pub-direct-{uuid.uuid4().hex[:6]}{slug_suffix}"
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Direct Popup {slug}",
        slug=slug,
        sale_type=SaleType.direct.value,
        status="active",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_app_popup(db: Session, tenant: Tenants) -> Popups:
    slug = f"val-pub-app-{uuid.uuid4().hex[:6]}"
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"App Popup {slug}",
        slug=slug,
        sale_type=SaleType.application.value,
        status="active",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_coupon(
    db: Session,
    popup: Popups,
    *,
    code: str = "TESTCODE",
    is_active: bool = True,
    end_date: datetime | None = None,
    max_uses: int | None = None,
    current_uses: int = 0,
) -> Coupons:
    coupon = Coupons(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        code=code.upper(),
        discount_value=10,
        is_active=is_active,
        end_date=end_date,
        max_uses=max_uses,
        current_uses=current_uses,
    )
    db.add(coupon)
    db.flush()
    return coupon


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_validate_public_valid_coupon(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Valid coupon returns 200 with correct shape."""
    popup = _make_direct_popup(db, tenant_a)
    _make_coupon(db, popup, code="FEST10")
    db.commit()

    response = client.post(
        "/api/v1/coupons/validate-public",
        json={"popup_slug": popup.slug, "code": "FEST10"},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["code"] == "FEST10"
    assert body["discount_type"] == "percent"
    assert body["discount_value"] == "10"
    assert body["valid"] is True


def test_validate_public_unknown_code_returns_400(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Unknown coupon code returns 400 with uniform message."""
    popup = _make_direct_popup(db, tenant_a)
    db.commit()

    response = client.post(
        "/api/v1/coupons/validate-public",
        json={"popup_slug": popup.slug, "code": "DOESNOTEXIST"},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Invalid or expired coupon"


def test_validate_public_expired_coupon_same_shape(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Expired coupon returns 400 with IDENTICAL shape to unknown-coupon response."""
    popup = _make_direct_popup(db, tenant_a)
    past = datetime.now(UTC) - timedelta(days=1)
    _make_coupon(db, popup, code="EXPIRED99", end_date=past)
    db.commit()

    response = client.post(
        "/api/v1/coupons/validate-public",
        json={"popup_slug": popup.slug, "code": "EXPIRED99"},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 400, response.text
    body = response.json()
    assert body["detail"] == "Invalid or expired coupon"


def test_validate_public_application_popup_returns_403(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Application popup returns 403."""
    popup = _make_app_popup(db, tenant_a)
    db.commit()

    response = client.post(
        "/api/v1/coupons/validate-public",
        json={"popup_slug": popup.slug, "code": "ANY"},
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 403, response.text


def test_validate_public_rate_limit_triggers_429(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """31st request from same IP returns 429 with Retry-After (mocked Redis)."""
    popup = _make_direct_popup(db, tenant_a)
    _make_coupon(db, popup, code="VALID1")
    db.commit()

    # Mock Redis to simulate counter at limit
    mock_redis = __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock()
    mock_redis.get.return_value = "30"  # already at limit=30
    mock_redis.ttl.return_value = 55

    with patch("app.core.rate_limit.get_redis", return_value=mock_redis):
        response = client.post(
            "/api/v1/coupons/validate-public",
            json={"popup_slug": popup.slug, "code": "VALID1"},
            headers={"X-Forwarded-For": "9.9.9.9", "X-Tenant-Id": str(tenant_a.id)},
        )

    assert response.status_code == 429, response.text
    assert "Retry-After" in response.headers


# ---------------------------------------------------------------------------
# Phase 4 — Tenant-scoped coupon validation tests (T-4.1)
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("tenant_a")
def test_coupon_validate_resolves_per_tenant(
    client: TestClient,
    db: Session,
    popup_tenant_a_summer_fest: Popups,
) -> None:
    """Coupon on tenant A's popup, origin=tenant A → 200 with discount."""
    _make_coupon(db, popup_tenant_a_summer_fest, code="SUMMERFEST10")
    db.commit()

    response = client.post(
        "/api/v1/coupons/validate-public",
        json={"popup_slug": "summer-fest", "code": "SUMMERFEST10"},
        headers=with_origin("test-tenant-a.localhost"),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["code"] == "SUMMERFEST10"
    assert body["valid"] is True


@pytest.mark.usefixtures("popup_tenant_a_summer_fest", "popup_tenant_b_summer_fest")
def test_coupon_validate_cross_tenant_returns_invalid(
    client: TestClient,
) -> None:
    """Coupon exists on tenant A's popup; request from tenant B → uniform 400 (not found)."""
    response = client.post(
        "/api/v1/coupons/validate-public",
        json={"popup_slug": "summer-fest", "code": "SUMMERFEST10"},
        headers=with_origin("test-tenant-b.localhost"),
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Invalid or expired coupon"


def test_coupon_validate_unknown_origin_returns_404(
    client: TestClient,
) -> None:
    """No Origin and no X-Tenant-Id → 404 from resolver before coupon logic."""
    response = client.post(
        "/api/v1/coupons/validate-public",
        json={"popup_slug": "summer-fest", "code": "ANY"},
    )

    assert response.status_code == 404, response.text
