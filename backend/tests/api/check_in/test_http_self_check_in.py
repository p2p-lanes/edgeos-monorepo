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
from app.api.payment.models import PaymentProducts, Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import application_flow_id

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
        sales_flow_id=application_flow_id(db, popup.id),
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


def _make_ownerless_unit(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    revoked: bool = False,
) -> AttendeeProducts:
    from datetime import UTC, datetime

    product = _make_product(db, tenant, popup, requires_check_in=True)
    product.category = "parking"
    payment = Payments(
        tenant_id=tenant.id,
        popup_id=popup.id,
        buyer_human_id=human.id,
        status="approved",
        amount=Decimal("25"),
        currency="USD",
    )
    db.add(payment)
    db.flush()
    line = PaymentProducts(
        tenant_id=tenant.id,
        payment_id=payment.id,
        product_id=product.id,
        attendee_id=None,
        quantity=1,
        product_name=product.name,
        product_price=product.price,
        product_category="parking",
        requires_check_in_snapshot=True,
        product_currency="USD",
    )
    db.add(line)
    db.flush()
    unit = AttendeeProducts(
        tenant_id=tenant.id,
        attendee_id=None,
        product_id=product.id,
        payment_id=payment.id,
        payment_product_id=line.id,
        unit_index=0,
        check_in_code=f"PK{uuid.uuid4().hex[:6].upper()}",
        product_category_snapshot="parking",
        requires_check_in_snapshot=True,
        revoked_at=datetime.now(UTC) if revoked else None,
    )
    db.add(unit)
    db.commit()
    db.refresh(unit)
    return unit


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

    def test_returns_buyer_owned_ownerless_unit_and_order_details(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_self_check_in_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        unit = _make_ownerless_unit(db, tenant_a, popup, human)
        unit.requires_check_in_snapshot = False
        db.add(unit)
        db.commit()

        options = client.get(
            f"/api/v1/check-ins/my/{popup.slug}/options", headers=_human_auth(human)
        )
        assert options.status_code == 200, options.text
        ticket = options.json()["tickets"][0]
        assert ticket["attendee_product_id"] == str(unit.id)
        assert ticket["attendee_name"] is None
        assert ticket["attendee_category"] is None
        assert ticket["product_category"] == "parking"

        orders = client.get(
            f"/api/v1/payments/my/popup/{popup.id}", headers=_human_auth(human)
        )
        assert orders.status_code == 200, orders.text
        payload = orders.json()["results"][0]["products_snapshot"][0]["units"][0]
        assert payload["id"] == str(unit.id)
        assert payload["attendee_id"] is None
        assert payload["check_in_code"] == unit.check_in_code
        assert payload["active"] is True
        assert payload["requires_check_in"] is True

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
    def test_happy_path_then_repeat_appends_history(
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

        second = client.post(
            f"/api/v1/check-ins/my/{popup.slug}",
            json={"attendee_product_id": str(ticket.id)},
            headers=_human_auth(human),
        )
        assert second.status_code == 200, second.text

    def test_ownerless_repeat_appends_history_without_creating_attendee(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        from sqlmodel import func, select

        from app.api.check_in.models import CheckIn

        popup = _make_self_check_in_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        unit = _make_ownerless_unit(db, tenant_a, popup, human)
        unit.requires_check_in_snapshot = False
        db.add(unit)
        db.commit()
        attendee_count = db.exec(select(func.count()).select_from(Attendees)).one()

        for _ in range(2):
            response = client.post(
                f"/api/v1/check-ins/my/{popup.slug}",
                json={"attendee_product_id": str(unit.id)},
                headers=_human_auth(human),
            )
            assert response.status_code == 200, response.text
            assert response.json()["attendee_name"] is None

        assert (
            db.exec(
                select(func.count())
                .select_from(CheckIn)
                .where(CheckIn.attendee_product_id == unit.id)
            ).one()
            == 2
        )
        assert (
            db.exec(select(func.count()).select_from(Attendees)).one() == attendee_count
        )

    def test_revoked_ownerless_unit_is_hidden_and_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_self_check_in_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        unit = _make_ownerless_unit(db, tenant_a, popup, human, revoked=True)

        options = client.get(
            f"/api/v1/check-ins/my/{popup.slug}/options", headers=_human_auth(human)
        )
        response = client.post(
            f"/api/v1/check-ins/my/{popup.slug}",
            json={"attendee_product_id": str(unit.id)},
            headers=_human_auth(human),
        )

        assert options.json()["tickets"] == []
        assert response.status_code == 404

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
