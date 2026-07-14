"""Per-app api-key scope subset enforcement.

RED-phase for Slice 2 Block C.

REQ-4.1: third-party JWT with issued_by_app_id set → enforce app.allowed_api_key_scopes.
REQ-5.1: legacy JWT (issued_via=third_party, issued_by_app_id=None) falls back to
         THIRD_PARTY_API_KEY_SCOPES_MAX ceiling.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants

CREATE_URL = "/api/v1/api-keys"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_human(db: Session, *, tenant: Tenants, email: str) -> Humans:
    h = Humans(tenant_id=tenant.id, email=email)
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


def _member_popup(db: Session, *, tenant: Tenants, human: Humans) -> Popups:
    """Popup with an accepted application for ``human``.

    API keys are popup-bound and require popup membership at creation.
    """
    from app.api.application.models import Applications
    from app.api.application.schemas import ApplicationStatus

    popup = Popups(
        name=f"AK Popup {uuid.uuid4().hex[:6]}",
        slug=f"ak-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    db.add(
        Applications(
            tenant_id=tenant.id,
            popup_id=popup.id,
            human_id=human.id,
            status=ApplicationStatus.ACCEPTED.value,
        )
    )
    db.commit()
    return popup


def _expiry() -> str:
    return (datetime.now(UTC) + timedelta(days=7)).isoformat()


class TestPerAppScopeSubset:
    """REQ-4.1 — issued_by_app_id present: enforce app.allowed_api_key_scopes."""

    def test_scope_within_app_allowed_succeeds(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Requesting a scope that is in app.allowed_api_key_scopes → 201."""
        from app.api.api_key.crud import generate_raw_key, hash_key
        from app.api.third_party_app.models import ThirdPartyApps
        from app.core.security import create_access_token

        raw_key = generate_raw_key()
        app = ThirdPartyApps(
            tenant_id=tenant_a.id,
            name=f"per-app-ok-{uuid.uuid4().hex[:6]}",
            key_hash=hash_key(raw_key),
            prefix=raw_key[:8],
            allowed_token_scopes=["portal:applications:read", "portal:api_keys:manage"],
            allowed_api_key_scopes=["events:read"],
            active=True,
        )
        db.add(app)
        db.commit()
        db.refresh(app)

        email = f"pa-api-ok-{uuid.uuid4().hex[:8]}@example.com"
        human = _make_human(db, tenant=tenant_a, email=email)
        popup = _member_popup(db, tenant=tenant_a, human=human)

        token = create_access_token(
            subject=human.id,
            token_type="human",
            issued_via="third_party",
            scopes=["portal:applications:read", "portal:api_keys:manage"],
            issued_by_app_id=app.id,
        )
        resp = client.post(
            CREATE_URL,
            headers=_bearer(token),
            json={
                "name": "my-events-key",
                "scopes": ["events:read"],
                "popup_id": str(popup.id),
            },
        )
        assert resp.status_code == 201, resp.text

        db.delete(app)
        db.commit()

    def test_scope_outside_app_allowed_returns_403(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Requesting rsvp:write when app only allows events:read → 403."""
        from app.api.api_key.crud import generate_raw_key, hash_key
        from app.api.third_party_app.models import ThirdPartyApps
        from app.core.security import create_access_token

        raw_key = generate_raw_key()
        app = ThirdPartyApps(
            tenant_id=tenant_a.id,
            name=f"per-app-block-{uuid.uuid4().hex[:6]}",
            key_hash=hash_key(raw_key),
            prefix=raw_key[:8],
            allowed_token_scopes=["portal:applications:read", "portal:api_keys:manage"],
            allowed_api_key_scopes=["events:read"],
            active=True,
        )
        db.add(app)
        db.commit()
        db.refresh(app)

        email = f"pa-api-block-{uuid.uuid4().hex[:8]}@example.com"
        human = _make_human(db, tenant=tenant_a, email=email)

        token = create_access_token(
            subject=human.id,
            token_type="human",
            issued_via="third_party",
            scopes=["portal:applications:read", "portal:api_keys:manage"],
            issued_by_app_id=app.id,
        )
        resp = client.post(
            CREATE_URL,
            headers=_bearer(token),
            json={
                "name": "rsvp-key",
                "scopes": ["rsvp:write"],
                "expires_at": _expiry(),
                # Scope check fires before the popup is resolved.
                "popup_id": str(uuid.uuid4()),
            },
        )
        assert resp.status_code == 403, resp.text
        assert "rsvp:write" in resp.json()["detail"]

        db.delete(app)
        db.commit()

    def test_revoked_app_returns_401(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """If the app was deleted/revoked between JWT mint and key creation → 401."""
        from app.api.api_key.crud import generate_raw_key, hash_key
        from app.api.third_party_app.models import ThirdPartyApps
        from app.core.security import create_access_token

        raw_key = generate_raw_key()
        app = ThirdPartyApps(
            tenant_id=tenant_a.id,
            name=f"per-app-revoked-{uuid.uuid4().hex[:6]}",
            key_hash=hash_key(raw_key),
            prefix=raw_key[:8],
            allowed_token_scopes=["portal:applications:read", "portal:api_keys:manage"],
            allowed_api_key_scopes=["events:read"],
            active=True,
        )
        db.add(app)
        db.commit()
        db.refresh(app)

        email = f"pa-api-revoked-{uuid.uuid4().hex[:8]}@example.com"
        human = _make_human(db, tenant=tenant_a, email=email)

        # Mint token while app is still active
        token = create_access_token(
            subject=human.id,
            token_type="human",
            issued_via="third_party",
            scopes=["portal:applications:read", "portal:api_keys:manage"],
            issued_by_app_id=app.id,
        )

        # Now revoke the app
        app.active = False
        app.revoked_at = datetime.now(UTC)
        db.add(app)
        db.commit()

        resp = client.post(
            CREATE_URL,
            headers=_bearer(token),
            json={
                "name": "post-revoke-key",
                "scopes": ["events:read"],
                # App revocation check fires before the popup is resolved.
                "popup_id": str(uuid.uuid4()),
            },
        )
        assert resp.status_code == 401, resp.text

        db.delete(app)
        db.commit()


class TestLegacyJwtFallback:
    """REQ-5.1 — legacy JWT (issued_via=third_party, issued_by_app_id=None)
    falls back to THIRD_PARTY_API_KEY_SCOPES_MAX ceiling."""

    def test_legacy_jwt_can_mint_within_max_scopes(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """A legacy JWT (no issued_by_app_id) can still mint events:read keys."""
        from app.core.security import create_access_token

        tenant, _app, _raw = third_party_enabled_tenant
        email = f"legacy-ok-{uuid.uuid4().hex[:8]}@example.com"
        human = _make_human(db, tenant=tenant, email=email)
        popup = _member_popup(db, tenant=tenant, human=human)

        # Legacy token: issued_via=third_party but NO issued_by_app_id
        token = create_access_token(
            subject=human.id,
            token_type="human",
            issued_via="third_party",
            scopes=["portal:applications:read", "portal:api_keys:manage"],
        )
        resp = client.post(
            CREATE_URL,
            headers=_bearer(token),
            json={
                "name": "legacy-events-key",
                "scopes": ["events:read"],
                "popup_id": str(popup.id),
            },
        )
        assert resp.status_code == 201, resp.text

    def test_legacy_jwt_can_mint_rsvp_write_key(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """Legacy JWT can mint rsvp:write (in THIRD_PARTY_API_KEY_SCOPES_MAX)."""
        from app.core.security import create_access_token

        tenant, _app, _raw = third_party_enabled_tenant
        email = f"legacy-rsvp-{uuid.uuid4().hex[:8]}@example.com"
        human = _make_human(db, tenant=tenant, email=email)
        popup = _member_popup(db, tenant=tenant, human=human)

        token = create_access_token(
            subject=human.id,
            token_type="human",
            issued_via="third_party",
            scopes=["portal:applications:read", "portal:api_keys:manage"],
        )
        resp = client.post(
            CREATE_URL,
            headers=_bearer(token),
            json={
                "name": "legacy-rsvp-key",
                "scopes": ["rsvp:write"],
                "expires_at": _expiry(),
                "popup_id": str(popup.id),
            },
        )
        assert resp.status_code == 201, resp.text

    def test_legacy_jwt_blocked_for_scope_outside_max(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """Legacy JWT still blocked for scopes outside THIRD_PARTY_API_KEY_SCOPES_MAX."""
        from app.core.security import create_access_token

        tenant, _app, _raw = third_party_enabled_tenant
        email = f"legacy-block-{uuid.uuid4().hex[:8]}@example.com"
        human = _make_human(db, tenant=tenant, email=email)

        token = create_access_token(
            subject=human.id,
            token_type="human",
            issued_via="third_party",
            scopes=["portal:applications:read", "portal:api_keys:manage"],
        )
        resp = client.post(
            CREATE_URL,
            headers=_bearer(token),
            json={
                "name": "legacy-venues-key",
                "scopes": ["venues:write"],
                "expires_at": _expiry(),
                # Scope check fires before the popup is resolved.
                "popup_id": str(uuid.uuid4()),
            },
        )
        assert resp.status_code == 403, resp.text
