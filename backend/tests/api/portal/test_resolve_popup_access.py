"""Tests for resolve_popup_access CRUD logic — CAP-A.

TDD phase: RED — tests written BEFORE the implementation.
The function does not exist yet, so all tests must FAIL.

Covers all 10 spec scenarios (one per ladder step / edge case):
1. Accepted application → allowed, source=application
2. Submitted application → denied, reason=application_pending
3. In-review application → denied, reason=application_pending
4. Rejected application → denied, reason=application_rejected
5. No application, but direct attendee row → allowed, source=attendee
6. No application, no attendee, but payment → allowed, source=payment
7. No application, no attendee, no payment, but companion → allowed, source=companion
8. No match at all → denied, reason=no_access
9. Ladder short-circuits: submitted application + direct attendees → denied (step 2 wins)
10. Cross-tenant: wrong popup → denied, reason=no_access
"""

import uuid
from decimal import Decimal

import pytest
from sqlmodel import Session

from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(db: Session, tenant: Tenants, *, suffix: str) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"CAP-A Popup {suffix}",
        slug=f"capa-popup-{suffix}-{uuid.uuid4().hex[:6]}",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"capa-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.flush()
    return human


def _make_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    status: str,
) -> None:
    """Create an application for (human, popup) with the given status."""
    from app.api.application.models import Applications

    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=status,
    )
    db.add(application)
    db.flush()


def _make_direct_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
) -> Attendees:
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=None,
        popup_id=popup.id,
        human_id=human.id,
        name="Direct Attendee",
        category="main",
        check_in_code=f"CA{uuid.uuid4().hex[:4].upper()}",
    )
    db.add(attendee)
    db.flush()
    return attendee


def _make_companion_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    owner_human: Humans,
) -> None:
    """Create an attendee for (human) on an application owned by a different human.

    This simulates the companion participation scenario: the application belongs
    to owner_human but the attendee row is linked to human (the companion).
    find_companion_for_popup returns this attendee for human because
    application.human_id != human.id.
    """
    from app.api.application.models import Applications

    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=owner_human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.flush()

    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        human_id=human.id,  # the companion's human_id
        name="Companion Person",
        category="spouse",
        check_in_code=f"CP{uuid.uuid4().hex[:4].upper()}",
    )
    db.add(attendee)
    db.flush()


def _make_payment_for_human(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
) -> None:
    """Create an application-linked payment owned by human with NO attendees at all.

    This tests the Step 5 (payment) path: the application is owned by the human and
    has a payment, but NO attendees have been created yet (the application was paid
    before any attendee rows were created). Step 4 doesn't fire (no attendees at all)
    and Step 5 fires via the application-leg of the payment ownership check.

    Real-world analogy: application_fee payment made before the main attendee is
    created, or a fee paid on a non-accepted application that was later withdrawn.
    """
    from app.api.application.models import Applications

    # Application owned by human with a non-standard status (withdrawn) so that
    # Steps 1-3 don't fire. Steps 1-3 only check accepted/submitted/in-review/rejected.
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status="withdrawn",  # not in Steps 1-3 status set
    )
    db.add(application)
    db.flush()

    # Payment linked to this application, no attendees created
    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        status=PaymentStatus.APPROVED.value,
        amount=Decimal("100"),
        currency="USD",
    )
    db.add(payment)
    db.flush()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestResolvePopupAccess:
    """Tests for resolve_popup_access (7-step access ladder)."""

    def test_accepted_application_grants_access(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Ladder step 1: accepted application → allowed=True, source=application."""
        from app.api.application.crud import applications_crud

        popup = _make_popup(db, tenant_a, suffix="acc-app")
        human = _make_human(db, tenant_a, suffix="acc-app")
        _make_application(db, tenant_a, popup, human, status=ApplicationStatus.ACCEPTED.value)
        db.commit()

        result = applications_crud.resolve_popup_access(db, human.id, popup.id)

        assert result.allowed is True
        assert result.source == "application"
        assert result.application_status == "accepted"
        assert result.reason is None

    def test_submitted_application_denies_with_pending(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Ladder step 2: submitted application → denied, reason=application_pending."""
        from app.api.application.crud import applications_crud

        popup = _make_popup(db, tenant_a, suffix="sub-app")
        human = _make_human(db, tenant_a, suffix="sub-app")
        _make_application(db, tenant_a, popup, human, status="submitted")
        db.commit()

        result = applications_crud.resolve_popup_access(db, human.id, popup.id)

        assert result.allowed is False
        assert result.source is None
        assert result.application_status == "submitted"
        assert result.reason == "application_pending"

    def test_in_review_application_denies_with_pending(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Ladder step 2b: in-review application → denied, reason=application_pending."""
        from app.api.application.crud import applications_crud

        popup = _make_popup(db, tenant_a, suffix="rev-app")
        human = _make_human(db, tenant_a, suffix="rev-app")
        _make_application(db, tenant_a, popup, human, status=ApplicationStatus.IN_REVIEW.value)
        db.commit()

        result = applications_crud.resolve_popup_access(db, human.id, popup.id)

        assert result.allowed is False
        assert result.source is None
        assert result.application_status == "in review"
        assert result.reason == "application_pending"

    def test_rejected_application_denies_with_rejected(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Ladder step 3: rejected application → denied, reason=application_rejected."""
        from app.api.application.crud import applications_crud

        popup = _make_popup(db, tenant_a, suffix="rej-app")
        human = _make_human(db, tenant_a, suffix="rej-app")
        _make_application(db, tenant_a, popup, human, status=ApplicationStatus.REJECTED.value)
        db.commit()

        result = applications_crud.resolve_popup_access(db, human.id, popup.id)

        assert result.allowed is False
        assert result.source is None
        assert result.application_status == "rejected"
        assert result.reason == "application_rejected"

    def test_no_application_but_attendee_grants_access(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Ladder step 4: no application, but direct attendee → allowed, source=attendee."""
        from app.api.application.crud import applications_crud

        popup = _make_popup(db, tenant_a, suffix="att-acc")
        human = _make_human(db, tenant_a, suffix="att-acc")
        _make_direct_attendee(db, tenant_a, popup, human)
        db.commit()

        result = applications_crud.resolve_popup_access(db, human.id, popup.id)

        assert result.allowed is True
        assert result.source == "attendee"
        assert result.application_status is None
        assert result.reason is None

    def test_no_application_no_attendee_payment_grants_access(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Ladder step 5: no application, no own attendee, but payment → allowed, source=payment."""
        from app.api.application.crud import applications_crud

        popup = _make_popup(db, tenant_a, suffix="pay-acc")
        human = _make_human(db, tenant_a, suffix="pay-acc")
        _make_payment_for_human(db, tenant_a, popup, human)
        db.commit()

        result = applications_crud.resolve_popup_access(db, human.id, popup.id)

        assert result.allowed is True
        assert result.source == "payment"
        assert result.application_status is None
        assert result.reason is None

    def test_companion_grants_access(self, db: Session, tenant_a: Tenants) -> None:
        """Ladder step 6: companion attendee on another's application → allowed, source=companion."""
        from app.api.application.crud import applications_crud

        popup = _make_popup(db, tenant_a, suffix="comp-acc")
        owner = _make_human(db, tenant_a, suffix="comp-owner")
        companion = _make_human(db, tenant_a, suffix="comp-self")
        _make_companion_attendee(db, tenant_a, popup, companion, owner_human=owner)
        db.commit()

        result = applications_crud.resolve_popup_access(db, companion.id, popup.id)

        assert result.allowed is True
        assert result.source == "companion"
        assert result.application_status is None
        assert result.reason is None

    def test_no_match_returns_no_access(self, db: Session, tenant_a: Tenants) -> None:
        """Ladder step 7: no match → denied, reason=no_access."""
        from app.api.application.crud import applications_crud

        popup = _make_popup(db, tenant_a, suffix="no-acc")
        human = _make_human(db, tenant_a, suffix="no-acc")
        db.commit()

        result = applications_crud.resolve_popup_access(db, human.id, popup.id)

        assert result.allowed is False
        assert result.source is None
        assert result.application_status is None
        assert result.reason == "no_access"

    def test_submitted_app_short_circuits_over_attendee(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Ladder short-circuit: submitted application beats a direct attendee (step 2 wins)."""
        from app.api.application.crud import applications_crud

        popup = _make_popup(db, tenant_a, suffix="sc-test")
        human = _make_human(db, tenant_a, suffix="sc-test")
        _make_application(db, tenant_a, popup, human, status="submitted")
        _make_direct_attendee(db, tenant_a, popup, human)
        db.commit()

        result = applications_crud.resolve_popup_access(db, human.id, popup.id)

        assert result.allowed is False
        assert result.reason == "application_pending"

    def test_unknown_popup_returns_no_access(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Non-existent popup ID → denied, reason=no_access (all ladder steps return None)."""
        from app.api.application.crud import applications_crud

        human = _make_human(db, tenant_a, suffix="bad-popup")
        db.commit()

        result = applications_crud.resolve_popup_access(db, human.id, uuid.uuid4())

        assert result.allowed is False
        assert result.source is None
        assert result.reason == "no_access"
