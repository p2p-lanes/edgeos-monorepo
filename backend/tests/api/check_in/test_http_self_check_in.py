"""HTTP API tests for the self-service check-in endpoints.

Covers:
- GET /check-ins/my/{popup_slug}/options
- POST /check-ins/my/{popup_slug}

Scenarios:
- options: empty list when human has no tickets
- options: returns tickets owned via application (Applications.human_id)
- options: returns tickets owned via direct attendee link (Attendees.human_id
  with application_id IS NULL)
- options: 404 when popup has self_check_in_enabled=False
- options: 404 when popup slug doesn't exist
- confirm: happy path, then 409 on duplicate confirm
- confirm: 404 when ticket belongs to another human in the same tenant
- confirm: 400 when product.requires_check_in is False
- confirm: 404 when popup has self_check_in_enabled=False
- confirm: 404 cross-tenant — different tenant's ticket is not visible
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _human_auth(human: Humans) -> dict[str, str]:
    token = create_access_token(subject=human.id, token_type="human")
    return {"Authorization": f"Bearer {token}"}


def _make_self_check_in_popup(
    db: Session, tenant: Tenants, *, enabled: bool = True
) -> Popups:
    """Create a dedicated popup so we don't mutate shared session fixtures."""
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Self Check-In {uuid.uuid4().hex[:6]}",
        slug=f"selfci-{uuid.uuid4().hex[:8]}",
        self_check_in_enabled=enabled,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"selfci-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Self",
        last_name="CheckIn",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_product(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    requires_check_in: bool = True,
) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"SelfCI Product {uuid.uuid4().hex[:6]}",
        slug=f"selfci-prod-{uuid.uuid4().hex[:6]}",
        price=Decimal("25"),
        category="ticket",
        requires_check_in=requires_check_in,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_application(
    db: Session, tenant: Tenants, popup: Popups, human: Humans
) -> Applications:
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
    return application


def _make_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    application: Applications | None = None,
    human: Humans | None = None,
    name: str = "SelfCI Attendee",
) -> Attendees:
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        application_id=application.id if application else None,
        human_id=human.id if human else None,
        name=name,
        category="main",
        email=human.email if human else None,
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _make_ticket(
    db: Session,
    tenant: Tenants,
    attendee: Attendees,
    product: Products,
) -> AttendeeProducts:
    ticket = AttendeeProducts(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        attendee_id=attendee.id,
        product_id=product.id,
        check_in_code=f"SC{uuid.uuid4().hex[:6].upper()}",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


# ---------------------------------------------------------------------------
# GET /check-ins/my/{popup_slug}/options
# ---------------------------------------------------------------------------


class TestGetMyCheckInOptions:
    def test_returns_empty_when_human_has_no_tickets(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_self_check_in_popup(db, tenant_a, enabled=True)
        human = _make_human(db, tenant_a)

        response = client.get(
            f"/api/v1/check-ins/my/{popup.slug}/options",
            headers=_human_auth(human),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["popup"]["slug"] == popup.slug
        assert body["tickets"] == []

    def test_returns_ticket_owned_via_application(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_self_check_in_popup(db, tenant_a, enabled=True)
        human = _make_human(db, tenant_a)
        product = _make_product(db, tenant_a, popup, requires_check_in=True)
        application = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, application=application)
        ticket = _make_ticket(db, tenant_a, attendee, product)

        response = client.get(
            f"/api/v1/check-ins/my/{popup.slug}/options",
            headers=_human_auth(human),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        ticket_ids = [t["attendee_product_id"] for t in body["tickets"]]
        assert str(ticket.id) in ticket_ids
        ticket_payload = next(
            t for t in body["tickets"] if t["attendee_product_id"] == str(ticket.id)
        )
        assert ticket_payload["checked_in"] is False
        assert ticket_payload["first_check_in_at"] is None

    def test_returns_ticket_owned_via_direct_attendee(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Attendees linked to a human via human_id (no application) are owned."""
        popup = _make_self_check_in_popup(db, tenant_a, enabled=True)
        human = _make_human(db, tenant_a)
        product = _make_product(db, tenant_a, popup, requires_check_in=True)
        # No application — direct human_id link on the attendee.
        attendee = _make_attendee(db, tenant_a, popup, human=human)
        ticket = _make_ticket(db, tenant_a, attendee, product)

        response = client.get(
            f"/api/v1/check-ins/my/{popup.slug}/options",
            headers=_human_auth(human),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        ticket_ids = [t["attendee_product_id"] for t in body["tickets"]]
        assert str(ticket.id) in ticket_ids

    def test_returns_404_when_popup_disabled(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_self_check_in_popup(db, tenant_a, enabled=False)
        human = _make_human(db, tenant_a)

        response = client.get(
            f"/api/v1/check-ins/my/{popup.slug}/options",
            headers=_human_auth(human),
        )

        assert response.status_code == 404

    def test_returns_404_when_popup_does_not_exist(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        human = _make_human(db, tenant_a)

        response = client.get(
            "/api/v1/check-ins/my/this-popup-does-not-exist/options",
            headers=_human_auth(human),
        )

        assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /check-ins/my/{popup_slug}
# ---------------------------------------------------------------------------


class TestConfirmMyCheckIn:
    def test_happy_path_then_duplicate_returns_409(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_self_check_in_popup(db, tenant_a, enabled=True)
        human = _make_human(db, tenant_a)
        product = _make_product(db, tenant_a, popup, requires_check_in=True)
        application = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, application=application)
        ticket = _make_ticket(db, tenant_a, attendee, product)

        first = client.post(
            f"/api/v1/check-ins/my/{popup.slug}",
            json={"attendee_product_id": str(ticket.id)},
            headers=_human_auth(human),
        )
        assert first.status_code == 200, first.text
        body = first.json()
        assert body["attendee_product_id"] == str(ticket.id)
        assert body["checked_in"] is True
        assert body["checked_in_at"] is not None

        # Second confirm is rejected as duplicate.
        second = client.post(
            f"/api/v1/check-ins/my/{popup.slug}",
            json={"attendee_product_id": str(ticket.id)},
            headers=_human_auth(human),
        )
        assert second.status_code == 409, second.text

    def test_returns_404_when_ticket_belongs_to_another_human(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_self_check_in_popup(db, tenant_a, enabled=True)
        owner = _make_human(db, tenant_a)
        intruder = _make_human(db, tenant_a)
        product = _make_product(db, tenant_a, popup, requires_check_in=True)
        application = _make_application(db, tenant_a, popup, owner)
        attendee = _make_attendee(db, tenant_a, popup, application=application)
        ticket = _make_ticket(db, tenant_a, attendee, product)

        response = client.post(
            f"/api/v1/check-ins/my/{popup.slug}",
            json={"attendee_product_id": str(ticket.id)},
            headers=_human_auth(intruder),
        )

        assert response.status_code == 404

    def test_returns_400_when_product_does_not_require_check_in(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_self_check_in_popup(db, tenant_a, enabled=True)
        human = _make_human(db, tenant_a)
        product = _make_product(db, tenant_a, popup, requires_check_in=False)
        application = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, application=application)
        ticket = _make_ticket(db, tenant_a, attendee, product)

        response = client.post(
            f"/api/v1/check-ins/my/{popup.slug}",
            json={"attendee_product_id": str(ticket.id)},
            headers=_human_auth(human),
        )

        assert response.status_code == 400

    def test_returns_404_when_popup_disabled(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_self_check_in_popup(db, tenant_a, enabled=False)
        human = _make_human(db, tenant_a)
        product = _make_product(db, tenant_a, popup, requires_check_in=True)
        application = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, application=application)
        ticket = _make_ticket(db, tenant_a, attendee, product)

        response = client.post(
            f"/api/v1/check-ins/my/{popup.slug}",
            json={"attendee_product_id": str(ticket.id)},
            headers=_human_auth(human),
        )

        assert response.status_code == 404

    def test_returns_404_for_cross_tenant_ticket(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        tenant_b: Tenants,
    ) -> None:
        """A human in tenant B cannot confirm a ticket that lives in tenant A,
        even if the popup slugs collide."""
        # Tenant A has an active self-check-in popup with a ticket.
        popup_a = _make_self_check_in_popup(db, tenant_a, enabled=True)
        human_a = _make_human(db, tenant_a)
        product_a = _make_product(db, tenant_a, popup_a, requires_check_in=True)
        application_a = _make_application(db, tenant_a, popup_a, human_a)
        attendee_a = _make_attendee(db, tenant_a, popup_a, application=application_a)
        ticket_a = _make_ticket(db, tenant_a, attendee_a, product_a)

        # Tenant B has its own self-check-in popup; we'll authenticate as a
        # tenant-B human and try to confirm tenant A's ticket UUID under
        # tenant B's popup slug.
        popup_b = _make_self_check_in_popup(db, tenant_b, enabled=True)
        human_b = _make_human(db, tenant_b)

        response = client.post(
            f"/api/v1/check-ins/my/{popup_b.slug}",
            json={"attendee_product_id": str(ticket_a.id)},
            headers=_human_auth(human_b),
        )

        # Tenant B cannot see tenant A's row — either RLS hides it or the
        # ownership/tenant filter rejects it. Either way it surfaces as 404.
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Options reflects already-checked-in state after a successful confirm
# ---------------------------------------------------------------------------


class TestOptionsReflectsCheckedInState:
    def test_options_marks_ticket_checked_in_after_confirm(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_self_check_in_popup(db, tenant_a, enabled=True)
        human = _make_human(db, tenant_a)
        product = _make_product(db, tenant_a, popup, requires_check_in=True)
        application = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, application=application)
        ticket = _make_ticket(db, tenant_a, attendee, product)

        confirm = client.post(
            f"/api/v1/check-ins/my/{popup.slug}",
            json={"attendee_product_id": str(ticket.id)},
            headers=_human_auth(human),
        )
        assert confirm.status_code == 200, confirm.text

        options = client.get(
            f"/api/v1/check-ins/my/{popup.slug}/options",
            headers=_human_auth(human),
        )
        assert options.status_code == 200
        ticket_payload = next(
            t
            for t in options.json()["tickets"]
            if t["attendee_product_id"] == str(ticket.id)
        )
        assert ticket_payload["checked_in"] is True
        assert ticket_payload["first_check_in_at"] is not None
