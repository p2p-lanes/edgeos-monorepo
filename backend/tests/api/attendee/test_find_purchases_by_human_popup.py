"""Tests for AttendeesCRUD.find_purchases_by_human_popup — CAP-E bugfix.

TDD phase: RED — tests written BEFORE the fix.
The current implementation only JOINs through Applications, so direct-sale
attendees (application_id=NULL) are invisible. These tests must FAIL against
the current code and PASS after the UNION fix is applied.

Scenarios covered:
1. Application-linked attendees are returned (regression check — must stay green)
2. Direct-sale attendees (application_id=NULL) are returned (the regression)
3. Both legs combined return all attendees without duplicates
4. Empty result when the human has no attendees in the popup
5. Cross-popup isolation (only the requested popup's attendees)
6. Cross-human isolation (only the requested human's attendees)
"""

import uuid

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
        name=f"Cap-E Tenant {suffix}",
        slug=f"cape-tenant-{suffix}-{uuid.uuid4().hex[:6]}",
    )
    db.add(tenant)
    db.flush()
    return tenant


def _make_popup(db: Session, tenant: Tenants, *, suffix: str) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Cap-E Popup {suffix}",
        slug=f"cape-popup-{suffix}-{uuid.uuid4().hex[:6]}",
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

    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
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
    """Create a direct-sale attendee (application_id IS NULL)."""
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


class TestFindPurchasesByHumanPopup:
    """Unit tests for find_purchases_by_human_popup — both legs of the UNION."""

    def test_returns_application_linked_attendee(self, db: Session) -> None:
        """Regression: application-linked leg must still work after the fix."""
        tenant = _make_tenant(db, suffix="app-leg")
        popup = _make_popup(db, tenant, suffix="app-leg")
        human = _make_human(
            db, tenant, email=f"app-leg-{uuid.uuid4().hex[:8]}@test.com"
        )

        app_attendee = _make_app_attendee(db, tenant, popup, human)

        results = attendees_crud.find_purchases_by_human_popup(
            db, human_id=human.id, popup_id=popup.id
        )

        ids = {a.id for a in results}
        assert app_attendee.id in ids, (
            "Application-linked attendee must appear in find_purchases_by_human_popup results"
        )
        db.rollback()

    def test_returns_direct_sale_attendee(self, db: Session) -> None:
        """THE REGRESSION: direct-sale attendee (application_id=NULL) must be returned.

        Current implementation JOINs exclusively through Applications and returns []
        for direct-sale humans. This test FAILS against the current code and PASSES
        after the UNION fix.
        """
        tenant = _make_tenant(db, suffix="direct-leg")
        popup = _make_popup(db, tenant, suffix="direct-leg")
        human = _make_human(
            db, tenant, email=f"direct-leg-{uuid.uuid4().hex[:8]}@test.com"
        )

        direct_attendee = _make_direct_attendee(db, tenant, popup, human)

        results = attendees_crud.find_purchases_by_human_popup(
            db, human_id=human.id, popup_id=popup.id
        )

        assert len(results) > 0, (
            "find_purchases_by_human_popup must return direct-sale attendees "
            "(application_id=NULL). Current implementation returns [] — this is the bug."
        )
        ids = {a.id for a in results}
        assert direct_attendee.id in ids, (
            f"Direct-sale attendee {direct_attendee.id} not in results {ids}"
        )
        db.rollback()

    def test_returns_both_legs_without_duplicates(self, db: Session) -> None:
        """Both application-linked AND direct-sale attendees appear, with no duplicates."""
        tenant = _make_tenant(db, suffix="both-legs")
        popup = _make_popup(db, tenant, suffix="both-legs")
        human = _make_human(
            db, tenant, email=f"both-legs-{uuid.uuid4().hex[:8]}@test.com"
        )

        app_attendee = _make_app_attendee(db, tenant, popup, human, name="App Side")
        direct_attendee = _make_direct_attendee(
            db, tenant, popup, human, name="Direct Side"
        )

        results = attendees_crud.find_purchases_by_human_popup(
            db, human_id=human.id, popup_id=popup.id
        )

        ids = {a.id for a in results}
        assert app_attendee.id in ids, (
            "Application-linked attendee missing from combined result"
        )
        assert direct_attendee.id in ids, (
            "Direct-sale attendee missing from combined result"
        )
        assert len(ids) == len(results), (
            "Duplicate rows detected — UNION must deduplicate"
        )
        db.rollback()

    def test_returns_empty_for_human_with_no_attendees(self, db: Session) -> None:
        """Empty list when the human has no attendees at all for the popup."""
        tenant = _make_tenant(db, suffix="empty")
        popup = _make_popup(db, tenant, suffix="empty")
        human = _make_human(
            db, tenant, email=f"no-attendees-{uuid.uuid4().hex[:8]}@test.com"
        )

        results = attendees_crud.find_purchases_by_human_popup(
            db, human_id=human.id, popup_id=popup.id
        )

        assert results == [], (
            "Expected empty list when human has no attendees in the popup"
        )
        db.rollback()

    def test_cross_popup_isolation(self, db: Session) -> None:
        """Attendees from a different popup are NOT returned."""
        tenant = _make_tenant(db, suffix="cross-popup")
        popup_a = _make_popup(db, tenant, suffix="cross-popup-a")
        popup_b = _make_popup(db, tenant, suffix="cross-popup-b")
        human = _make_human(
            db, tenant, email=f"cross-popup-{uuid.uuid4().hex[:8]}@test.com"
        )

        # Attendee in popup_b — must NOT appear when querying popup_a
        _make_direct_attendee(db, tenant, popup_b, human, name="Wrong Popup")
        # Attendee in popup_a — must appear
        expected = _make_direct_attendee(db, tenant, popup_a, human, name="Right Popup")

        results = attendees_crud.find_purchases_by_human_popup(
            db, human_id=human.id, popup_id=popup_a.id
        )

        ids = {a.id for a in results}
        assert expected.id in ids, "Expected popup_a attendee in results"
        for attendee in results:
            assert attendee.popup_id == popup_a.id, (
                f"Cross-popup leak: attendee {attendee.id} has popup_id {attendee.popup_id}"
            )
        db.rollback()

    def test_cross_human_isolation(self, db: Session) -> None:
        """Attendees owned by a different human are NOT returned."""
        tenant = _make_tenant(db, suffix="cross-human")
        popup = _make_popup(db, tenant, suffix="cross-human")
        human_a = _make_human(
            db, tenant, email=f"human-a-{uuid.uuid4().hex[:8]}@test.com"
        )
        human_b = _make_human(
            db, tenant, email=f"human-b-{uuid.uuid4().hex[:8]}@test.com"
        )

        # human_b's attendee — must NOT appear when querying human_a
        _make_direct_attendee(db, tenant, popup, human_b, name="Wrong Human")
        # human_a's attendee — must appear
        expected = _make_direct_attendee(db, tenant, popup, human_a, name="Right Human")

        results = attendees_crud.find_purchases_by_human_popup(
            db, human_id=human_a.id, popup_id=popup.id
        )

        ids = {a.id for a in results}
        assert expected.id in ids, "human_a attendee should be in results"
        for attendee in results:
            # All returned attendees must be owned by human_a
            # (either via human_id or via application.human_id — in this test, direct leg only)
            assert attendee.human_id == human_a.id or (
                attendee.application_id is not None
            ), f"Cross-human leak: attendee {attendee.id}"
        db.rollback()
