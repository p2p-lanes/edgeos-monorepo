"""HTTP integration tests for GET /portal/popup/{popup_id}/access — CAP-A.

Phase 4: route-level tests. These test the full HTTP stack (auth, routing,
response serialization) on top of the CRUD logic already unit-tested in
test_resolve_popup_access.py.

Spec scenarios covered:
1. 401 — no valid OTP session
2. Cross-tenant popup → 200, allowed=False, reason=no_access (RLS filters it out)
3. Accepted application → 200, allowed=True, source=application
4. Submitted application (no attendees/payments) → 200, allowed=False, reason=application_pending
5. In-review application → 200, allowed=False, reason=application_pending
6. Rejected application (no attendees/payments) → 200, allowed=False, reason=application_rejected
7. No application, direct attendee → 200, allowed=True, source=attendee
8. No application, no attendee, payment via app-leg → 200, allowed=True, source=payment
9. Companion (attendee on another human's application) → 200, allowed=True, source=companion
10. No match → 200, allowed=False, reason=no_access
11. Ladder short-circuit: submitted app + direct attendees → denied (step 2 wins)
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus
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
        name=f"HTTP-CAP-A Popup {suffix}",
        slug=f"http-capa-{suffix}-{uuid.uuid4().hex[:6]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"http-capa-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
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
        check_in_code=f"HA{uuid.uuid4().hex[:4].upper()}",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _make_companion_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    companion: Humans,
    owner: Humans,
) -> None:
    """Companion: attendee linked to owner's application but with companion's human_id."""
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=owner.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.flush()

    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        human_id=companion.id,
        name="Companion Person",
        category="spouse",
        check_in_code=f"HC{uuid.uuid4().hex[:4].upper()}",
    )
    db.add(attendee)
    db.commit()


def _make_app_payment_no_attendees(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
) -> None:
    """Withdrawn-status application with a payment but NO attendee rows.

    This ensures step 4 (attendee check) doesn't fire and step 5 (payment) can fire.
    """
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status="withdrawn",
    )
    db.add(application)
    db.flush()

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
    db.commit()


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _auth(human: Humans) -> dict[str, str]:
    return {"Authorization": f"Bearer {_human_token(human)}"}


def _access_url(popup_id: uuid.UUID) -> str:
    return f"/api/v1/portal/popup/{popup_id}/access"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGetPopupAccessHttp:
    """HTTP integration tests for GET /portal/popup/{popup_id}/access (CAP-A)."""

    def test_no_auth_returns_401(
        self,
        client: TestClient,
        tenant_a: Tenants,
        db: Session,
    ) -> None:
        """Unauthenticated request must return 401."""
        popup = _make_popup(db, tenant_a, suffix="no-auth")
        response = client.get(_access_url(popup.id))
        assert response.status_code == 401

    def test_accepted_application_returns_allowed(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Ladder step 1: accepted application → 200, allowed=True, source=application."""
        popup = _make_popup(db, tenant_a, suffix="http-acc")
        human = _make_human(db, tenant_a, suffix="http-acc")
        _make_application(
            db, tenant_a, popup, human, status=ApplicationStatus.ACCEPTED.value
        )

        response = client.get(_access_url(popup.id), headers=_auth(human))

        assert response.status_code == 200
        body = response.json()
        assert body["allowed"] is True
        assert body["source"] == "application"
        assert body["application_status"] == "accepted"
        assert body["reason"] is None

    def test_submitted_application_returns_pending(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Ladder step 2: submitted application → 200, denied, reason=application_pending."""
        popup = _make_popup(db, tenant_a, suffix="http-sub")
        human = _make_human(db, tenant_a, suffix="http-sub")
        _make_application(db, tenant_a, popup, human, status="submitted")

        response = client.get(_access_url(popup.id), headers=_auth(human))

        assert response.status_code == 200
        body = response.json()
        assert body["allowed"] is False
        assert body["source"] is None
        assert body["application_status"] == "submitted"
        assert body["reason"] == "application_pending"

    def test_in_review_application_returns_pending(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Ladder step 2b: in-review application → 200, denied, reason=application_pending."""
        popup = _make_popup(db, tenant_a, suffix="http-rev")
        human = _make_human(db, tenant_a, suffix="http-rev")
        _make_application(
            db, tenant_a, popup, human, status=ApplicationStatus.IN_REVIEW.value
        )

        response = client.get(_access_url(popup.id), headers=_auth(human))

        assert response.status_code == 200
        body = response.json()
        assert body["allowed"] is False
        assert body["reason"] == "application_pending"
        assert body["application_status"] == "in review"

    def test_rejected_application_returns_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Ladder step 3: rejected application → 200, denied, reason=application_rejected."""
        popup = _make_popup(db, tenant_a, suffix="http-rej")
        human = _make_human(db, tenant_a, suffix="http-rej")
        _make_application(
            db, tenant_a, popup, human, status=ApplicationStatus.REJECTED.value
        )

        response = client.get(_access_url(popup.id), headers=_auth(human))

        assert response.status_code == 200
        body = response.json()
        assert body["allowed"] is False
        assert body["source"] is None
        assert body["application_status"] == "rejected"
        assert body["reason"] == "application_rejected"

    def test_no_application_but_attendee_returns_allowed(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Ladder step 4: no application, direct attendee → 200, allowed, source=attendee."""
        popup = _make_popup(db, tenant_a, suffix="http-att")
        human = _make_human(db, tenant_a, suffix="http-att")
        _make_direct_attendee(db, tenant_a, popup, human)

        response = client.get(_access_url(popup.id), headers=_auth(human))

        assert response.status_code == 200
        body = response.json()
        assert body["allowed"] is True
        assert body["source"] == "attendee"
        assert body["application_status"] is None
        assert body["reason"] is None

    def test_no_attendee_but_payment_returns_allowed(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Ladder step 5: no own attendees, but payment via app-leg → 200, source=payment."""
        popup = _make_popup(db, tenant_a, suffix="http-pay")
        human = _make_human(db, tenant_a, suffix="http-pay")
        _make_app_payment_no_attendees(db, tenant_a, popup, human)

        response = client.get(_access_url(popup.id), headers=_auth(human))

        assert response.status_code == 200
        body = response.json()
        assert body["allowed"] is True
        assert body["source"] == "payment"
        assert body["application_status"] is None
        assert body["reason"] is None

    def test_companion_returns_allowed(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Ladder step 6: companion participant → 200, allowed, source=companion."""
        popup = _make_popup(db, tenant_a, suffix="http-comp")
        owner = _make_human(db, tenant_a, suffix="http-comp-owner")
        companion = _make_human(db, tenant_a, suffix="http-comp-self")
        _make_companion_attendee(db, tenant_a, popup, companion, owner)

        response = client.get(_access_url(popup.id), headers=_auth(companion))

        assert response.status_code == 200
        body = response.json()
        assert body["allowed"] is True
        assert body["source"] == "companion"
        assert body["application_status"] is None
        assert body["reason"] is None

    def test_no_match_returns_no_access(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Ladder step 7: no match → 200, denied, reason=no_access."""
        popup = _make_popup(db, tenant_a, suffix="http-none")
        human = _make_human(db, tenant_a, suffix="http-none")

        response = client.get(_access_url(popup.id), headers=_auth(human))

        assert response.status_code == 200
        body = response.json()
        assert body["allowed"] is False
        assert body["source"] is None
        assert body["application_status"] is None
        assert body["reason"] == "no_access"

    def test_cross_tenant_popup_returns_no_access(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        tenant_b: Tenants,
    ) -> None:
        """Popup from tenant_b viewed by a tenant_a human → RLS isolates → no_access.

        The human's OTP session is scoped to tenant_a. RLS prevents it from
        seeing tenant_b's popup data, so the ladder finds nothing and step 7 fires.
        """
        popup_b = _make_popup(db, tenant_b, suffix="http-xtenant")
        human = _make_human(db, tenant_a, suffix="http-xtenant")

        response = client.get(_access_url(popup_b.id), headers=_auth(human))

        assert response.status_code == 200
        body = response.json()
        assert body["allowed"] is False
        assert body["reason"] == "no_access"

    def test_ladder_short_circuit_submitted_beats_attendee(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Submitted application fires step 2 before step 4, even with direct attendees."""
        popup = _make_popup(db, tenant_a, suffix="http-sc")
        human = _make_human(db, tenant_a, suffix="http-sc")
        _make_application(db, tenant_a, popup, human, status="submitted")
        _make_direct_attendee(db, tenant_a, popup, human)

        response = client.get(_access_url(popup.id), headers=_auth(human))

        assert response.status_code == 200
        body = response.json()
        assert body["allowed"] is False
        assert body["reason"] == "application_pending"
