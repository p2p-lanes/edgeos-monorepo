"""HTTP integration tests for GET /popups/{popup_id}/recap-stats.

Task 2 gap fill: the recap-stats endpoint's participation gating (via
``applications_crud.resolve_popup_access``) was only exercised at the CRUD
level (see test_recap_stats.py) and never through the actual HTTP route.
These tests drive the full stack (auth, RLS-scoped tenant session,
routing, response serialization) the same way test_http_popup_access.py
does for the sibling /portal/popup/{popup_id}/access endpoint.
"""

import uuid

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


def _make_popup(db: Session, tenant: Tenants, *, suffix: str) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Recap Stats HTTP Popup {suffix}",
        slug=f"http-recap-{suffix}-{uuid.uuid4().hex[:6]}",
        sale_type="application",
        status="ended",
        currency="USD",
        show_attendee_directory=True,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"http-recap-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
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


def _recap_stats_url(popup_id: uuid.UUID) -> str:
    return f"/api/v1/popups/{popup_id}/recap-stats"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGetPopupRecapStatsHttp:
    """HTTP integration tests for GET /popups/{popup_id}/recap-stats."""

    def test_participant_returns_stats(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Human with an accepted application (a participant) gets 200 + stats body."""
        popup = _make_popup(db, tenant_a, suffix="participant")
        human = _make_human(db, tenant_a, suffix="participant")
        _make_application(
            db, tenant_a, popup, human, status=ApplicationStatus.ACCEPTED.value
        )

        response = client.get(_recap_stats_url(popup.id), headers=_auth(human))

        assert response.status_code == 200
        body = response.json()
        assert set(body.keys()) == {"events_count", "attendees_count", "days"}
        assert isinstance(body["events_count"], int)
        assert isinstance(body["attendees_count"], int)
        assert isinstance(body["days"], int)

    def test_non_participant_returns_404(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Human with no application/attendee/payment tie to the popup gets 404."""
        popup = _make_popup(db, tenant_a, suffix="non-participant")
        human = _make_human(db, tenant_a, suffix="non-participant")

        response = client.get(_recap_stats_url(popup.id), headers=_auth(human))

        assert response.status_code == 404

    def test_missing_popup_returns_404(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """A random, non-existent popup_id also 404s."""
        human = _make_human(db, tenant_a, suffix="missing-popup")

        response = client.get(_recap_stats_url(uuid.uuid4()), headers=_auth(human))

        assert response.status_code == 404
