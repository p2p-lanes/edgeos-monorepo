"""Tests for the checkout-without-OTP token tier.

Covers:
- The shortcut issues a ``human_checkout`` token bound to ``popup_id``.
- The shortcut rejects emails that already have a Human in the tenant.
- The lighter token cannot reach endpoints outside the checkout allowlist.
- The lighter token cannot be replayed against a different popup.
"""

import jwt
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.config import settings
from app.core.security import ALGORITHM


def _make_direct_popup(
    db: Session, tenant: Tenants, *, slug: str, otp_enabled: bool = False
) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Direct Popup {slug}",
        slug=slug,
        sale_type=SaleType.direct.value,
        checkout_otp_enabled=otp_enabled,
        status=PopupStatus.active.value,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _decode(token: str) -> dict:
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])


def test_checkout_authenticate_issues_scoped_token(
    client, db: Session, tenant_a: Tenants
):
    popup = _make_direct_popup(db, tenant_a, slug="otp-token-issue")

    response = client.post(
        "/api/v1/auth/human/checkout-authenticate",
        json={
            "popup_id": str(popup.id),
            "email": "new-buyer-otp-token-issue@test.com",
        },
    )

    assert response.status_code == 200
    token = response.json()["access_token"]
    payload = _decode(token)
    assert payload["token_type"] == "human_checkout"
    assert payload["popup_id"] == str(popup.id)


def test_checkout_authenticate_rejects_existing_email(
    client, db: Session, tenant_a: Tenants
):
    popup = _make_direct_popup(db, tenant_a, slug="otp-existing-email")

    existing = Humans(
        tenant_id=tenant_a.id,
        email="already-registered-otp@test.com",
    )
    db.add(existing)
    db.commit()

    response = client.post(
        "/api/v1/auth/human/checkout-authenticate",
        json={
            "popup_id": str(popup.id),
            "email": "already-registered-otp@test.com",
        },
    )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "otp_required"


def test_checkout_token_cannot_access_full_portal_endpoint(
    client, db: Session, tenant_a: Tenants
):
    popup = _make_direct_popup(db, tenant_a, slug="otp-token-portal-block")

    auth_response = client.post(
        "/api/v1/auth/human/checkout-authenticate",
        json={
            "popup_id": str(popup.id),
            "email": "blocked-portal@test.com",
        },
    )
    token = auth_response.json()["access_token"]

    # /applications/my is a full-portal endpoint guarded by CurrentHuman —
    # the lighter token must NOT pass.
    blocked = client.get(
        "/api/v1/applications/my/applications",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Tenant-Id": str(tenant_a.id),
        },
    )
    assert blocked.status_code == 403


def test_checkout_token_cannot_be_replayed_on_other_popup(
    client, db: Session, tenant_a: Tenants
):
    popup_a = _make_direct_popup(db, tenant_a, slug="otp-popup-bound-a")
    popup_b = _make_direct_popup(db, tenant_a, slug="otp-popup-bound-b")

    auth_response = client.post(
        "/api/v1/auth/human/checkout-authenticate",
        json={
            "popup_id": str(popup_a.id),
            "email": "popup-bound-buyer@test.com",
        },
    )
    token = auth_response.json()["access_token"]

    # Same allowlisted endpoint, but pointed at the other popup — must reject.
    cross = client.get(
        f"/api/v1/popups/portal/{popup_b.slug}",  # different popup than token bound to
        headers={
            "Authorization": f"Bearer {token}",
            "X-Tenant-Id": str(tenant_a.id),
        },
    )
    assert cross.status_code == 403


def test_checkout_authenticate_rejects_application_popup(
    client, db: Session, tenant_a: Tenants
):
    """The shortcut is only valid for direct-sale popups even if the toggle
    is somehow disabled on an application popup."""
    popup = Popups(
        tenant_id=tenant_a.id,
        name="App Popup",
        slug="otp-token-app-popup",
        sale_type=SaleType.application.value,
        checkout_otp_enabled=False,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)

    response = client.post(
        "/api/v1/auth/human/checkout-authenticate",
        json={
            "popup_id": str(popup.id),
            "email": "app-popup-buyer@test.com",
        },
    )

    assert response.status_code == 403
