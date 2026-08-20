"""Tests for GET /applications/{id}/previous.

The endpoint answers one question for a reviewer: has this person applied to
other popups of the tenant before, and what did they do there? Each entry
carries the popup name, the application status, the tickets purchased and the
approved spend.

Coverage: exclusion of the current popup, ticket counting across companions,
approved-only spend (grouped by currency), every status included, ordering,
tenant isolation and 404s.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.payment.models import Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"prev-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Previous",
        last_name="Tester",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_popup(
    db: Session, tenant: Tenants, name: str, start_date: datetime | None = None
) -> Popups:
    """A throwaway popup per test — the shared fixtures are session-scoped and
    would leak applications between tests of this module."""
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=name,
        slug=f"{name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:6]}",
        start_date=start_date,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    status: str = "accepted",
    submitted_at: datetime | None = None,
) -> Applications:
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=status,
        submitted_at=submitted_at,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def _add_tickets(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    application: Applications,
    *,
    name: str,
    count: int,
) -> Attendees:
    """Attach `count` tickets to a new attendee of `application`.

    One `attendee_products` row per ticket — that is the storage shape, and what
    the endpoint counts.
    """
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        application_id=application.id,
        human_id=application.human_id,
        name=name,
    )
    db.add(attendee)

    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Pass {uuid.uuid4().hex[:6]}",
        slug=f"pass-{uuid.uuid4().hex[:6]}",
        price=Decimal("100"),
        category="ticket",
    )
    db.add(product)
    db.commit()

    for _ in range(count):
        db.add(
            AttendeeProducts(
                id=uuid.uuid4(),
                tenant_id=tenant.id,
                attendee_id=attendee.id,
                product_id=product.id,
                check_in_code=uuid.uuid4().hex[:10],
            )
        )
    db.commit()
    return attendee


def _add_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    application: Applications,
    *,
    amount: str,
    status: str = "approved",
    currency: str = "USD",
) -> Payments:
    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        status=status,
        amount=Decimal(amount),
        currency=currency,
    )
    db.add(payment)
    db.commit()
    return payment


class TestPreviousApplications:
    def test_returns_empty_when_no_other_popups(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        human = _make_human(db, tenant_a)
        popup = _make_popup(db, tenant_a, "Only Popup")
        current = _make_application(db, tenant_a, popup, human)

        resp = client.get(
            f"/api/v1/applications/{current.id}/previous",
            headers=_auth(admin_token_tenant_a),
        )

        assert resp.status_code == 200
        assert resp.json() == []

    def test_excludes_current_popup_and_summarizes_the_others(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        human = _make_human(db, tenant_a)
        current_popup = _make_popup(db, tenant_a, "Current Popup")
        past_popup = _make_popup(
            db, tenant_a, "Past Popup", start_date=datetime(2024, 10, 1, tzinfo=UTC)
        )

        current = _make_application(db, tenant_a, current_popup, human)
        past = _make_application(
            db,
            tenant_a,
            past_popup,
            human,
            submitted_at=datetime(2024, 9, 1, tzinfo=UTC),
        )
        _add_tickets(db, tenant_a, past_popup, past, name="Main", count=2)
        _add_payment(db, tenant_a, past_popup, past, amount="1200.00")

        resp = client.get(
            f"/api/v1/applications/{current.id}/previous",
            headers=_auth(admin_token_tenant_a),
        )

        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        entry = body[0]
        assert entry["id"] == str(past.id)
        assert entry["popup_id"] == str(past_popup.id)
        assert entry["popup_name"] == "Past Popup"
        assert entry["popup_start_date"].startswith("2024-10-01")
        assert entry["status"] == "accepted"
        assert entry["tickets_count"] == 2
        assert entry["spend"] == [{"currency": "USD", "amount": "1200.00"}]

    def test_counts_tickets_across_companions(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        human = _make_human(db, tenant_a)
        current_popup = _make_popup(db, tenant_a, "Current Companions")
        past_popup = _make_popup(db, tenant_a, "Past Companions")

        current = _make_application(db, tenant_a, current_popup, human)
        past = _make_application(db, tenant_a, past_popup, human)
        _add_tickets(db, tenant_a, past_popup, past, name="Main", count=2)
        _add_tickets(db, tenant_a, past_popup, past, name="Spouse", count=1)

        resp = client.get(
            f"/api/v1/applications/{current.id}/previous",
            headers=_auth(admin_token_tenant_a),
        )

        assert resp.status_code == 200
        assert resp.json()[0]["tickets_count"] == 3

    def test_spend_counts_approved_payments_only(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        human = _make_human(db, tenant_a)
        current_popup = _make_popup(db, tenant_a, "Current Spend")
        past_popup = _make_popup(db, tenant_a, "Past Spend")

        current = _make_application(db, tenant_a, current_popup, human)
        past = _make_application(db, tenant_a, past_popup, human)
        _add_payment(db, tenant_a, past_popup, past, amount="100.00")
        _add_payment(db, tenant_a, past_popup, past, amount="50.00")
        # Money never taken — must not show up in the total.
        _add_payment(db, tenant_a, past_popup, past, amount="999.00", status="pending")
        _add_payment(db, tenant_a, past_popup, past, amount="999.00", status="expired")
        _add_payment(db, tenant_a, past_popup, past, amount="999.00", status="rejected")

        resp = client.get(
            f"/api/v1/applications/{current.id}/previous",
            headers=_auth(admin_token_tenant_a),
        )

        assert resp.status_code == 200
        assert resp.json()[0]["spend"] == [{"currency": "USD", "amount": "150.00"}]

    def test_spend_is_grouped_by_currency(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        human = _make_human(db, tenant_a)
        current_popup = _make_popup(db, tenant_a, "Current Currency")
        past_popup = _make_popup(db, tenant_a, "Past Currency")

        current = _make_application(db, tenant_a, current_popup, human)
        past = _make_application(db, tenant_a, past_popup, human)
        _add_payment(db, tenant_a, past_popup, past, amount="100.00", currency="USD")
        _add_payment(db, tenant_a, past_popup, past, amount="500.00", currency="ARS")

        resp = client.get(
            f"/api/v1/applications/{current.id}/previous",
            headers=_auth(admin_token_tenant_a),
        )

        assert resp.status_code == 200
        # Alphabetical by currency, so the render order is deterministic.
        assert resp.json()[0]["spend"] == [
            {"currency": "ARS", "amount": "500.00"},
            {"currency": "USD", "amount": "100.00"},
        ]

    def test_includes_every_status_newest_first(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        human = _make_human(db, tenant_a)
        current_popup = _make_popup(db, tenant_a, "Current Statuses")
        draft_popup = _make_popup(db, tenant_a, "Draft Popup")
        rejected_popup = _make_popup(db, tenant_a, "Rejected Popup")

        current = _make_application(db, tenant_a, current_popup, human)
        _make_application(
            db,
            tenant_a,
            rejected_popup,
            human,
            status="rejected",
            submitted_at=datetime(2023, 1, 1, tzinfo=UTC),
        )
        _make_application(
            db,
            tenant_a,
            draft_popup,
            human,
            status="draft",
            submitted_at=datetime(2025, 1, 1, tzinfo=UTC),
        )

        resp = client.get(
            f"/api/v1/applications/{current.id}/previous",
            headers=_auth(admin_token_tenant_a),
        )

        assert resp.status_code == 200
        body = resp.json()
        # A never-submitted draft and a rejection are both signal for a reviewer.
        assert [entry["status"] for entry in body] == ["draft", "rejected"]
        assert [entry["tickets_count"] for entry in body] == [0, 0]
        assert [entry["spend"] for entry in body] == [[], []]

    def test_other_tenant_cannot_read_the_application(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_b: str,
    ) -> None:
        human = _make_human(db, tenant_a)
        popup = _make_popup(db, tenant_a, "Isolated Popup")
        current = _make_application(db, tenant_a, popup, human)

        resp = client.get(
            f"/api/v1/applications/{current.id}/previous",
            headers=_auth(admin_token_tenant_b),
        )

        assert resp.status_code == 404

    def test_requires_authentication(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        human = _make_human(db, tenant_a)
        popup = _make_popup(db, tenant_a, "Unauthenticated Popup")
        current = _make_application(db, tenant_a, popup, human)

        resp = client.get(f"/api/v1/applications/{current.id}/previous")

        assert resp.status_code in (401, 403)

    def test_unknown_application_returns_404(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get(
            f"/api/v1/applications/{uuid.uuid4()}/previous",
            headers=_auth(admin_token_tenant_a),
        )

        assert resp.status_code == 404
