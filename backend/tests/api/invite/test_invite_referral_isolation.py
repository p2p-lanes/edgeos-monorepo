"""What stays separate now that admin invites and portal links share a table.

Referrals were merged into `invites` (migration a3f8c1d94e27) and the API was
unified on top of it, so an admin now moderates BOTH kinds from one surface.
What must not blur is everything else: an attendee reaches only their own
links, and the two public URL shapes keep their own meaning -- /r/{code} is for
attendee links, /invites/redeem/{token} for admin ones.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.invite.models import Invites
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.user.models import Users


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Isolation {uuid.uuid4().hex[:6]}",
        slug=f"isolation-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        invites_enabled=True,
        referrals_enabled=True,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"isolation-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Iso",
        last_name="Lation",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_portal_link(db: Session, popup: Popups, referrer: Humans) -> Invites:
    link = Invites(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        referrer_human_id=referrer.id,
        token=f"ref-{uuid.uuid4().hex[:12]}",
        express_checkout=True,
        auto_approve=True,
        discount_percentage=Decimal("0"),
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


def _make_admin_invite(db: Session, popup: Popups, creator: Users) -> Invites:
    invite = Invites(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        token=f"tok-{uuid.uuid4().hex[:16]}",
        created_by=creator.id,
        discount_percentage=Decimal("0"),
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite


class TestInviteReferralIsolation:
    def test_a_portal_link_serializes_without_a_created_by(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
        admin_token_tenant_a: str,
    ) -> None:
        """Both kinds list together, and the issuer-less one must not 500.

        InvitePublic.created_by used to be required, so the first portal link to
        reach this list would have broken the whole response rather than one row.
        """
        popup = _make_popup(db, tenant_a)
        referrer = _make_human(db, tenant_a)
        portal_link = _make_portal_link(db, popup, referrer)
        admin_invite = _make_admin_invite(db, popup, admin_user_tenant_a)

        resp = client.get(
            f"/api/v1/invites?popup_id={popup.id}",
            headers=_auth(admin_token_tenant_a),
        )

        assert resp.status_code == 200, resp.json()
        rows = {row["id"]: row for row in resp.json()["results"]}
        assert str(admin_invite.id) in rows
        assert rows[str(portal_link.id)]["created_by"] is None
        assert rows[str(portal_link.id)]["referrer_human_id"] == str(referrer.id)

    def test_admin_can_reach_a_portal_link_by_id(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """Moderating attendee links is what the admin-referral surface did."""
        popup = _make_popup(db, tenant_a)
        referrer = _make_human(db, tenant_a)
        portal_link = _make_portal_link(db, popup, referrer)

        resp = client.get(
            f"/api/v1/invites/{portal_link.id}",
            headers=_auth(admin_token_tenant_a),
        )

        assert resp.status_code == 200, resp.json()
        assert resp.json()["id"] == str(portal_link.id)

    def test_an_attendee_link_is_not_addressable_as_an_admin_invite(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """The invite-only routes still exclude attendee links.

        Redemption applies the invite's email binding and single-use bookkeeping,
        neither of which an attendee link has.
        """
        popup = _make_popup(db, tenant_a)
        referrer = _make_human(db, tenant_a)
        portal_link = _make_portal_link(db, popup, referrer)

        resp = client.get(f"/api/v1/invites/redeem/{portal_link.token}")

        assert resp.status_code == 404, resp.json()

    def test_the_unified_preview_resolves_both_kinds(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """One public preview, whoever issued the link.

        Guards against re-splitting the surface: /r/{code} in the portal now
        calls this for links that used to have their own endpoint.
        """
        popup = _make_popup(db, tenant_a)
        referrer = _make_human(db, tenant_a)
        portal_link = _make_portal_link(db, popup, referrer)
        admin_invite = _make_admin_invite(db, popup, admin_user_tenant_a)

        from_portal = client.get(f"/api/v1/invites/preview/{portal_link.token}")
        from_admin = client.get(f"/api/v1/invites/preview/{admin_invite.token}")

        assert from_portal.status_code == 200, from_portal.json()
        assert from_admin.status_code == 200, from_admin.json()
        assert from_portal.json()["id"] == str(portal_link.id)
        assert from_admin.json()["id"] == str(admin_invite.id)

    def test_the_referral_routes_are_gone(self, client: TestClient) -> None:
        """No leftover surface still speaking the old vocabulary."""
        for path in (
            "/api/v1/portal/referrals",
            "/api/v1/admin/referrals",
            "/api/v1/referrals/r/some-code",
        ):
            assert client.get(path).status_code == 404, path
