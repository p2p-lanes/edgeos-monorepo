"""Tests for AttendeesCRUD.find_by_human_popup — CAP-B CRUD layer.

TDD phase: RED — tests written BEFORE the implementation.
The method does not exist yet, so these tests must FAIL.

Scenarios covered:
1. Empty result when human has no attendees in popup
2. Application-linked attendees returned
3. Direct-sale attendees (application_id=NULL) returned
4. Mixed: both legs returned, no duplicates
5. Pagination: skip + limit respected, total counts all rows
6. Cross-popup isolation: only popup A's attendees when requesting popup A
7. Cross-human isolation: only human A's attendees when querying for human A
"""

import uuid

import pytest
from sqlmodel import Session

from app.api.attendee.crud import attendees_crud
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_tenant(db: Session, *, suffix: str) -> Tenants:
    tenant = Tenants(
        id=uuid.uuid4(),
        name=f"CAP-B Tenant {suffix}",
        slug=f"capb-tenant-{suffix}-{uuid.uuid4().hex[:6]}",
    )
    db.add(tenant)
    db.flush()
    return tenant


def _make_popup(db: Session, tenant: Tenants, *, suffix: str) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"CAP-B Popup {suffix}",
        slug=f"capb-popup-{suffix}-{uuid.uuid4().hex[:6]}",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_human(db: Session, tenant: Tenants, *, email: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=email,
    )
    db.add(human)
    db.flush()
    return human


def _make_app_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    name: str = "App Attendee",
) -> Attendees:
    """Create an application-linked attendee (application_id IS NOT NULL)."""
    from app.api.application.models import Applications
    from app.api.application.schemas import ApplicationStatus

    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.flush()

    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        human_id=human.id,
        name=name,
        category="main",
        check_in_code=f"A{uuid.uuid4().hex[:5].upper()}",
    )
    db.add(attendee)
    db.flush()
    return attendee


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
    db.flush()
    return attendee


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestFindByHumanPopup:
    """Unit tests for AttendeesCRUD.find_by_human_popup."""

    def test_empty_when_no_attendees(self, db: Session, tenant_a: Tenants) -> None:
        """Human with no attendees in the popup returns empty list, total=0."""
        popup = _make_popup(db, tenant_a, suffix="empty")
        human = _make_human(db, tenant_a, email=f"empty-{uuid.uuid4().hex[:8]}@test.com")
        db.commit()

        results, total = attendees_crud.find_by_human_popup(db, human.id, popup.id)

        assert results == []
        assert total == 0

    def test_application_linked_attendees_returned(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Application-linked attendees are returned with origin='application'."""
        popup = _make_popup(db, tenant_a, suffix="app-only")
        human = _make_human(db, tenant_a, email=f"app-{uuid.uuid4().hex[:8]}@test.com")
        attendee = _make_app_attendee(db, tenant_a, popup, human)
        db.commit()

        results, total = attendees_crud.find_by_human_popup(db, human.id, popup.id)

        assert total == 1
        assert len(results) == 1
        assert results[0].id == attendee.id

    def test_direct_sale_attendees_returned(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Direct-sale attendees (application_id=NULL) are returned."""
        popup = _make_popup(db, tenant_a, suffix="direct-only")
        human = _make_human(
            db, tenant_a, email=f"direct-{uuid.uuid4().hex[:8]}@test.com"
        )
        attendee = _make_direct_attendee(db, tenant_a, popup, human)
        db.commit()

        results, total = attendees_crud.find_by_human_popup(db, human.id, popup.id)

        assert total == 1
        assert len(results) == 1
        assert results[0].id == attendee.id

    def test_mixed_both_legs_no_duplicates(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Both application-linked AND direct-sale attendees returned, no duplicates."""
        popup = _make_popup(db, tenant_a, suffix="mixed")
        human = _make_human(db, tenant_a, email=f"mixed-{uuid.uuid4().hex[:8]}@test.com")
        app_attendee = _make_app_attendee(db, tenant_a, popup, human, name="App One")
        direct_attendee = _make_direct_attendee(
            db, tenant_a, popup, human, name="Direct One"
        )
        db.commit()

        results, total = attendees_crud.find_by_human_popup(db, human.id, popup.id)

        assert total == 2
        ids = {r.id for r in results}
        assert app_attendee.id in ids
        assert direct_attendee.id in ids

    def test_pagination_skip_limit(self, db: Session, tenant_a: Tenants) -> None:
        """Pagination: skip=1, limit=1 returns the right slice and total=3."""
        popup = _make_popup(db, tenant_a, suffix="paged")
        human = _make_human(db, tenant_a, email=f"paged-{uuid.uuid4().hex[:8]}@test.com")
        _make_app_attendee(db, tenant_a, popup, human, name="Paged One")
        _make_direct_attendee(db, tenant_a, popup, human, name="Paged Two")
        _make_direct_attendee(db, tenant_a, popup, human, name="Paged Three")
        db.commit()

        results, total = attendees_crud.find_by_human_popup(
            db, human.id, popup.id, skip=1, limit=1
        )

        assert total == 3
        assert len(results) == 1

    def test_cross_popup_isolation(self, db: Session, tenant_a: Tenants) -> None:
        """Only popup A's attendees returned when querying popup A."""
        popup_a = _make_popup(db, tenant_a, suffix="iso-a")
        popup_b = _make_popup(db, tenant_a, suffix="iso-b")
        human = _make_human(
            db, tenant_a, email=f"iso-cross-{uuid.uuid4().hex[:8]}@test.com"
        )
        a_attendee = _make_app_attendee(db, tenant_a, popup_a, human, name="In A")
        _make_direct_attendee(db, tenant_a, popup_b, human, name="In B")
        db.commit()

        results, total = attendees_crud.find_by_human_popup(db, human.id, popup_a.id)

        assert total == 1
        assert results[0].id == a_attendee.id

    def test_cross_human_isolation(self, db: Session, tenant_a: Tenants) -> None:
        """Only human A's attendees returned when querying for human A."""
        popup = _make_popup(db, tenant_a, suffix="human-iso")
        human_a = _make_human(
            db, tenant_a, email=f"human-a-{uuid.uuid4().hex[:8]}@test.com"
        )
        human_b = _make_human(
            db, tenant_a, email=f"human-b-{uuid.uuid4().hex[:8]}@test.com"
        )
        a_attendee = _make_app_attendee(db, tenant_a, popup, human_a, name="Human A's")
        _make_direct_attendee(db, tenant_a, popup, human_b, name="Human B's")
        db.commit()

        results, total = attendees_crud.find_by_human_popup(db, human_a.id, popup.id)

        assert total == 1
        assert results[0].id == a_attendee.id
