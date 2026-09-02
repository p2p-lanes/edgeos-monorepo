"""The unified access-link API: one surface for admin and attendee links.

/portal/invites replaces /portal/referrals, /invites/preview/{token} resolves a
link of either kind, and the admin list moderates both. What each test pins is
the part that differs by issuer -- quota, ownership, privacy -- because that is
what a single surface could quietly flatten.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.invite.models import Invites
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token
from tests._flow_helpers import invite_flow_id, provision_default_flow, set_link_policy


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Unified {uuid.uuid4().hex[:6]}",
        slug=f"unified-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        invites_enabled=True,
        referrals_enabled=True,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    # A popup created through the API is provisioned with a default flow, and
    # every invite has to name one.
    provision_default_flow(db, popup)
    db.commit()
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"unified-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Uni",
        last_name="Fied",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _give_ticket(
    db: Session,
    popup: Popups,
    human: Humans,
    *,
    product_category: str = "ticket",
    managed: bool = False,
) -> None:
    """Creating a portal link is gated on actually holding a ticket."""
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name="Ticket",
        slug=f"tkt-{uuid.uuid4().hex[:8]}",
        price=Decimal("0"),
        category=product_category,
    )
    db.add(product)
    db.flush()
    attendee = Attendees(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=None if managed else human.id,
        managed_by_human_id=human.id if managed else None,
        name="Uni Fied",
        email=human.email,
    )
    db.add(attendee)
    db.flush()
    db.add(
        AttendeeProducts(
            tenant_id=popup.tenant_id,
            attendee_id=attendee.id,
            product_id=product.id,
            check_in_code=uuid.uuid4().hex[:8].upper(),
            product_category_snapshot=product_category,
        )
    )
    db.commit()


def _make_admin_invite(db: Session, popup: Popups, creator: Users) -> Invites:
    invite = Invites(
        sales_flow_id=invite_flow_id(db, popup.id),
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


class TestPortalLinkEndpoints:
    def test_attendee_with_a_ticket_creates_and_lists_a_link(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        _give_ticket(db, popup, human)
        headers = _auth(_human_token(human))

        created = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id)},
            headers=headers,
        )
        assert created.status_code in (200, 201), created.json()
        body = created.json()
        assert body["token"]
        assert body["referrer_human_id"] == str(human.id)
        assert body["created_by"] is None, "an attendee link has no admin behind it"
        assert body["express_checkout"] is True
        assert body["auto_approve"] is True

        listed = client.get(
            f"/api/v1/portal/invites?popup_id={popup.id}", headers=headers
        )
        assert listed.status_code == 200, listed.json()
        assert [row["id"] for row in listed.json()["results"]] == [body["id"]]

    def test_attendee_without_a_ticket_cannot_create_one(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Otherwise someone auto-approved through a link spawns their own."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id)},
            headers=_auth(_human_token(human)),
        )

        assert resp.status_code == 403, resp.json()

    def test_portal_link_access_matrix(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        def create_link(popup: Popups, human: Humans):
            return client.post(
                "/api/v1/portal/invites",
                json={"popup_id": str(popup.id)},
                headers=_auth(_human_token(human)),
            )

        accepted_popup = _make_popup(db, tenant_a)
        accepted_human = _make_human(db, tenant_a)
        db.add(
            Applications(
                tenant_id=tenant_a.id,
                popup_id=accepted_popup.id,
                sales_flow_id=invite_flow_id(db, accepted_popup.id),
                human_id=accepted_human.id,
                status=ApplicationStatus.ACCEPTED.value,
            )
        )
        db.commit()
        assert create_link(accepted_popup, accepted_human).status_code == 201

        participant_popup = _make_popup(db, tenant_a)
        participant_human = _make_human(db, tenant_a)
        _give_ticket(
            db,
            participant_popup,
            participant_human,
            product_category="meal_plan",
        )
        assert create_link(participant_popup, participant_human).status_code == 403

        managed_popup = _make_popup(db, tenant_a)
        managed_human = _make_human(db, tenant_a)
        _give_ticket(db, managed_popup, managed_human, managed=True)
        assert create_link(managed_popup, managed_human).status_code == 403

        rejected_popup = _make_popup(db, tenant_a)
        rejected_human = _make_human(db, tenant_a)
        _give_ticket(db, rejected_popup, rejected_human)
        db.add(
            Applications(
                tenant_id=tenant_a.id,
                popup_id=rejected_popup.id,
                sales_flow_id=invite_flow_id(db, rejected_popup.id),
                human_id=rejected_human.id,
                status=ApplicationStatus.REJECTED.value,
            )
        )
        db.commit()
        assert create_link(rejected_popup, rejected_human).status_code == 201

    def test_second_link_for_the_same_popup_is_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        _give_ticket(db, popup, human)
        headers = _auth(_human_token(human))

        first = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id)},
            headers=headers,
        )
        assert first.status_code in (200, 201), first.json()

        second = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id)},
            headers=headers,
        )
        assert second.status_code == 409, second.json()

    def test_popup_quota_overrides_a_requested_max_uses(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """max_referrals_per_attendee is the popup's call, not the attendee's."""
        popup = _make_popup(db, tenant_a)
        set_link_policy(db, popup, max_referrals_per_attendee=3)
        db.add(popup)
        db.commit()
        human = _make_human(db, tenant_a)
        _give_ticket(db, popup, human)

        resp = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id), "max_uses": 999},
            headers=_auth(_human_token(human)),
        )

        assert resp.status_code in (200, 201), resp.json()
        assert resp.json()["max_uses"] == 3

    def test_an_attendee_cannot_touch_someone_elses_link(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        _give_ticket(db, popup, owner)
        stranger = _make_human(db, tenant_a)

        created = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id)},
            headers=_auth(_human_token(owner)),
        )
        link_id = created.json()["id"]

        resp = client.patch(
            f"/api/v1/portal/invites/{link_id}",
            json={"max_uses": 5},
            headers=_auth(_human_token(stranger)),
        )

        assert resp.status_code == 403, resp.json()

    def test_an_admin_invite_is_not_addressable_from_the_portal(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        admin_invite = _make_admin_invite(db, popup, admin_user_tenant_a)

        resp = client.patch(
            f"/api/v1/portal/invites/{admin_invite.id}",
            json={"max_uses": 5},
            headers=_auth(_human_token(human)),
        )

        assert resp.status_code == 404, resp.json()


class TestUnifiedPreview:
    def test_preview_resolves_an_admin_invite_and_names_the_inviter(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        invite = _make_admin_invite(db, popup, admin_user_tenant_a)

        resp = client.get(f"/api/v1/invites/preview/{invite.token}")

        assert resp.status_code == 200, resp.json()
        body = resp.json()
        assert body["id"] == str(invite.id)
        assert body["inviter_name"] is not None
        assert body["auto_approve"] is False

    def test_preview_resolves_an_attendee_link_without_naming_its_owner(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """The link is a public URL and its owner is a private individual."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        _give_ticket(db, popup, human)
        created = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id)},
            headers=_auth(_human_token(human)),
        )
        token = created.json()["token"]

        resp = client.get(f"/api/v1/invites/preview/{token}")

        assert resp.status_code == 200, resp.json()
        body = resp.json()
        assert body["inviter_name"] is None
        assert human.email not in resp.text
        assert str(human.id) not in resp.text

    def test_preview_honours_the_flag_matching_the_issuer(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """An attendee link is gated by referrals_enabled, not invites_enabled."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        _give_ticket(db, popup, human)
        created = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id)},
            headers=_auth(_human_token(human)),
        )
        token = created.json()["token"]

        set_link_policy(db, popup, referrals_enabled=False)
        popup.invites_enabled = True
        db.add(popup)
        db.commit()

        resp = client.get(f"/api/v1/invites/preview/{token}")

        assert resp.status_code == 410, resp.json()

    def test_a_disabled_link_stops_previewing(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """is_disabled arrived with attendee links; it now kills invites too."""
        popup = _make_popup(db, tenant_a)
        invite = _make_admin_invite(db, popup, admin_user_tenant_a)
        invite.is_disabled = True
        db.add(invite)
        db.commit()

        resp = client.get(f"/api/v1/invites/preview/{invite.token}")

        assert resp.status_code == 410, resp.json()


class TestAdminModeratesBothKinds:
    def test_issuer_filter_splits_the_list(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        _give_ticket(db, popup, human)
        client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id)},
            headers=_auth(_human_token(human)),
        )
        admin_invite = _make_admin_invite(db, popup, admin_user_tenant_a)
        headers = _auth(admin_token_tenant_a)

        every = client.get(f"/api/v1/invites?popup_id={popup.id}", headers=headers)
        admin_only = client.get(
            f"/api/v1/invites?popup_id={popup.id}&issuer=admin", headers=headers
        )
        portal_only = client.get(
            f"/api/v1/invites?popup_id={popup.id}&issuer=portal", headers=headers
        )

        assert every.status_code == 200, every.json()
        assert len(every.json()["results"]) == 2
        assert [r["id"] for r in admin_only.json()["results"]] == [str(admin_invite.id)]
        assert [r["referrer_human_id"] for r in portal_only.json()["results"]] == [
            str(human.id)
        ]

    def test_admin_can_disable_an_attendee_link(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """Moderation was the admin-referral surface's whole job."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        _give_ticket(db, popup, human)
        created = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id)},
            headers=_auth(_human_token(human)),
        )
        link_id = created.json()["id"]

        resp = client.patch(
            f"/api/v1/invites/{link_id}",
            json={"is_disabled": True},
            headers=_auth(admin_token_tenant_a),
        )

        assert resp.status_code == 200, resp.json()
        assert resp.json()["is_disabled"] is True
