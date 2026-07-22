"""Suspension enforcement for expired trials.

A suspended tenant (suspended_at set) must:
  - block backoffice user login and OTP redemption with 403 "trial_ended"
  - resolve to 403 "trial_ended" on the public by-domain / by-slug lookups

Data and credentials stay intact — suspension is reversible.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users

LOGIN_URL = "/api/v1/auth/user/login"
AUTH_URL = "/api/v1/auth/user/authenticate"


def _make_suspended_trial(
    db: Session,
    *,
    custom_domain: str | None = None,
) -> tuple[Tenants, Users]:
    suffix = uuid.uuid4().hex[:8]
    tenant = Tenants(
        name=f"Suspended Trial {suffix}",
        slug=f"suspended-trial-{suffix}",
        is_trial=True,
        suspended_at=datetime.now(UTC),
        custom_domain=custom_domain,
        custom_domain_active=custom_domain is not None,
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)

    user = Users(
        email=f"suspended-admin-{suffix}@example.com",
        role=UserRole.ADMIN,
        tenant_id=tenant.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return tenant, user


def test_login_blocked_for_suspended_tenant(client: TestClient, db: Session) -> None:
    _tenant, user = _make_suspended_trial(db)

    resp = client.post(LOGIN_URL, json={"email": user.email})
    assert resp.status_code == 403
    assert resp.json()["detail"] == "trial_ended"


def test_authenticate_blocked_for_suspended_tenant(
    client: TestClient, db: Session
) -> None:
    """The check runs before OTP verification, so even a valid code is moot."""
    _tenant, user = _make_suspended_trial(db)

    resp = client.post(AUTH_URL, json={"email": user.email, "code": "123456"})
    assert resp.status_code == 403
    assert resp.json()["detail"] == "trial_ended"


def test_login_still_works_for_active_tenants(
    client: TestClient, admin_user_tenant_a: Users
) -> None:
    """Regression guard: the suspension check must not affect normal tenants.

    tenant_a is not suspended, so login proceeds past the suspension check
    (it may still fail later on email delivery — anything but 403 is fine).
    """
    resp = client.post(LOGIN_URL, json={"email": admin_user_tenant_a.email})
    assert resp.status_code != 403


def test_by_domain_returns_trial_ended_for_suspended_tenant(
    client: TestClient, db: Session
) -> None:
    domain = f"suspended-{uuid.uuid4().hex[:8]}.example.com"
    _make_suspended_trial(db, custom_domain=domain)

    resp = client.get(f"/api/v1/tenants/public/by-domain/{domain}")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "trial_ended"

    # Second hit (possibly served from the domain cache sentinel) is identical
    resp = client.get(f"/api/v1/tenants/public/by-domain/{domain}")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "trial_ended"


def test_by_slug_returns_trial_ended_for_suspended_tenant(
    client: TestClient, db: Session
) -> None:
    tenant, _user = _make_suspended_trial(db)

    resp = client.get(f"/api/v1/tenants/public/{tenant.slug}")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "trial_ended"


def test_by_slug_still_resolves_active_tenants(
    client: TestClient, tenant_a: Tenants
) -> None:
    resp = client.get(f"/api/v1/tenants/public/{tenant_a.slug}")
    assert resp.status_code == 200
