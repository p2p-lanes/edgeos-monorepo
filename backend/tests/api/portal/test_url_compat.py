"""Integration tests for PR-7 URL Compat Layer — T-gr-047.

Covers:
  - T-gr-042: GroupSlugResolution schema returned correctly
  - T-gr-043: GET /api/v1/portal/groups/{slug} resolves group → kind="group"
  - T-gr-043: GET /api/v1/portal/groups/{slug} resolves invite token → kind="invite"
  - T-gr-043: 404 when neither group nor invite found
  - T-gr-044: GET /api/v1/portal/invite/{token} returns InvitePublicPreview
  - T-gr-044: 404 for unknown token
  - T-gr-044: 410 for expired invite

Spec: REQ-GR-027 (slug resolver), REQ-GR-028 (canonical invite endpoint)
Design: Decision 1e — GroupSlugResolution with kind discriminator
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.group.models import Groups
from app.api.invite.models import Invites
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_token(user: Users) -> str:
    return create_access_token(subject=user.id, token_type="user")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    invites_enabled: bool = True,
) -> Popups:
    popup = Popups(
        name=f"CompatTest {uuid.uuid4().hex[:6]}",
        slug=f"compat-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        invites_enabled=invites_enabled,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_group(db: Session, popup: Popups, slug: str | None = None) -> Groups:
    group_slug = slug or f"group-{uuid.uuid4().hex[:8]}"
    group = Groups(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"Compat Group {group_slug}",
        slug=group_slug,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


def _make_invite(
    db: Session,
    popup: Popups,
    created_by: Users,
    *,
    token: str | None = None,
    max_uses: int | None = 1,
    current_uses: int = 0,
    expires_at: datetime | None = None,
    discount_percentage: Decimal = Decimal("0"),
) -> Invites:
    tok = token or f"invitetok-{uuid.uuid4().hex[:16]}"
    inv = Invites(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        token=tok,
        max_uses=max_uses,
        current_uses=current_uses,
        auto_approve=True,
        express_checkout=True,
        discount_percentage=discount_percentage,
        expires_at=expires_at,
        created_by=created_by.id,
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return inv


# ---------------------------------------------------------------------------
# Tests — T-gr-043: GET /api/v1/portal/groups/{slug}
# ---------------------------------------------------------------------------


class TestGroupSlugResolver:
    """GET /portal/groups/{slug} resolves to GroupSlugResolution.

    Spec: REQ-GR-027
    Design: Decision 1e
    """

    def test_resolves_to_group_when_group_exists(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Slug matching a group.slug returns kind='group' with group data."""
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, popup, slug=f"res-group-{uuid.uuid4().hex[:8]}")

        resp = client.get(
            f"/api/v1/portal/groups/{group.slug}",
            params={"popup_id": str(popup.id)},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["kind"] == "group"
        assert body["group"] is not None
        assert body["group"]["slug"] == group.slug
        assert body["invite"] is None

    def test_resolves_to_invite_when_slug_matches_token(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Slug matching an invite.token (no matching group) returns kind='invite'.

        This is the key post-migration path: EE26 bulk groups were migrated to
        invites using their slug as the token. Old email links still land on
        /groups/{slug} and must resolve to kind='invite' so the portal can
        redirect to /invite/{token}.

        Spec: REQ-GR-027 scenario 'Legacy email link resolves to invite post-migration'
        """
        popup = _make_popup(db, tenant_a)
        token = f"ee26-bulk-{uuid.uuid4().hex[:12]}"
        _make_invite(db, popup, admin_user_tenant_a, token=token)

        resp = client.get(
            f"/api/v1/portal/groups/{token}",
            params={"popup_id": str(popup.id)},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["kind"] == "invite"
        assert body["group"] is None
        assert body["invite"] is not None
        assert body["invite"]["token"] == token
        assert body["invite"]["popup_id"] == str(popup.id)

    def test_group_takes_precedence_over_invite_with_same_slug_as_token(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """When both a group slug and an invite token match, group wins (resolution order).

        Design: Decision 1e — resolution order: group first, invite second.
        """
        popup = _make_popup(db, tenant_a)
        slug = f"ambiguous-{uuid.uuid4().hex[:8]}"
        _make_group(db, popup, slug=slug)
        _make_invite(db, popup, admin_user_tenant_a, token=slug)

        resp = client.get(
            f"/api/v1/portal/groups/{slug}",
            params={"popup_id": str(popup.id)},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["kind"] == "group"
        assert body["group"]["slug"] == slug

    def test_returns_404_when_neither_group_nor_invite_found(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Unknown slug returns 404."""
        popup = _make_popup(db, tenant_a)
        resp = client.get(
            "/api/v1/portal/groups/does-not-exist-xyz",
            params={"popup_id": str(popup.id)},
        )
        assert resp.status_code == 404

    def test_invite_preview_has_correct_fields(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """invite field in response includes expected InvitePublicPreview fields."""
        popup = _make_popup(db, tenant_a)
        token = f"preview-tok-{uuid.uuid4().hex[:8]}"
        discount = Decimal("15.00")
        _make_invite(
            db,
            popup,
            admin_user_tenant_a,
            token=token,
            max_uses=10,
            discount_percentage=discount,
        )

        resp = client.get(
            f"/api/v1/portal/groups/{token}",
            params={"popup_id": str(popup.id)},
        )
        assert resp.status_code == 200
        inv_data = resp.json()["invite"]
        assert inv_data["token"] == token
        assert inv_data["max_uses"] == 10
        assert inv_data["current_uses"] == 0
        assert float(inv_data["discount_percentage"]) == float(discount)
        assert inv_data["is_email_restricted"] is False

    def test_invite_is_email_restricted_when_recipient_email_set(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """is_email_restricted=True when invite has recipient_email."""
        popup = _make_popup(db, tenant_a)
        token = f"restricted-{uuid.uuid4().hex[:8]}"
        inv = Invites(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            token=token,
            max_uses=1,
            current_uses=0,
            auto_approve=True,
            express_checkout=True,
            discount_percentage=Decimal("0"),
            created_by=admin_user_tenant_a.id,
            recipient_email="test@example.com",
        )
        db.add(inv)
        db.commit()

        resp = client.get(
            f"/api/v1/portal/groups/{token}",
            params={"popup_id": str(popup.id)},
        )
        assert resp.status_code == 200
        assert resp.json()["invite"]["is_email_restricted"] is True


# ---------------------------------------------------------------------------
# Tests — T-gr-044: GET /api/v1/portal/invite/{token}
# ---------------------------------------------------------------------------


class TestCanonicalInviteForward:
    """GET /portal/invite/{token} — canonical forward endpoint.

    Spec: REQ-GR-028
    Design: Decision 1e — thin proxy to /invites/redeem/{token} preview semantics
    """

    def test_returns_invite_preview_for_valid_token(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Valid token returns InvitePublicPreview payload."""
        popup = _make_popup(db, tenant_a)
        token = f"canonical-{uuid.uuid4().hex[:12]}"
        _make_invite(db, popup, admin_user_tenant_a, token=token, max_uses=5)

        resp = client.get(f"/api/v1/portal/invite/{token}")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["token"] == token
        assert body["popup_id"] == str(popup.id)
        assert body["max_uses"] == 5
        assert body["current_uses"] == 0
        assert "is_email_restricted" in body

    def test_returns_404_for_unknown_token(
        self,
        client: TestClient,
    ) -> None:
        """Unknown token returns 404."""
        resp = client.get("/api/v1/portal/invite/totally-unknown-token-xyz")
        assert resp.status_code == 404

    def test_returns_410_for_expired_invite(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Expired invite returns 410 Gone."""
        popup = _make_popup(db, tenant_a)
        past = datetime.now(UTC) - timedelta(days=1)
        token = f"expired-{uuid.uuid4().hex[:8]}"
        _make_invite(db, popup, admin_user_tenant_a, token=token, expires_at=past)

        resp = client.get(f"/api/v1/portal/invite/{token}")
        assert resp.status_code == 410

    def test_returns_410_for_exhausted_invite(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Exhausted invite (current_uses >= max_uses) returns 410 Gone."""
        popup = _make_popup(db, tenant_a)
        token = f"exhausted-{uuid.uuid4().hex[:8]}"
        _make_invite(
            db, popup, admin_user_tenant_a, token=token, max_uses=1, current_uses=1
        )

        resp = client.get(f"/api/v1/portal/invite/{token}")
        assert resp.status_code == 410

    def test_unlimited_invite_not_expired(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Unlimited invite (max_uses=None) with existing uses is still valid."""
        popup = _make_popup(db, tenant_a)
        token = f"unlimited-{uuid.uuid4().hex[:8]}"
        _make_invite(
            db,
            popup,
            admin_user_tenant_a,
            token=token,
            max_uses=None,
            current_uses=5,
        )

        resp = client.get(f"/api/v1/portal/invite/{token}")
        assert resp.status_code == 200
        assert resp.json()["max_uses"] is None
        assert resp.json()["current_uses"] == 5
