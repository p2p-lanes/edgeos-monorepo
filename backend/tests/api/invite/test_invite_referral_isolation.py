"""Admin invites and portal links share one table but not one surface.

Referrals were merged into `invites` (migration a3f8c1d94e27). Both kinds of
link now live in the same rows, told apart by referrer_human_id. Until the API
is unified too, each surface must show only its own: a portal link leaking into
the admin invite list would 500 on serialization, because it carries no
created_by and InvitePublic requires one.
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
    def test_admin_invite_list_excludes_portal_links(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
        admin_token_tenant_a: str,
    ) -> None:
        """A portal link in the same popup must not appear as an invite.

        It has no created_by, so serializing it through InvitePublic would 500
        rather than merely showing the wrong row.
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
        returned = {row["id"] for row in resp.json()["results"]}
        assert str(admin_invite.id) in returned
        assert str(portal_link.id) not in returned

    def test_portal_link_is_not_reachable_through_the_invite_detail_route(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        referrer = _make_human(db, tenant_a)
        portal_link = _make_portal_link(db, popup, referrer)

        resp = client.get(
            f"/api/v1/invites/{portal_link.id}",
            headers=_auth(admin_token_tenant_a),
        )

        assert resp.status_code == 404, resp.json()

    def test_admin_invite_is_not_reachable_through_the_referral_route(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
        admin_token_tenant_a: str,
    ) -> None:
        """The mirror case: an admin invite must not be editable as a referral."""
        popup = _make_popup(db, tenant_a)
        admin_invite = _make_admin_invite(db, popup, admin_user_tenant_a)

        resp = client.get(
            f"/api/v1/admin/referrals/{admin_invite.id}",
            headers=_auth(admin_token_tenant_a),
        )

        assert resp.status_code == 404, resp.json()

    def test_admin_invite_token_does_not_resolve_as_a_public_referral_code(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Admin invites keep their own redeem URL; /r/{code} is portal-only."""
        popup = _make_popup(db, tenant_a)
        admin_invite = _make_admin_invite(db, popup, admin_user_tenant_a)

        resp = client.get(f"/api/v1/referrals/r/{admin_invite.token}")

        assert resp.status_code == 404, resp.json()

    def test_portal_link_code_does_not_resolve_as_an_invite_token(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        referrer = _make_human(db, tenant_a)
        portal_link = _make_portal_link(db, popup, referrer)

        resp = client.get(f"/api/v1/invites/redeem/{portal_link.token}")

        assert resp.status_code == 404, resp.json()
