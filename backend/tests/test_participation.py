"""Tests for companion participation endpoint and POST guard.

Covers:
- CRUD: find_companion_for_popup (companion found, self-exclusion, no participation)
- Integration: GET /applications/my/participation/{popup_id} (applicant, companion, none, cross-popup)
- Integration: POST /applications/my guard (409 for companions, normal creation preserved)
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.crud import attendees_crud
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(db: Session, tenant: Tenants, *, slug_suffix: str) -> Popups:
    """Create a fresh popup for isolated test scenarios."""
    popup = Popups(
        name=f"Participation Test {slug_suffix}",
        slug=f"participation-test-{slug_suffix}-{uuid.uuid4().hex[:6]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants, *, email: str) -> Humans:
    """Create a human for testing."""
    human = Humans(
        tenant_id=tenant.id,
        email=email,
        first_name="Test",
        last_name="Human",
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
    status: str = ApplicationStatus.ACCEPTED.value,
) -> Applications:
    """Create an application for a human in a popup."""
    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=status,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def _make_attendee(
    db: Session,
    tenant: Tenants,
    application: Applications,
    *,
    name: str = "Companion",
    category: str = "spouse",
    human_id: uuid.UUID | None = None,
    email: str | None = None,
) -> Attendees:
    """Create an attendee on an application."""
    attendee = Attendees(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=application.popup_id,
        name=name,
        category=category,
        check_in_code=f"P{uuid.uuid4().hex[:5].upper()}",
        human_id=human_id,
        email=email,
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


# ---------------------------------------------------------------------------
# 6.1 — CRUD unit tests: find_companion_for_popup
# ---------------------------------------------------------------------------


class TestFindCompanionForPopup:
    """Unit tests for AttendeesCRUD.find_companion_for_popup."""

    def test_human_is_companion_returns_attendee(self, db: Session) -> None:
        """Human who is a companion on someone else's application → returns Attendee."""
        tenant_id = uuid.uuid4()
        tenant = Tenants(
            id=tenant_id,
            name="CRUD Test Tenant",
            slug=f"crud-test-{uuid.uuid4().hex[:8]}",
        )
        db.add(tenant)
        db.flush()

        popup = Popups(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            name="CRUD Popup",
            slug=f"crud-popup-{uuid.uuid4().hex[:8]}",
        )
        db.add(popup)
        db.flush()

        # Main applicant
        main_human = Humans(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            email="main-crud@test.com",
        )
        db.add(main_human)
        db.flush()

        # Companion human
        companion_human = Humans(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            email="companion-crud@test.com",
        )
        db.add(companion_human)
        db.flush()

        # Application by main human
        application = Applications(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            popup_id=popup.id,
            human_id=main_human.id,
            status=ApplicationStatus.ACCEPTED.value,
        )
        db.add(application)
        db.flush()

        # Attendee linked to companion human on main's application
        attendee = Attendees(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            application_id=application.id,
            popup_id=popup.id,
            name="Companion Spouse",
            category="spouse",
            check_in_code=f"C{uuid.uuid4().hex[:5].upper()}",
            human_id=companion_human.id,
            email="companion-crud@test.com",
        )
        db.add(attendee)
        db.flush()

        result = attendees_crud.find_companion_for_popup(
            db, human_id=companion_human.id, popup_id=popup.id
        )

        assert result is not None
        assert result.id == attendee.id
        assert result.human_id == companion_human.id
        db.rollback()

    def test_main_applicant_not_classified_as_companion(self, db: Session) -> None:
        """Human who is ONLY a main applicant (has own attendees) → returns None.

        The self-exclusion filter (Applications.human_id != human_id) must prevent
        the main applicant from being returned as a companion of their own application.
        """
        tenant_id = uuid.uuid4()
        tenant = Tenants(
            id=tenant_id,
            name="Self-Exclusion Test",
            slug=f"self-excl-{uuid.uuid4().hex[:8]}",
        )
        db.add(tenant)
        db.flush()

        popup = Popups(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            name="Self-Exclusion Popup",
            slug=f"self-excl-popup-{uuid.uuid4().hex[:8]}",
        )
        db.add(popup)
        db.flush()

        human = Humans(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            email="self-applicant@test.com",
        )
        db.add(human)
        db.flush()

        # Application owned by this human
        application = Applications(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            popup_id=popup.id,
            human_id=human.id,
            status=ApplicationStatus.ACCEPTED.value,
        )
        db.add(application)
        db.flush()

        # Main attendee linked to same human (they are the applicant)
        attendee = Attendees(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            application_id=application.id,
            popup_id=popup.id,
            name="Self",
            category="main",
            check_in_code=f"S{uuid.uuid4().hex[:5].upper()}",
            human_id=human.id,
        )
        db.add(attendee)
        db.flush()

        result = attendees_crud.find_companion_for_popup(
            db, human_id=human.id, popup_id=popup.id
        )

        assert result is None
        db.rollback()

    def test_no_participation_returns_none(self, db: Session) -> None:
        """Human with no participation in the popup → returns None."""
        tenant_id = uuid.uuid4()
        tenant = Tenants(
            id=tenant_id,
            name="No Participation Test",
            slug=f"no-part-{uuid.uuid4().hex[:8]}",
        )
        db.add(tenant)
        db.flush()

        popup = Popups(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            name="No Participation Popup",
            slug=f"no-part-popup-{uuid.uuid4().hex[:8]}",
        )
        db.add(popup)
        db.flush()

        human = Humans(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            email="no-part@test.com",
        )
        db.add(human)
        db.flush()

        result = attendees_crud.find_companion_for_popup(
            db, human_id=human.id, popup_id=popup.id
        )

        assert result is None
        db.rollback()


# ---------------------------------------------------------------------------
# 6.2 — Integration tests: GET /applications/my/participation/{popup_id}
# ---------------------------------------------------------------------------


class TestParticipationEndpoint:
    """Integration tests for the participation status endpoint."""

    def test_returns_applicant_for_main_applicant(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """GET participation returns type=applicant for the main applicant."""
        popup = _make_popup(db, tenant_a, slug_suffix="part-applicant")
        email = f"part-applicant-{uuid.uuid4().hex[:8]}@test.com"
        human = _make_human(db, tenant_a, email=email)
        application = _make_application(db, tenant_a, popup, human)
        human_token = create_access_token(subject=human.id, token_type="human")

        response = client.get(
            f"/api/v1/applications/my/participation/{popup.id}",
            headers={"Authorization": f"Bearer {human_token}"},
        )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["type"] == "applicant"
        assert data["application_id"] == str(application.id)
        assert data["status"] == ApplicationStatus.ACCEPTED.value

    def test_returns_companion_for_companion_human(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """GET participation returns type=companion for a human linked as attendee."""
        popup = _make_popup(db, tenant_a, slug_suffix="part-companion")

        # Main applicant
        main_email = f"part-main-{uuid.uuid4().hex[:8]}@test.com"
        main_human = _make_human(db, tenant_a, email=main_email)
        application = _make_application(db, tenant_a, popup, main_human)

        # Companion human
        companion_email = f"part-companion-{uuid.uuid4().hex[:8]}@test.com"
        companion_human = _make_human(db, tenant_a, email=companion_email)
        attendee = _make_attendee(
            db,
            tenant_a,
            application,
            name="Companion Spouse",
            category="spouse",
            human_id=companion_human.id,
            email=companion_email,
        )

        companion_token = create_access_token(
            subject=companion_human.id, token_type="human"
        )

        response = client.get(
            f"/api/v1/applications/my/participation/{popup.id}",
            headers={"Authorization": f"Bearer {companion_token}"},
        )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["type"] == "companion"
        assert data["attendee"]["id"] == str(attendee.id)
        assert data["attendee"]["name"] == "Companion Spouse"
        assert data["attendee"]["category"] == "spouse"
        assert data["application_status"] == ApplicationStatus.ACCEPTED.value

    def test_returns_none_for_unrelated_human(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """GET participation returns type=none for a human with no participation."""
        popup = _make_popup(db, tenant_a, slug_suffix="part-none")
        email = f"part-unrelated-{uuid.uuid4().hex[:8]}@test.com"
        human = _make_human(db, tenant_a, email=email)
        human_token = create_access_token(subject=human.id, token_type="human")

        response = client.get(
            f"/api/v1/applications/my/participation/{popup.id}",
            headers={"Authorization": f"Bearer {human_token}"},
        )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["type"] == "none"

    def test_cross_popup_applicant_and_companion(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Human is applicant in popup A and companion in popup B → correct per-popup."""
        popup_a = _make_popup(db, tenant_a, slug_suffix="cross-a")
        popup_b = _make_popup(db, tenant_a, slug_suffix="cross-b")

        email = f"cross-human-{uuid.uuid4().hex[:8]}@test.com"
        human = _make_human(db, tenant_a, email=email)
        human_token = create_access_token(subject=human.id, token_type="human")

        # Human is main applicant in popup A
        _make_application(db, tenant_a, popup_a, human)

        # Human is companion in popup B (on someone else's application)
        other_email = f"cross-other-{uuid.uuid4().hex[:8]}@test.com"
        other_human = _make_human(db, tenant_a, email=other_email)
        other_app = _make_application(db, tenant_a, popup_b, other_human)
        _make_attendee(
            db,
            tenant_a,
            other_app,
            name="Cross Companion",
            category="spouse",
            human_id=human.id,
            email=email,
        )

        # Check popup A → applicant
        resp_a = client.get(
            f"/api/v1/applications/my/participation/{popup_a.id}",
            headers={"Authorization": f"Bearer {human_token}"},
        )
        assert resp_a.status_code == 200, resp_a.text
        assert resp_a.json()["type"] == "applicant"

        # Check popup B → companion
        resp_b = client.get(
            f"/api/v1/applications/my/participation/{popup_b.id}",
            headers={"Authorization": f"Bearer {human_token}"},
        )
        assert resp_b.status_code == 200, resp_b.text
        assert resp_b.json()["type"] == "companion"


# ---------------------------------------------------------------------------
# 6.3 — Integration tests: POST /applications/my companion guard
# ---------------------------------------------------------------------------


class TestPostGuardCompanion:
    """Integration tests for the companion guard on POST /applications/my."""

    def test_companion_blocked_with_409(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """POST /applications/my returns 409 when human is already a companion."""
        popup = _make_popup(db, tenant_a, slug_suffix="guard-block")

        # Main applicant with an application
        main_email = f"guard-main-{uuid.uuid4().hex[:8]}@test.com"
        main_human = _make_human(db, tenant_a, email=main_email)
        application = _make_application(db, tenant_a, popup, main_human)

        # Companion human linked as attendee
        companion_email = f"guard-companion-{uuid.uuid4().hex[:8]}@test.com"
        companion_human = _make_human(db, tenant_a, email=companion_email)
        _make_attendee(
            db,
            tenant_a,
            application,
            name="Guard Companion",
            category="spouse",
            human_id=companion_human.id,
            email=companion_email,
        )

        companion_token = create_access_token(
            subject=companion_human.id, token_type="human"
        )

        response = client.post(
            "/api/v1/applications/my",
            headers={"Authorization": f"Bearer {companion_token}"},
            json={
                "popup_id": str(popup.id),
                "first_name": "Companion",
                "last_name": "Attempt",
                "status": "in review",
            },
        )

        assert response.status_code == 409, response.text
        assert "companion" in response.json()["detail"].lower()

    def test_non_companion_can_apply_normally(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """POST /applications/my works normally for non-companions."""
        popup = _make_popup(db, tenant_a, slug_suffix="guard-normal")
        email = f"guard-normal-{uuid.uuid4().hex[:8]}@test.com"
        human = _make_human(db, tenant_a, email=email)
        human_token = create_access_token(subject=human.id, token_type="human")

        response = client.post(
            "/api/v1/applications/my",
            headers={"Authorization": f"Bearer {human_token}"},
            json={
                "popup_id": str(popup.id),
                "first_name": "Normal",
                "last_name": "Applicant",
                "status": "in review",
            },
        )

        assert response.status_code == 201, response.text
        data = response.json()
        assert data["popup_id"] == str(popup.id)
        assert data["human_id"] == str(human.id)
