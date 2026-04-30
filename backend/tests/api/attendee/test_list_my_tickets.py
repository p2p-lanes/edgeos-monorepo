"""Tests for GET /applications/my/tickets — CAP-F bugfix.

TDD phase: RED — tests written BEFORE the fix.
The current endpoint does `attendee.application.popup` which raises AttributeError
when `attendee.application_id` is NULL (direct-sale attendees). These tests must
FAIL against the current code and PASS after the fix.

Fix required:
- Add `selectinload(Attendees.popup)` to `find_by_human` in attendee CRUD.
- Change `attendee.application.popup` → `attendee.popup` in `list_my_tickets`.

Scenarios covered:
1. Application-linked attendees still work (regression guard)
2. Direct-sale attendee (application_id=NULL) does not crash the endpoint
3. Mixed: both application-linked AND direct-sale attendees in the same response
4. Human with no attendees returns empty list (no error)
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"tickets-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Ticket",
        last_name="Human",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_popup(db: Session, tenant: Tenants, *, suffix: str) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Tickets Popup {suffix}",
        slug=f"tickets-popup-{suffix}-{uuid.uuid4().hex[:6]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_app_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    name: str = "App Attendee",
) -> tuple[Applications, Attendees]:
    """Create an application + linked main attendee."""
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.commit()
    db.refresh(application)

    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        human_id=human.id,
        name=name,
        category="main",
        check_in_code=f"T{uuid.uuid4().hex[:5].upper()}",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return application, attendee


def _make_direct_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    name: str = "Direct Attendee",
) -> Attendees:
    """Create a direct-sale attendee (application_id=NULL)."""
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=None,
        popup_id=popup.id,
        human_id=human.id,
        name=name,
        category="main",
        check_in_code=f"D{uuid.uuid4().hex[:5].upper()}",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _auth(human: Humans) -> dict[str, str]:
    return {"Authorization": f"Bearer {_human_token(human)}"}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestListMyTickets:
    """Integration tests for GET /applications/my/tickets — CAP-F."""

    def test_application_linked_attendee_returned(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Regression guard: application-linked attendees still appear correctly."""
        popup = _make_popup(db, tenant_a, suffix="app-linked")
        human = _make_human(db, tenant_a, suffix="app-linked")
        _, attendee = _make_app_attendee(db, tenant_a, popup, human)

        response = client.get(
            "/api/v1/applications/my/tickets",
            headers=_auth(human),
        )

        assert response.status_code == 200, (
            f"Expected 200 for application-linked attendee, got {response.status_code}: {response.text}"
        )
        data = response.json()
        assert isinstance(data, list)
        ids = [item["id"] for item in data]
        assert str(attendee.id) in ids, (
            f"Application-linked attendee {attendee.id} not in response: {ids}"
        )

    def test_direct_sale_attendee_does_not_crash(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """THE REGRESSION: endpoint must NOT crash for direct-sale attendee (application_id=NULL).

        Current code does `attendee.application.popup` which raises AttributeError
        because `attendee.application` is None for direct-sale attendees.
        This test FAILS against the current code (returns 500) and PASSES after the fix.
        """
        popup = _make_popup(db, tenant_a, suffix="direct-crash")
        human = _make_human(db, tenant_a, suffix="direct-crash")
        direct_attendee = _make_direct_attendee(db, tenant_a, popup, human)

        response = client.get(
            "/api/v1/applications/my/tickets",
            headers=_auth(human),
        )

        assert response.status_code == 200, (
            f"Endpoint crashed for direct-sale attendee (application_id=NULL). "
            f"Got {response.status_code}: {response.text}. "
            f"Fix: use attendee.popup instead of attendee.application.popup."
        )
        data = response.json()
        assert isinstance(data, list)
        ids = [item["id"] for item in data]
        assert str(direct_attendee.id) in ids, (
            f"Direct-sale attendee {direct_attendee.id} should appear in ticket list"
        )

    def test_mixed_attendees_returned_without_crash(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Both application-linked AND direct-sale attendees returned in the same call."""
        popup_app = _make_popup(db, tenant_a, suffix="mixed-app")
        popup_direct = _make_popup(db, tenant_a, suffix="mixed-direct")
        human = _make_human(db, tenant_a, suffix="mixed")

        _, app_attendee = _make_app_attendee(
            db, tenant_a, popup_app, human, name="App Side"
        )
        direct_attendee = _make_direct_attendee(
            db, tenant_a, popup_direct, human, name="Direct Side"
        )

        response = client.get(
            "/api/v1/applications/my/tickets",
            headers=_auth(human),
        )

        assert response.status_code == 200, (
            f"Mixed-attendee call crashed. Got {response.status_code}: {response.text}"
        )
        data = response.json()
        ids = [item["id"] for item in data]
        assert str(app_attendee.id) in ids, "Application-linked attendee missing"
        assert str(direct_attendee.id) in ids, "Direct-sale attendee missing"

    def test_no_attendees_returns_empty_list(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Human with no attendees returns empty list without error."""
        human = _make_human(db, tenant_a, suffix="empty")

        response = client.get(
            "/api/v1/applications/my/tickets",
            headers=_auth(human),
        )

        assert response.status_code == 200, response.text
        assert response.json() == []
