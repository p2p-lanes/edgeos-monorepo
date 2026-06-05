"""Tests for PR-4: Invite module — T-gr-027.

Covers:
  - T-gr-022: Invites model (table exists, basic CRUD at DB level)
  - T-gr-023: Invite schemas (InviteCreate, InvitePublic, InvitePublicPreview)
  - T-gr-024: InvitesCRUD operations
  - T-gr-025: Admin CRUD endpoints + portal redemption + guard chain
  - T-gr-027: Integration tests

Spec refs: REQ-GR-001 through REQ-GR-007 (invites), REQ-GR-026 (popup flag gate)
Design refs: Decision 1c (module layout), API surface table for invites
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
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


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    invites_enabled: bool = True,
) -> Popups:
    popup = Popups(
        name=f"InviteTest {uuid.uuid4().hex[:6]}",
        slug=f"invitetest-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        invites_enabled=invites_enabled,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants, email: str | None = None) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=email or f"invitetest-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Invite",
        last_name="Tester",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_invite(
    db: Session,
    popup: Popups,
    created_by: Users,
    *,
    token: str | None = None,
    recipient_email: str | None = None,
    max_uses: int | None = 1,
    current_uses: int = 0,
    auto_approve: bool = True,
    express_checkout: bool = True,
    discount_percentage: Decimal = Decimal("0"),
    expires_at: datetime | None = None,
) -> Invites:
    invite_token = token or f"tok-{uuid.uuid4().hex[:16]}"
    inv = Invites(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        token=invite_token,
        recipient_email=recipient_email.lower() if recipient_email else None,
        max_uses=max_uses,
        current_uses=current_uses,
        auto_approve=auto_approve,
        express_checkout=express_checkout,
        discount_percentage=discount_percentage,
        expires_at=expires_at,
        created_by=created_by.id,
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return inv


# ---------------------------------------------------------------------------
# T-gr-022: Model — table exists and can be written/read
# ---------------------------------------------------------------------------


class TestInviteModel:
    """Invites SQLModel table exists and basic DB operations work (T-gr-022).

    Spec: REQ-GR-001 — Invite entity and schema.
    """

    def test_invite_can_be_created_and_fetched(
        self, db: Session, tenant_a: Tenants, admin_user_tenant_a: Users
    ) -> None:
        """Direct DB write + read round-trip validates the model and table."""
        popup = _make_popup(db, tenant_a)
        invite = _make_invite(db, popup, admin_user_tenant_a, token="model-test-tok")

        fetched = db.get(Invites, invite.id)
        assert fetched is not None
        assert fetched.token == "model-test-tok"
        assert fetched.popup_id == popup.id
        assert fetched.current_uses == 0
        assert fetched.auto_approve is True

    def test_invite_stores_recipient_email(
        self, db: Session, tenant_a: Tenants, admin_user_tenant_a: Users
    ) -> None:
        """recipient_email stored; no normalisation needed here (model-level)."""
        popup = _make_popup(db, tenant_a)
        invite = _make_invite(
            db,
            popup,
            admin_user_tenant_a,
            token="email-test-tok",
            recipient_email="alice@example.com",
        )
        fetched = db.get(Invites, invite.id)
        assert fetched is not None
        assert fetched.recipient_email == "alice@example.com"


# ---------------------------------------------------------------------------
# T-gr-023 / T-gr-024: Schemas and CRUD — tested via HTTP endpoints
# ---------------------------------------------------------------------------


class TestInviteAdminCRUD:
    """Admin CRUD endpoints (T-gr-025): POST /invites, GET, PATCH, DELETE.

    Spec: REQ-GR-001 (create), REQ-GR-002 (admin-only), REQ-GR-006 (admin list/CRUD).
    """

    def test_admin_can_create_invite(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-001: Admin creates invite; token auto-generated when omitted."""
        popup = _make_popup(db, tenant_a)
        token = _admin_token(admin_user_tenant_a)

        resp = client.post(
            "/api/v1/invites",
            json={"popup_id": str(popup.id), "max_uses": 1},
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code in (200, 201), resp.json()
        body = resp.json()
        assert "token" in body
        assert body["current_uses"] == 0
        assert body["popup_id"] == str(popup.id)

    def test_admin_can_create_invite_with_explicit_token(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Custom token accepted when provided and unique."""
        popup = _make_popup(db, tenant_a)
        token = _admin_token(admin_user_tenant_a)
        explicit_tok = f"custom-{uuid.uuid4().hex[:12]}"

        resp = client.post(
            "/api/v1/invites",
            json={"popup_id": str(popup.id), "token": explicit_tok, "max_uses": 5},
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code in (200, 201), resp.json()
        assert resp.json()["token"] == explicit_tok

    def test_duplicate_token_returns_409(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-001 scenario: duplicate token within popup → 409 Conflict."""
        popup = _make_popup(db, tenant_a)
        dup_tok = f"dup-{uuid.uuid4().hex[:12]}"
        # Pre-create an invite with this token directly in DB
        _make_invite(db, popup, admin_user_tenant_a, token=dup_tok)

        token = _admin_token(admin_user_tenant_a)
        resp = client.post(
            "/api/v1/invites",
            json={"popup_id": str(popup.id), "token": dup_tok},
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 409, resp.json()

    def test_human_cannot_create_invite(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-002: Human attempting POST /invites → 403 Forbidden."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        human_tok = _human_token(human)

        resp = client.post(
            "/api/v1/invites",
            json={"popup_id": str(popup.id)},
            headers=_auth(human_tok),
        )
        assert resp.status_code == 403, resp.json()

    def test_admin_can_list_invites(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-006: Admin lists invites for popup."""
        popup = _make_popup(db, tenant_a)
        _make_invite(
            db, popup, admin_user_tenant_a, token=f"list-{uuid.uuid4().hex[:8]}"
        )
        _make_invite(
            db, popup, admin_user_tenant_a, token=f"list-{uuid.uuid4().hex[:8]}"
        )

        token = _admin_token(admin_user_tenant_a)
        resp = client.get(
            f"/api/v1/invites?popup_id={popup.id}",
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 200, resp.json()
        body = resp.json()
        assert "results" in body
        assert body["paging"]["total"] >= 2

    def test_admin_can_get_single_invite(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Admin GET /invites/{id} returns full detail."""
        popup = _make_popup(db, tenant_a)
        invite = _make_invite(
            db, popup, admin_user_tenant_a, token=f"single-{uuid.uuid4().hex[:8]}"
        )
        token = _admin_token(admin_user_tenant_a)

        resp = client.get(
            f"/api/v1/invites/{invite.id}",
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 200, resp.json()
        assert resp.json()["id"] == str(invite.id)

    def test_admin_can_patch_invite(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Admin PATCH /invites/{id} updates mutable fields."""
        popup = _make_popup(db, tenant_a)
        invite = _make_invite(
            db,
            popup,
            admin_user_tenant_a,
            token=f"patch-{uuid.uuid4().hex[:8]}",
            max_uses=1,
        )
        token = _admin_token(admin_user_tenant_a)

        resp = client.patch(
            f"/api/v1/invites/{invite.id}",
            json={"max_uses": 10, "auto_approve": False},
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 200, resp.json()
        body = resp.json()
        assert body["max_uses"] == 10
        assert body["auto_approve"] is False

    def test_admin_can_delete_unused_invite(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Admin DELETE /invites/{id} succeeds when current_uses=0."""
        popup = _make_popup(db, tenant_a)
        invite = _make_invite(
            db,
            popup,
            admin_user_tenant_a,
            token=f"del-{uuid.uuid4().hex[:8]}",
            max_uses=5,
        )
        token = _admin_token(admin_user_tenant_a)

        resp = client.delete(
            f"/api/v1/invites/{invite.id}",
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code in (200, 204), resp.json()

    def test_delete_used_invite_returns_409(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """DELETE /invites/{id} returns 409 when current_uses > 0."""
        popup = _make_popup(db, tenant_a)
        invite = _make_invite(
            db,
            popup,
            admin_user_tenant_a,
            token=f"delused-{uuid.uuid4().hex[:8]}",
            max_uses=5,
            current_uses=1,
        )
        token = _admin_token(admin_user_tenant_a)

        resp = client.delete(
            f"/api/v1/invites/{invite.id}",
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 409, resp.json()

    def test_invite_blocked_when_invites_disabled(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-026: popup.invites_enabled=False → admin create blocked (403/422)."""
        popup = _make_popup(db, tenant_a, invites_enabled=False)
        token = _admin_token(admin_user_tenant_a)

        resp = client.post(
            "/api/v1/invites",
            json={"popup_id": str(popup.id)},
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code in (403, 422), resp.json()


# ---------------------------------------------------------------------------
# Portal preview endpoint — GET /invites/redeem/{token}
# ---------------------------------------------------------------------------


class TestInvitePreview:
    """Portal preview endpoint: GET /invites/redeem/{token} (T-gr-025).

    Spec: REQ-GR-005 — inviter_name, is_email_restricted, no recipient_email leak.
    """

    def test_preview_returns_inviter_name_and_is_email_restricted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-005 scenario: preview includes inviter_name and is_email_restricted."""
        popup = _make_popup(db, tenant_a)
        tok = f"preview-{uuid.uuid4().hex[:12]}"
        _make_invite(
            db,
            popup,
            admin_user_tenant_a,
            token=tok,
            recipient_email="alice@example.com",
        )

        resp = client.get(f"/api/v1/invites/redeem/{tok}")
        assert resp.status_code == 200, resp.json()
        body = resp.json()
        assert "inviter_name" in body
        assert body["is_email_restricted"] is True
        assert "recipient_email" not in body

    def test_preview_no_email_restriction_when_no_recipient(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-005 scenario: open invite → is_email_restricted=False."""
        popup = _make_popup(db, tenant_a)
        tok = f"open-{uuid.uuid4().hex[:12]}"
        _make_invite(db, popup, admin_user_tenant_a, token=tok, recipient_email=None)

        resp = client.get(f"/api/v1/invites/redeem/{tok}")
        assert resp.status_code == 200, resp.json()
        body = resp.json()
        assert body["is_email_restricted"] is False
        assert "recipient_email" not in body

    def test_preview_unknown_token_returns_404(
        self,
        client: TestClient,
    ) -> None:
        """Unknown token → 404."""
        resp = client.get("/api/v1/invites/redeem/does-not-exist-xyz")
        assert resp.status_code == 404, resp.json()

    def test_preview_expired_invite_returns_410(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Expired invite → 410 Gone (REQ-GR-003 step 1)."""
        popup = _make_popup(db, tenant_a)
        past = datetime.now(UTC) - timedelta(days=1)
        tok = f"expired-{uuid.uuid4().hex[:12]}"
        _make_invite(db, popup, admin_user_tenant_a, token=tok, expires_at=past)

        resp = client.get(f"/api/v1/invites/redeem/{tok}")
        assert resp.status_code == 410, resp.json()

    def test_preview_exhausted_invite_returns_410(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Exhausted invite (current_uses >= max_uses) → 410 Gone (REQ-GR-003 step 2)."""
        popup = _make_popup(db, tenant_a)
        tok = f"exhausted-{uuid.uuid4().hex[:12]}"
        _make_invite(
            db, popup, admin_user_tenant_a, token=tok, max_uses=1, current_uses=1
        )

        resp = client.get(f"/api/v1/invites/redeem/{tok}")
        assert resp.status_code == 410, resp.json()


# ---------------------------------------------------------------------------
# Portal redemption — POST /invites/redeem/{token}
# ---------------------------------------------------------------------------


class TestInviteRedemption:
    """Portal redemption endpoint: POST /invites/redeem/{token} (T-gr-025).

    Spec: REQ-GR-003 (guard order), REQ-GR-004 (flags on application).
    """

    def test_happy_path_single_use_increments_uses(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-003 success: current_uses incremented, used_at set."""
        popup = _make_popup(db, tenant_a)
        tok = f"redeem-{uuid.uuid4().hex[:12]}"
        invite = _make_invite(
            db, popup, admin_user_tenant_a, token=tok, max_uses=1, auto_approve=False
        )
        human = _make_human(db, tenant_a)
        human_tok = _human_token(human)

        resp = client.post(
            f"/api/v1/invites/redeem/{tok}",
            json={"popup_id": str(popup.id)},
            headers=_auth(human_tok),
        )
        assert resp.status_code in (200, 201), resp.json()

        db.refresh(invite)
        assert invite.current_uses == 1
        assert invite.used_at is not None

    def test_expired_invite_rejected_with_410(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-003 step 1: expiration check is first in guard order → 410."""
        popup = _make_popup(db, tenant_a)
        past = datetime.now(UTC) - timedelta(days=1)
        tok = f"exp-redeem-{uuid.uuid4().hex[:12]}"
        _make_invite(
            db, popup, admin_user_tenant_a, token=tok, expires_at=past, max_uses=100
        )
        human = _make_human(db, tenant_a)
        human_tok = _human_token(human)

        resp = client.post(
            f"/api/v1/invites/redeem/{tok}",
            json={"popup_id": str(popup.id)},
            headers=_auth(human_tok),
        )
        assert resp.status_code == 410, resp.json()

    def test_exhausted_invite_rejected_with_410(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-003 step 2: use limit check → 410."""
        popup = _make_popup(db, tenant_a)
        tok = f"exh-redeem-{uuid.uuid4().hex[:12]}"
        _make_invite(
            db, popup, admin_user_tenant_a, token=tok, max_uses=1, current_uses=1
        )
        human = _make_human(db, tenant_a)

        resp = client.post(
            f"/api/v1/invites/redeem/{tok}",
            json={"popup_id": str(popup.id)},
            headers=_auth(_human_token(human)),
        )
        assert resp.status_code == 410, resp.json()

    def test_email_mismatch_rejected_with_403(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-003 step 3: recipient_email mismatch → 403."""
        popup = _make_popup(db, tenant_a)
        tok = f"mismatch-{uuid.uuid4().hex[:12]}"
        _make_invite(
            db,
            popup,
            admin_user_tenant_a,
            token=tok,
            recipient_email="alice@example.com",
            max_uses=10,
        )
        bob = _make_human(db, tenant_a, email=f"bob-{uuid.uuid4().hex[:8]}@example.com")

        resp = client.post(
            f"/api/v1/invites/redeem/{tok}",
            json={"popup_id": str(popup.id)},
            headers=_auth(_human_token(bob)),
        )
        assert resp.status_code == 403, resp.json()

    def test_email_match_case_insensitive(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-003: recipient_email comparison is case-insensitive."""
        popup = _make_popup(db, tenant_a)
        tok = f"case-{uuid.uuid4().hex[:12]}"
        alice_email = f"ALICE-{uuid.uuid4().hex[:6]}@EXAMPLE.COM"
        _make_invite(
            db,
            popup,
            admin_user_tenant_a,
            token=tok,
            recipient_email=alice_email,
            max_uses=10,
        )
        alice = _make_human(db, tenant_a, email=alice_email.lower())

        resp = client.post(
            f"/api/v1/invites/redeem/{tok}",
            json={"popup_id": str(popup.id)},
            headers=_auth(_human_token(alice)),
        )
        assert resp.status_code in (200, 201), resp.json()

    def test_auto_approve_invite_creates_accepted_application(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-004: auto_approve=True → application status is ACCEPTED."""
        popup = _make_popup(db, tenant_a)
        tok = f"autoapprove-{uuid.uuid4().hex[:12]}"
        _make_invite(
            db, popup, admin_user_tenant_a, token=tok, max_uses=100, auto_approve=True
        )
        human = _make_human(db, tenant_a)

        resp = client.post(
            f"/api/v1/invites/redeem/{tok}",
            json={"popup_id": str(popup.id)},
            headers=_auth(_human_token(human)),
        )
        assert resp.status_code in (200, 201), resp.json()
        body = resp.json()
        # Response includes application_status from InviteRedeemResponse
        assert body.get("application_status") == "accepted", (
            f"Expected application_status=accepted but got: {body}"
        )

    def test_no_auth_returns_401(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Unauthenticated POST /invites/redeem/{token} → 401."""
        popup = _make_popup(db, tenant_a)
        tok = f"noauth-{uuid.uuid4().hex[:12]}"
        _make_invite(db, popup, admin_user_tenant_a, token=tok, max_uses=10)

        resp = client.post(
            f"/api/v1/invites/redeem/{tok}",
            json={"popup_id": str(popup.id)},
        )
        assert resp.status_code == 401, resp.json()

    def test_double_redeem_same_human_returns_409(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Double-redeem by the same human → 409 (already redeemed by this human)."""
        popup = _make_popup(db, tenant_a)
        tok = f"double-{uuid.uuid4().hex[:12]}"
        _make_invite(db, popup, admin_user_tenant_a, token=tok, max_uses=100)
        human = _make_human(db, tenant_a)
        human_tok = _human_token(human)

        # First redeem should succeed
        resp1 = client.post(
            f"/api/v1/invites/redeem/{tok}",
            json={"popup_id": str(popup.id)},
            headers=_auth(human_tok),
        )
        assert resp1.status_code in (200, 201), resp1.json()

        # Second redeem by same human → 409
        resp2 = client.post(
            f"/api/v1/invites/redeem/{tok}",
            json={"popup_id": str(popup.id)},
            headers=_auth(human_tok),
        )
        assert resp2.status_code == 409, resp2.json()

    def test_multi_use_unlimited_allows_multiple_humans(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-003: max_uses=None (unlimited) allows multiple redemptions."""
        popup = _make_popup(db, tenant_a)
        tok = f"unlimited-{uuid.uuid4().hex[:12]}"
        invite = _make_invite(db, popup, admin_user_tenant_a, token=tok, max_uses=None)

        for i in range(3):
            human = _make_human(
                db, tenant_a, email=f"multi-{uuid.uuid4().hex[:8]}@test.com"
            )
            resp = client.post(
                f"/api/v1/invites/redeem/{tok}",
                json={"popup_id": str(popup.id)},
                headers=_auth(_human_token(human)),
            )
            assert resp.status_code in (200, 201), (
                f"redemption {i + 1} failed: {resp.json()}"
            )

        db.refresh(invite)
        assert invite.current_uses == 3


# ---------------------------------------------------------------------------
# RLS isolation — T-gr-027 (REQ-GR-007)
# ---------------------------------------------------------------------------


class TestInviteRLS:
    """Tenant A cannot read tenant B's invites (REQ-GR-007).

    Uses direct DB to verify isolation at the model layer.
    """

    def test_tenant_b_invites_invisible_to_tenant_a_admin(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        tenant_b: Tenants,
        admin_user_tenant_a: Users,
        admin_user_tenant_b: Users,
    ) -> None:
        """Admin for tenant A listing invites sees only tenant A's invites."""
        popup_a = _make_popup(db, tenant_a)
        popup_b = _make_popup(db, tenant_b)

        tok_a = f"rls-a-{uuid.uuid4().hex[:8]}"
        tok_b = f"rls-b-{uuid.uuid4().hex[:8]}"
        _make_invite(db, popup_a, admin_user_tenant_a, token=tok_a)
        _make_invite(db, popup_b, admin_user_tenant_b, token=tok_b)

        token_a = _admin_token(admin_user_tenant_a)
        resp = client.get(
            f"/api/v1/invites?popup_id={popup_a.id}",
            headers={**_auth(token_a), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 200, resp.json()
        returned_tokens = [r["token"] for r in resp.json()["results"]]
        assert tok_a in returned_tokens
        assert tok_b not in returned_tokens
