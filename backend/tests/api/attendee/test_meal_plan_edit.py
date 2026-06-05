"""HTTP tests for PATCH .../tickets/{ticket_id}/meal-plan (post-purchase edit).

Covers editing a purchased meal-plan ticket's choices (daily_choices,
dietary_restriction, special_request) for a week whose sale window is still
open, while:
  - locking weeks whose sale has ended (409 meal_plan_week_locked),
  - rejecting non-meal-plan tickets (422 not_meal_plan_ticket),
  - rejecting invalid menu keys / out-of-coverage dates (422),
  - enforcing the dual-path ownership predicate (404, never 403),
  - leaving the payment_products financial snapshot intact (receipt diverges).

The meal-plan config is supplied by a TicketingSteps row with
template="meal-plan-select" whose section product matches the meal-plan Product.
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.crud import generate_check_in_code
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.payment.models import PaymentProducts, Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps
from app.core.security import create_access_token

# Week 1 coverage: 2026-06-01 (Mon) .. 2026-06-05 (Fri) — all weekdays.
COVERAGE_START = "2026-06-01"
COVERAGE_END = "2026-06-05"

ORIGINAL_METADATA = {
    "daily_choices": {
        "2026-06-01": "veggie",
        "2026-06-02": "chicken",
        "2026-06-03": "chef",
        "2026-06-04": "pasta",
        "2026-06-05": "fish",
    },
    "dietary_restriction": "gluten-free",
    "special_request": "Earlier dinners please",
}

NEW_CHOICES = {
    "daily_choices": {
        "2026-06-01": "chicken",
        "2026-06-02": "chicken",
        "2026-06-03": "veggie",
        "2026-06-04": "fish",
        "2026-06-05": "chef",
    },
    "dietary_restriction": "vegan",
    "special_request": "No nuts",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _auth(human: Humans) -> dict[str, str]:
    token = create_access_token(subject=human.id, token_type="human")
    return {"Authorization": f"Bearer {token}"}


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"mp-edit-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_popup(db: Session, tenant: Tenants, *, suffix: str) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"MP-Edit Popup {suffix}",
        slug=f"mp-edit-{suffix}-{uuid.uuid4().hex[:6]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_product(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    suffix: str,
    category: str = "meal_plan",
    sale_ends_at: datetime | None = None,
) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Week 1 Meal Plan {suffix}",
        slug=f"mp-prod-{suffix}-{uuid.uuid4().hex[:6]}",
        price=Decimal("75"),
        category=category,
        is_active=True,
        sale_ends_at=sale_ends_at,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_meal_plan_step(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    product: Products,
) -> TicketingSteps:
    step = TicketingSteps(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        step_type="meal_plan",
        title="Meal Plan",
        template="meal-plan-select",
        is_enabled=True,
        template_config={
            "chef_choice_option": {"key": "chef", "title": "Chef's choice"},
            "sections": [
                {
                    "key": "weekly",
                    "label": "Weekly",
                    "order": 0,
                    "products": [
                        {
                            "product_id": str(product.id),
                            "coverage_start": COVERAGE_START,
                            "coverage_end": COVERAGE_END,
                            "menu_options": [
                                {"key": "veggie", "title": "Veggie"},
                                {"key": "chicken", "title": "Chicken"},
                                {"key": "pasta", "title": "Pasta"},
                                {"key": "fish", "title": "Fish"},
                            ],
                        }
                    ],
                }
            ],
        },
    )
    db.add(step)
    db.commit()
    db.refresh(step)
    return step


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
    human: Humans,
    application: Applications | None,
) -> Attendees:
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        application_id=application.id if application else None,
        name="Meal Planner",
        category="main",
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
    *,
    payment_id: uuid.UUID | None = None,
    metadata: dict | None = None,
) -> AttendeeProducts:
    ap = AttendeeProducts(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        attendee_id=attendee.id,
        product_id=product.id,
        check_in_code=generate_check_in_code("MP"),
        payment_id=payment_id,
        purchase_metadata=metadata,
    )
    db.add(ap)
    db.commit()
    db.refresh(ap)
    return ap


def _make_payment_with_snapshot(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    attendee: Attendees,
    product: Products,
    metadata: dict,
) -> tuple[Payments, PaymentProducts]:
    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        amount=Decimal("75"),
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    pp = PaymentProducts(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        payment_id=payment.id,
        product_id=product.id,
        attendee_id=attendee.id,
        product_name=product.name,
        product_price=product.price,
        product_category=product.category or "meal_plan",
        purchase_metadata=metadata,
    )
    db.add(pp)
    db.commit()
    db.refresh(pp)
    return payment, pp


def _future() -> datetime:
    return datetime.now(UTC) + timedelta(days=365)


def _past() -> datetime:
    return datetime.now(UTC) - timedelta(days=365)


def _patch(client: TestClient, popup, attendee, ticket, human, body: dict):
    return client.patch(
        f"/api/v1/attendees/my/popup/{popup.id}/{attendee.id}"
        f"/tickets/{ticket.id}/meal-plan",
        headers=_auth(human),
        json=body,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestMealPlanTicketEdit:
    def test_happy_path_future_week_updates_and_keeps_snapshot(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Future week → 200, ticket metadata replaced, payment snapshot intact."""
        popup = _make_popup(db, tenant_a, suffix="happy")
        human = _make_human(db, tenant_a, suffix="happy")
        product = _make_product(
            db, tenant_a, popup, suffix="happy", sale_ends_at=_future()
        )
        _make_meal_plan_step(db, tenant_a, popup, product)
        app = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, human, app)
        payment, pp = _make_payment_with_snapshot(
            db, tenant_a, popup, attendee, product, ORIGINAL_METADATA
        )
        ticket = _make_ticket(
            db,
            tenant_a,
            attendee,
            product,
            payment_id=payment.id,
            metadata=ORIGINAL_METADATA,
        )

        response = _patch(client, popup, attendee, ticket, human, NEW_CHOICES)

        assert response.status_code == 200, response.text
        # Ticket metadata replaced.
        db.refresh(ticket)
        assert ticket.purchase_metadata["daily_choices"] == NEW_CHOICES["daily_choices"]
        assert ticket.purchase_metadata["dietary_restriction"] == "vegan"
        assert ticket.purchase_metadata["special_request"] == "No nuts"
        # Receipt snapshot is untouched (intentional divergence).
        db.refresh(pp)
        assert pp.purchase_metadata == ORIGINAL_METADATA

    def test_locked_week_returns_409(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """sale_ends_at in the past → 409 meal_plan_week_locked, metadata intact."""
        popup = _make_popup(db, tenant_a, suffix="locked")
        human = _make_human(db, tenant_a, suffix="locked")
        product = _make_product(
            db, tenant_a, popup, suffix="locked", sale_ends_at=_past()
        )
        _make_meal_plan_step(db, tenant_a, popup, product)
        app = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, human, app)
        ticket = _make_ticket(
            db, tenant_a, attendee, product, metadata=ORIGINAL_METADATA
        )

        response = _patch(client, popup, attendee, ticket, human, NEW_CHOICES)

        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "meal_plan_week_locked"
        db.refresh(ticket)
        assert ticket.purchase_metadata == ORIGINAL_METADATA

    def test_null_sale_ends_at_is_editable(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """sale_ends_at = None → on_sale → editable (documents the NULL decision)."""
        popup = _make_popup(db, tenant_a, suffix="null")
        human = _make_human(db, tenant_a, suffix="null")
        product = _make_product(db, tenant_a, popup, suffix="null", sale_ends_at=None)
        _make_meal_plan_step(db, tenant_a, popup, product)
        app = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, human, app)
        ticket = _make_ticket(
            db, tenant_a, attendee, product, metadata=ORIGINAL_METADATA
        )

        response = _patch(client, popup, attendee, ticket, human, NEW_CHOICES)

        assert response.status_code == 200, response.text

    def test_invalid_menu_key_returns_422(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A value not in menu_options nor 'chef' → 422."""
        popup = _make_popup(db, tenant_a, suffix="badkey")
        human = _make_human(db, tenant_a, suffix="badkey")
        product = _make_product(
            db, tenant_a, popup, suffix="badkey", sale_ends_at=_future()
        )
        _make_meal_plan_step(db, tenant_a, popup, product)
        app = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, human, app)
        ticket = _make_ticket(
            db, tenant_a, attendee, product, metadata=ORIGINAL_METADATA
        )

        body = {**NEW_CHOICES, "daily_choices": {COVERAGE_START: "sushi"}}
        response = _patch(client, popup, attendee, ticket, human, body)

        assert response.status_code == 422
        db.refresh(ticket)
        assert ticket.purchase_metadata == ORIGINAL_METADATA

    def test_out_of_coverage_date_returns_422(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A date outside coverage (Saturday) → 422."""
        popup = _make_popup(db, tenant_a, suffix="baddate")
        human = _make_human(db, tenant_a, suffix="baddate")
        product = _make_product(
            db, tenant_a, popup, suffix="baddate", sale_ends_at=_future()
        )
        _make_meal_plan_step(db, tenant_a, popup, product)
        app = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, human, app)
        ticket = _make_ticket(
            db, tenant_a, attendee, product, metadata=ORIGINAL_METADATA
        )

        # 2026-06-06 is a Saturday → not a covered weekday.
        body = {**NEW_CHOICES, "daily_choices": {"2026-06-06": "veggie"}}
        response = _patch(client, popup, attendee, ticket, human, body)

        assert response.status_code == 422

    def test_non_owner_returns_404(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A human who fails the ownership predicate → 404 (not 403)."""
        popup = _make_popup(db, tenant_a, suffix="nonowner")
        owner = _make_human(db, tenant_a, suffix="nonowner-owner")
        other = _make_human(db, tenant_a, suffix="nonowner-other")
        product = _make_product(
            db, tenant_a, popup, suffix="nonowner", sale_ends_at=_future()
        )
        _make_meal_plan_step(db, tenant_a, popup, product)
        app = _make_application(db, tenant_a, popup, owner)
        attendee = _make_attendee(db, tenant_a, popup, owner, app)
        ticket = _make_ticket(
            db, tenant_a, attendee, product, metadata=ORIGINAL_METADATA
        )

        response = _patch(client, popup, attendee, ticket, other, NEW_CHOICES)

        assert response.status_code == 404

    def test_non_meal_plan_ticket_returns_422(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Ticket whose product is not a meal-plan week → 422 not_meal_plan_ticket."""
        popup = _make_popup(db, tenant_a, suffix="notmp")
        human = _make_human(db, tenant_a, suffix="notmp")
        # A meal-plan step exists, but for a DIFFERENT product.
        mp_product = _make_product(
            db, tenant_a, popup, suffix="notmp-mp", sale_ends_at=_future()
        )
        _make_meal_plan_step(db, tenant_a, popup, mp_product)
        # The ticket points at a plain ticket product not in the step.
        other_product = _make_product(
            db,
            tenant_a,
            popup,
            suffix="notmp-tkt",
            category="ticket",
            sale_ends_at=_future(),
        )
        app = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, human, app)
        ticket = _make_ticket(
            db, tenant_a, attendee, other_product, metadata=ORIGINAL_METADATA
        )

        response = _patch(client, popup, attendee, ticket, human, NEW_CHOICES)

        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "not_meal_plan_ticket"
        db.refresh(ticket)
        assert ticket.purchase_metadata == ORIGINAL_METADATA

    def test_ticket_of_other_attendee_returns_404(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """ticket_id belonging to a different attendee → 404."""
        popup = _make_popup(db, tenant_a, suffix="otheratt")
        human = _make_human(db, tenant_a, suffix="otheratt")
        product = _make_product(
            db, tenant_a, popup, suffix="otheratt", sale_ends_at=_future()
        )
        _make_meal_plan_step(db, tenant_a, popup, product)
        app = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, human, app)
        # A second attendee (also owned by the human) holds the real ticket.
        other_attendee = _make_attendee(db, tenant_a, popup, human, app)
        ticket = _make_ticket(
            db, tenant_a, other_attendee, product, metadata=ORIGINAL_METADATA
        )

        # Address the ticket via the wrong attendee in the path.
        response = _patch(client, popup, attendee, ticket, human, NEW_CHOICES)

        assert response.status_code == 404
        # Ensure the real ticket is untouched.
        real = db.exec(
            select(AttendeeProducts).where(AttendeeProducts.id == ticket.id)
        ).first()
        assert real.purchase_metadata == ORIGINAL_METADATA
