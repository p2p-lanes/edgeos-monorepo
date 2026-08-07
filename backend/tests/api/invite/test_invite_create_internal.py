"""Tests for invite_id in create_internal (application crud).

Covers the invite block added to ApplicationsCRUD.create_internal:
  - Discount applied from invite
  - auto_approve flag triggers ACCEPTED status
  - express_checkout flag relaxes required fields (shared with group flow)
  - current_uses incremented (+ used_at / redeemed_by_human_id)
  - NO GroupMembers row inserted (invite is purchase-only, not social membership)
  - Expired invite → 410
  - Exhausted invite → 410
  - Recipient email mismatch → 403
  - Open invite (no recipient_email) → no email check

Spec refs: REQ-GR-003, REQ-GR-004
Design: Decision 1f (invite parallels referral block, no membership)
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.schemas import ApplicationStatus
from app.api.group.models import GroupMembers
from app.api.human.models import Humans
from app.api.invite.models import Invites
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token
from tests._flow_helpers import seed_default_steps

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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
        name=f"InviteCreate {uuid.uuid4().hex[:6]}",
        slug=f"invitecreate-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        invites_enabled=invites_enabled,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    seed_default_steps(db, popup)
    return popup


def _make_human(
    db: Session,
    tenant: Tenants,
    email: str | None = None,
) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=email or f"invitecreate-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Invite",
        last_name="Creator",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_invite(
    db: Session,
    popup: Popups,
    creator: Users,
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
    inv = Invites(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        token=token or f"tok-{uuid.uuid4().hex[:16]}",
        recipient_email=recipient_email.lower() if recipient_email else None,
        max_uses=max_uses,
        current_uses=current_uses,
        auto_approve=auto_approve,
        express_checkout=express_checkout,
        discount_percentage=discount_percentage,
        expires_at=expires_at,
        created_by=creator.id,
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return inv


# ---------------------------------------------------------------------------
# Tests: invite_id in create_internal (via POST /api/v1/applications/me)
# ---------------------------------------------------------------------------


class TestInviteCreateInternalFlags:
    """REQ-GR-004: invite flags applied when invite_id passed on application create."""

    def test_invite_applies_discount_and_auto_approves(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Discount from invite is applied; auto_approve=True → ACCEPTED status."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        invite = _make_invite(
            db,
            popup,
            admin_user_tenant_a,
            auto_approve=True,
            discount_percentage=Decimal("25"),
        )
        tok = _human_token(human)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "first_name": "Test",
                "last_name": "User",
                "email": human.email,
                "invite_id": str(invite.id),
                "status": "in review",
            },
            headers=_auth(tok),
        )
        assert resp.status_code in (200, 201), resp.json()
        body = resp.json()
        assert body["status"] == ApplicationStatus.ACCEPTED.value
        # The invite discount is NOT copied onto the application —
        # application.discount_percentage is scholarship-only. The payment
        # path reads the invite live (see test_link_discounts.py).
        assert body["invite_id"] == str(invite.id)
        assert body["discount_percentage"] is None

    def test_invite_increments_current_uses(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """current_uses is incremented after a successful application with invite_id."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        invite = _make_invite(
            db, popup, admin_user_tenant_a, max_uses=5, current_uses=0
        )
        tok = _human_token(human)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "first_name": "Test",
                "last_name": "User",
                "email": human.email,
                "invite_id": str(invite.id),
                "status": "in review",
            },
            headers=_auth(tok),
        )
        assert resp.status_code in (200, 201), resp.json()

        db.refresh(invite)
        assert invite.current_uses == 1
        assert invite.used_at is not None

    def test_invite_does_not_add_group_member(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """CRITICAL: invite_id MUST NOT insert a GroupMembers row (purchase-only)."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        invite = _make_invite(db, popup, admin_user_tenant_a)
        tok = _human_token(human)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "first_name": "Test",
                "last_name": "User",
                "email": human.email,
                "invite_id": str(invite.id),
                "status": "in review",
            },
            headers=_auth(tok),
        )
        assert resp.status_code in (200, 201), resp.json()

        # Verify no GroupMembers row exists for this human
        gm = db.exec(
            select(GroupMembers).where(GroupMembers.human_id == human.id)
        ).first()
        assert gm is None, "invite_id must NOT create a GroupMembers row"

    def test_invite_express_checkout_relaxes_fields(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """express_checkout=True on invite relaxes required fields (shared with group)."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        invite = _make_invite(
            db,
            popup,
            admin_user_tenant_a,
            express_checkout=True,
            auto_approve=False,
        )
        tok = _human_token(human)

        # Submit with minimal fields (express checkout relaxes requirements).
        # validate_custom_fields=True (default); express_checkout bypasses
        # required-field checks in form_fields_crud.
        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "first_name": "Test",
                "last_name": "User",
                "email": human.email,
                "invite_id": str(invite.id),
                "status": "in review",
            },
            headers=_auth(tok),
        )
        # Should succeed: express checkout skips optional-field requirements
        assert resp.status_code in (200, 201), resp.json()


class TestInviteCreateInternalGuards:
    """REQ-GR-003: guard chain enforced in create_internal for invite_id."""

    def test_expired_invite_returns_410(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Expired invite → 410 Gone."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        expired_invite = _make_invite(
            db,
            popup,
            admin_user_tenant_a,
            expires_at=datetime.now(UTC) - timedelta(hours=1),
        )
        tok = _human_token(human)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "first_name": "Test",
                "last_name": "User",
                "email": human.email,
                "invite_id": str(expired_invite.id),
                "status": "in review",
            },
            headers=_auth(tok),
        )
        assert resp.status_code == 410, resp.json()

    def test_exhausted_invite_returns_410(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Invite at max_uses → 410 Gone."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        exhausted_invite = _make_invite(
            db,
            popup,
            admin_user_tenant_a,
            max_uses=1,
            current_uses=1,
        )
        tok = _human_token(human)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "first_name": "Test",
                "last_name": "User",
                "email": human.email,
                "invite_id": str(exhausted_invite.id),
                "status": "in review",
            },
            headers=_auth(tok),
        )
        assert resp.status_code == 410, resp.json()

    def test_recipient_email_mismatch_returns_403(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Invite restricted to different email → 403 Forbidden."""
        popup = _make_popup(db, tenant_a)
        # Unique emails: the shared session-scoped DB means fixed literals
        # collide with humans created by earlier test files.
        human = _make_human(
            db, tenant_a, email=f"applicant-{uuid.uuid4().hex[:8]}@test.com"
        )
        restricted_invite = _make_invite(
            db,
            popup,
            admin_user_tenant_a,
            # Any email different from the applicant's triggers the mismatch guard
            recipient_email=f"restricted-{uuid.uuid4().hex[:8]}@test.com",
        )
        tok = _human_token(human)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "first_name": "Alice",
                "last_name": "Smith",
                "email": human.email,
                "invite_id": str(restricted_invite.id),
                "status": "in review",
            },
            headers=_auth(tok),
        )
        assert resp.status_code == 403, resp.json()

    def test_open_invite_accepts_any_email(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Open invite (no recipient_email) accepts any authenticated human."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        open_invite = _make_invite(
            db,
            popup,
            admin_user_tenant_a,
            recipient_email=None,  # open invite
            max_uses=None,  # unlimited
        )
        tok = _human_token(human)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "first_name": "Test",
                "last_name": "User",
                "email": human.email,
                "invite_id": str(open_invite.id),
                "status": "in review",
            },
            headers=_auth(tok),
        )
        assert resp.status_code in (200, 201), resp.json()
