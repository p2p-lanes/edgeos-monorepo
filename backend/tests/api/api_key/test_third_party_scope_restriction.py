"""Portal api-key minting scope restriction for third-party JWT callers.

RED-phase for the Block 4 leftover (verify-S2 finding).

REQ-AK-04: When issued_via=third_party, requested scopes MUST be a
           subset of THIRD_PARTY_API_KEY_SCOPES. Outside → 403.
REQ-AK-05: When issued_via=portal, existing validation is unchanged.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
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


class TestThirdPartyJwtApiKeyMintingRestriction:
    """REQ-AK-04."""

    def test_third_party_jwt_can_mint_events_read_key(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant: tuple[Tenants, str],
        third_party_jwt_factory,
    ) -> None:
        """events:read is in THIRD_PARTY_API_KEY_SCOPES → key created (201)."""
        tenant, _raw = third_party_enabled_tenant
        email = f"tp-mint-ok-{uuid.uuid4().hex[:8]}@example.com"
        human = _make_human(db, tenant=tenant, email=email)
        token = third_party_jwt_factory(human=human)

        resp = client.post(
            CREATE_URL,
            headers=_bearer(token),
            json={"name": "tp-events", "scopes": ["events:read"]},
        )
        assert resp.status_code == 201, resp.text

    def test_third_party_jwt_cannot_mint_venues_write_key(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant: tuple[Tenants, str],
        third_party_jwt_factory,
    ) -> None:
        """venues:write is NOT in THIRD_PARTY_API_KEY_SCOPES → 403.

        expires_at is provided so schema-level write-requires-expiry does not
        fire before our router check reaches the third-party universe guard.
        """
        from datetime import UTC, datetime, timedelta

        tenant, _raw = third_party_enabled_tenant
        email = f"tp-mint-block-{uuid.uuid4().hex[:8]}@example.com"
        human = _make_human(db, tenant=tenant, email=email)
        token = third_party_jwt_factory(human=human)
        expiry = (datetime.now(UTC) + timedelta(days=7)).isoformat()

        resp = client.post(
            CREATE_URL,
            headers=_bearer(token),
            json={"name": "tp-venues", "scopes": ["venues:write"], "expires_at": expiry},
        )
        assert resp.status_code == 403, resp.text

    def test_third_party_jwt_cannot_mint_rsvp_and_venues_mixed(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant: tuple[Tenants, str],
        third_party_jwt_factory,
    ) -> None:
        """Mixed scopes where venues:write is not in subset → 403.

        expires_at is provided so schema-level write-requires-expiry validator
        does not reject the request before the third-party universe guard runs.
        """
        from datetime import UTC, datetime, timedelta

        tenant, _raw = third_party_enabled_tenant
        email = f"tp-mint-mixed-{uuid.uuid4().hex[:8]}@example.com"
        human = _make_human(db, tenant=tenant, email=email)
        token = third_party_jwt_factory(human=human)
        expiry = (datetime.now(UTC) + timedelta(days=7)).isoformat()

        resp = client.post(
            CREATE_URL,
            headers=_bearer(token),
            json={"name": "tp-mixed", "scopes": ["rsvp:write", "venues:write"], "expires_at": expiry},
        )
        assert resp.status_code == 403, resp.text


class TestPortalJwtApiKeyMintingUnchanged:
    """REQ-AK-05: portal JWT behavior must not regress."""

    def test_portal_jwt_can_mint_events_read_key(
        self,
        client: TestClient,
        db: Session,
        third_party_enabled_tenant: tuple[Tenants, str],
    ) -> None:
        """Regular portal JWT (no issued_via / scopes=portal:*) can mint events:read."""
        from app.core.security import create_access_token

        tenant, _raw = third_party_enabled_tenant
        email = f"portal-mint-ok-{uuid.uuid4().hex[:8]}@example.com"
        human = _make_human(db, tenant=tenant, email=email)
        # Mint a legacy-style portal JWT (no scopes, no issued_via)
        token = create_access_token(subject=human.id, token_type="human")

        resp = client.post(
            CREATE_URL,
            headers=_bearer(token),
            json={"name": "portal-events", "scopes": ["events:read"]},
        )
        assert resp.status_code == 201, resp.text
