"""Attendee links into another popup of the same tenant.

An attendee allowed to share popup A (access there, and A's way in lets
attendees share) may create a link into popup B without being in B, when B's
default flow accepts links from other popups. B's flow sets the use limit.
A red-flagged attendee can create no link at all, and a link stops working
while its owner is red-flagged.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.human.models import Humans
from app.api.invite.models import Invites
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.api.shared.enums import HumanRating
from app.api.tenant.models import Tenants
from tests._flow_helpers import set_link_policy
from tests.api.link.test_portal_links import (
    _auth,
    _give_ticket,
    _human_token,
    _make_human,
    _make_popup,
)

LINKS = "/api/v1/portal/invites"
TARGETS = "/api/v1/portal/invites/cross-popup-targets"


def _source(db: Session, tenant: Tenants, human: Humans) -> Popups:
    """A popup the human holds a ticket for, whose way in lets them share."""
    popup = _make_popup(db, tenant)
    set_link_policy(db, popup, referrals_enabled=True)
    _give_ticket(db, popup, human)
    return popup


def _target(
    db: Session,
    tenant: Tenants,
    *,
    accepts: bool = True,
    max_uses: int | None = 3,
    status: PopupStatus = PopupStatus.active,
) -> Popups:
    """A popup the human is not in. Its own attendees may not share it, so
    only the cross-popup switch can let a link in."""
    popup = _make_popup(db, tenant, referrals_enabled=False, status=status)
    set_link_policy(
        db,
        popup,
        referrals_enabled=False,
        cross_popup_referrals_enabled=accepts,
        max_referrals_per_attendee=max_uses,
    )
    return popup


def _flag(db: Session, human: Humans) -> None:
    human.rating = HumanRating.RED_FLAG
    db.add(human)
    db.commit()


def _share(
    client: TestClient, human: Humans, target: Popups, source: Popups
) -> tuple[int, dict]:
    resp = client.post(
        LINKS,
        json={"popup_id": str(target.id), "source_popup_id": str(source.id)},
        headers=_auth(_human_token(human)),
    )
    return resp.status_code, resp.json()


def _apply(client: TestClient, human: Humans, popup: Popups, link_id: str):
    return client.post(
        "/api/v1/applications/my",
        json={
            "popup_id": str(popup.id),
            "first_name": human.first_name,
            "last_name": human.last_name,
            "email": human.email,
            "referral_id": link_id,
        },
        headers=_auth(_human_token(human)),
    )


class TestCreatingACrossPopupLink:
    def test_an_attendee_shares_a_popup_they_are_not_in(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        human = _make_human(db, tenant_a)
        source = _source(db, tenant_a, human)
        target = _target(db, tenant_a, max_uses=3)

        code, body = _share(client, human, target, source)

        assert code == 201, body
        assert body["popup_id"] == str(target.id)
        assert body["source_popup_id"] == str(source.id)
        assert body["referrer_human_id"] == str(human.id)
        # The popup receiving the people sets the rate, not the source.
        assert body["max_uses"] == 3
        target_flow = set_link_policy(db, target)
        assert body["sales_flow_id"] == str(target_flow.id)

    def test_a_popup_that_does_not_accept_them_refuses(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        human = _make_human(db, tenant_a)
        source = _source(db, tenant_a, human)
        target = _target(db, tenant_a, accepts=False)

        code, body = _share(client, human, target, source)
        assert code == 403, body

    def test_a_popup_that_is_not_active_refuses(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        human = _make_human(db, tenant_a)
        source = _source(db, tenant_a, human)
        target = _target(db, tenant_a, status=PopupStatus.ended)

        code, body = _share(client, human, target, source)
        assert code == 403, body

    def test_without_access_to_the_source_popup(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        human = _make_human(db, tenant_a)
        source = _make_popup(db, tenant_a)  # no ticket
        set_link_policy(db, source, referrals_enabled=True)
        target = _target(db, tenant_a)

        code, body = _share(client, human, target, source)
        assert code == 403, body

    def test_when_the_source_popup_does_not_let_attendees_share(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        human = _make_human(db, tenant_a)
        source = _source(db, tenant_a, human)
        set_link_policy(db, source, referrals_enabled=False)
        target = _target(db, tenant_a)

        code, body = _share(client, human, target, source)
        assert code == 403, body

    def test_a_popup_of_another_tenant_reads_as_not_found(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        tenant_b: Tenants,
    ) -> None:
        human = _make_human(db, tenant_a)
        source = _source(db, tenant_a, human)
        foreign = _target(db, tenant_b)

        code, body = _share(client, human, foreign, source)
        assert code == 404, body
        stray = db.exec(select(Invites).where(Invites.popup_id == foreign.id)).first()
        assert stray is None

    def test_one_link_per_attendee_per_popup(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        human = _make_human(db, tenant_a)
        source = _source(db, tenant_a, human)
        target = _target(db, tenant_a)

        assert _share(client, human, target, source)[0] == 201
        code, body = _share(client, human, target, source)
        assert code == 409, body


class TestRedFlag:
    def test_a_red_flagged_attendee_cannot_share_another_popup(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        human = _make_human(db, tenant_a)
        source = _source(db, tenant_a, human)
        target = _target(db, tenant_a)
        _flag(db, human)

        code, body = _share(client, human, target, source)
        assert code == 403, body

    def test_a_red_flagged_attendee_cannot_share_their_own_popup(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        human = _make_human(db, tenant_a)
        source = _source(db, tenant_a, human)
        _flag(db, human)

        resp = client.post(
            LINKS,
            json={"popup_id": str(source.id)},
            headers=_auth(_human_token(human)),
        )
        assert resp.status_code == 403, resp.json()

    def test_a_link_stops_working_while_its_owner_is_flagged(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        referrer = _make_human(db, tenant_a)
        source = _source(db, tenant_a, referrer)
        target = _target(db, tenant_a)
        _, link = _share(client, referrer, target, source)
        _flag(db, referrer)

        preview = client.get(f"/api/v1/invites/preview/{link['token']}")
        assert preview.status_code == 410, preview.json()

        applicant = _make_human(db, tenant_a)
        resp = _apply(client, applicant, target, link["id"])
        assert resp.status_code == 410, resp.json()

        referrer.rating = HumanRating.UNRATED
        db.add(referrer)
        db.commit()
        preview = client.get(f"/api/v1/invites/preview/{link['token']}")
        assert preview.status_code == 200, preview.json()


class TestRedeemingACrossPopupLink:
    def test_the_recipient_is_accepted_into_the_target_popup(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        referrer = _make_human(db, tenant_a)
        source = _source(db, tenant_a, referrer)
        target = _target(db, tenant_a)
        _, link = _share(client, referrer, target, source)

        preview = client.get(f"/api/v1/invites/preview/{link['token']}")
        assert preview.status_code == 200, preview.json()
        assert preview.json()["popup_id"] == str(target.id)

        applicant = _make_human(db, tenant_a)
        resp = _apply(client, applicant, target, link["id"])
        assert resp.status_code in (200, 201), resp.json()

        application = db.get(Applications, uuid.UUID(resp.json()["id"]))
        assert application is not None
        assert application.referral_id == uuid.UUID(link["id"])
        assert application.status == ApplicationStatus.ACCEPTED.value

    def test_it_stops_when_the_target_stops_accepting_them(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        referrer = _make_human(db, tenant_a)
        source = _source(db, tenant_a, referrer)
        target = _target(db, tenant_a)
        _, link = _share(client, referrer, target, source)
        set_link_policy(db, target, cross_popup_referrals_enabled=False)

        preview = client.get(f"/api/v1/invites/preview/{link['token']}")
        assert preview.status_code == 410, preview.json()

        applicant = _make_human(db, tenant_a)
        resp = _apply(client, applicant, target, link["id"])
        assert resp.status_code == 403, resp.json()

    def test_a_referral_cannot_be_used_on_a_popup_it_does_not_point_to(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Referrals auto-accept, so one aimed at another popup would skip
        this popup's own gate."""
        referrer = _make_human(db, tenant_a)
        source = _source(db, tenant_a, referrer)
        target = _target(db, tenant_a)
        _, link = _share(client, referrer, target, source)

        elsewhere = _make_popup(db, tenant_a)
        set_link_policy(
            db, elsewhere, referrals_enabled=True, cross_popup_referrals_enabled=True
        )
        applicant = _make_human(db, tenant_a)
        resp = _apply(client, applicant, elsewhere, link["id"])
        assert resp.status_code == 404, resp.json()


class TestTargets:
    def test_lists_the_popups_that_accept_links_with_any_existing_link(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        human = _make_human(db, tenant_a)
        source = _source(db, tenant_a, human)
        accepting = _target(db, tenant_a)
        refusing = _target(db, tenant_a, accepts=False)
        headers = _auth(_human_token(human))

        resp = client.get(
            TARGETS, params={"source_popup_id": str(source.id)}, headers=headers
        )
        assert resp.status_code == 200, resp.json()
        by_id = {t["popup_id"]: t for t in resp.json()}
        assert str(accepting.id) in by_id
        assert str(refusing.id) not in by_id
        assert str(source.id) not in by_id
        assert by_id[str(accepting.id)]["link"] is None

        _, link = _share(client, human, accepting, source)
        resp = client.get(
            TARGETS, params={"source_popup_id": str(source.id)}, headers=headers
        )
        by_id = {t["popup_id"]: t for t in resp.json()}
        assert by_id[str(accepting.id)]["link"]["id"] == link["id"]

    def test_empty_for_someone_who_may_not_share_from_the_source(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        human = _make_human(db, tenant_a)
        source = _make_popup(db, tenant_a)  # no ticket
        set_link_policy(db, source, referrals_enabled=True)
        _target(db, tenant_a)

        resp = client.get(
            TARGETS,
            params={"source_popup_id": str(source.id)},
            headers=_auth(_human_token(human)),
        )
        assert resp.status_code == 200, resp.json()
        assert resp.json() == []

    def test_empty_for_a_red_flagged_attendee(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        human = _make_human(db, tenant_a)
        source = _source(db, tenant_a, human)
        _target(db, tenant_a)
        _flag(db, human)

        resp = client.get(
            TARGETS,
            params={"source_popup_id": str(source.id)},
            headers=_auth(_human_token(human)),
        )
        assert resp.status_code == 200, resp.json()
        assert resp.json() == []
