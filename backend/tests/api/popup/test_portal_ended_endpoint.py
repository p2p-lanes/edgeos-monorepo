"""HTTP integration tests for the portal popup routes' ended-popup visibility.

TDD phase: RED — before the router changes, ended popups are invisible to
everyone (list) and 404 for everyone (slug lookup). After wiring
``list_portal_popups``/``get_portal_popup`` to the same access ladder used by
recap-stats and the CAP-A access endpoint, participants must see/access ended
popups while non-participants must not.
"""

import uuid
from datetime import datetime

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(
    db: Session, tenant: Tenants, *, suffix: str, status: str = "ended"
) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Portal Ended HTTP Popup {suffix}",
        slug=f"http-ended-{suffix}-{uuid.uuid4().hex[:6]}",
        sale_type="application",
        status=status,
        currency="USD",
        # Far-future start_date so this popup sorts to the top of its status
        # group (list_portal_popups orders start_date DESC NULLS LAST and caps
        # at limit=100). The session-scoped test DB accumulates >100 active
        # popups across the full suite; without a start_date this popup would
        # sort last (NULLS LAST) and fall outside the top-100 window in CI.
        start_date=datetime(2999, 1, 1),
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"http-ended-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    status: str,
) -> Applications:
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=status,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _auth(human: Humans) -> dict[str, str]:
    return {"Authorization": f"Bearer {_human_token(human)}"}


def _list_url() -> str:
    return "/api/v1/popups/portal/list"


def _slug_url(slug: str) -> str:
    return f"/api/v1/popups/portal/{slug}"


# ---------------------------------------------------------------------------
# Tests: GET /popups/portal/list
# ---------------------------------------------------------------------------


class TestListPortalPopupsHttp:
    def test_participant_sees_ended_popup_in_list(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        ended = _make_popup(db, tenant_a, suffix="list-participant")
        human = _make_human(db, tenant_a, suffix="list-participant")
        _make_application(
            db, tenant_a, ended, human, status=ApplicationStatus.ACCEPTED.value
        )

        response = client.get(_list_url(), headers=_auth(human))

        assert response.status_code == 200
        ids = {p["id"] for p in response.json()}
        assert str(ended.id) in ids

    def test_non_participant_does_not_see_ended_popup_in_list(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        ended = _make_popup(db, tenant_a, suffix="list-non-participant")
        human = _make_human(db, tenant_a, suffix="list-non-participant")
        # no application

        response = client.get(_list_url(), headers=_auth(human))

        assert response.status_code == 200
        ids = {p["id"] for p in response.json()}
        assert str(ended.id) not in ids

    def test_both_participant_and_non_participant_see_active_popups(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        active = _make_popup(db, tenant_a, suffix="list-active", status="active")
        participant = _make_human(db, tenant_a, suffix="list-active-participant")
        non_participant = _make_human(
            db, tenant_a, suffix="list-active-non-participant"
        )

        participant_response = client.get(_list_url(), headers=_auth(participant))
        non_participant_response = client.get(
            _list_url(), headers=_auth(non_participant)
        )

        assert participant_response.status_code == 200
        assert non_participant_response.status_code == 200
        assert str(active.id) in {p["id"] for p in participant_response.json()}
        assert str(active.id) in {p["id"] for p in non_participant_response.json()}


# ---------------------------------------------------------------------------
# Tests: GET /popups/portal/{slug}
# ---------------------------------------------------------------------------


class TestGetPortalPopupHttp:
    def test_participant_can_fetch_ended_popup_by_slug(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        ended = _make_popup(db, tenant_a, suffix="slug-participant")
        human = _make_human(db, tenant_a, suffix="slug-participant")
        _make_application(
            db, tenant_a, ended, human, status=ApplicationStatus.ACCEPTED.value
        )

        response = client.get(_slug_url(ended.slug), headers=_auth(human))

        assert response.status_code == 200
        assert response.json()["id"] == str(ended.id)

    def test_non_participant_gets_404_for_ended_popup_by_slug(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        ended = _make_popup(db, tenant_a, suffix="slug-non-participant")
        human = _make_human(db, tenant_a, suffix="slug-non-participant")
        # no application

        response = client.get(_slug_url(ended.slug), headers=_auth(human))

        assert response.status_code == 404
