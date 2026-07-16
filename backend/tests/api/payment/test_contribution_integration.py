"""Integration tests for contribution fee wiring in _apply_discounts (TDD — RED first).

Scenarios covered:
  - SCN-01: contribution enabled → preview includes non-zero contribution_amount
  - SCN-02: contribution disabled → preview has contribution_amount=0
  - SCN-04: enabled + null percentage → contribution_amount=0
  - SCN-07: insurance + contribution both enabled → parallel fees, no compounding
  - SCN-08: Payments.contribution_amount column defaults to 0 when not set

SCN-08 note: The direct-sale / open-checkout flow uses create_open_ticketing_payment,
a separate code path from _apply_discounts. It DOES apply contribution — covered by
test_create_open_ticketing_payment.py::test_create_open_ticketing_payment_applies_contribution.
The test here only guards the column server_default (0, not NULL) for payments built
without an explicit contribution_amount.
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    contribution_enabled: bool = False,
    contribution_percentage: str | None = None,
    insurance_enabled: bool = False,
    insurance_percentage: str | None = None,
    sale_type: SaleType = SaleType.application,
) -> Popups:
    popup = Popups(
        name=f"Contribution Integration {uuid.uuid4().hex[:8]}",
        slug=f"contribution-integration-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        contribution_enabled=contribution_enabled,
        contribution_percentage=Decimal(contribution_percentage)
        if contribution_percentage
        else None,
        insurance_enabled=insurance_enabled,
        insurance_percentage=Decimal(insurance_percentage)
        if insurance_percentage
        else None,
        sale_type=sale_type,
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
    price: str,
    insurance_eligible: bool = True,
) -> Products:
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Product {uuid.uuid4().hex[:6]}",
        slug=f"product-{uuid.uuid4().hex[:6]}",
        price=Decimal(price),
        category="ticket",
        insurance_eligible=insurance_eligible,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"contribution-int-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Contribution",
        last_name="Tester",
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
) -> Applications:
    application = Applications(
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
    application: Applications,
    human: Humans,
) -> Attendees:
    attendee = Attendees(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        human_id=human.id,
        name="Contribution Tester",
        category="main",
        email=human.email,
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestContributionInApplyDiscounts:
    """Integration tests via POST /api/v1/payments/my/preview."""

    def test_contribution_enabled_preview_includes_contribution_amount(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """SCN-01: popup.contribution_enabled=True, 5%, product=$100 → contribution_amount=5.00."""
        popup = _make_popup(
            db,
            tenant_a,
            contribution_enabled=True,
            contribution_percentage="5.00",
        )
        product = _make_product(db, tenant_a, popup, price="100.00")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, application, human)

        token = create_access_token(subject=human.id, token_type="human")
        response = client.post(
            "/api/v1/payments/my/preview",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "application_id": str(application.id),
                "products": [
                    {
                        "product_id": str(product.id),
                        "attendee_id": str(attendee.id),
                        "quantity": 1,
                    }
                ],
            },
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert Decimal(data["contribution_amount"]) == Decimal("5.00"), (
            f"Expected contribution_amount=5.00, got {data.get('contribution_amount')}"
        )

    def test_contribution_disabled_preview_has_zero_contribution_amount(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """SCN-02: popup.contribution_enabled=False → contribution_amount=0."""
        popup = _make_popup(
            db,
            tenant_a,
            contribution_enabled=False,
        )
        product = _make_product(db, tenant_a, popup, price="100.00")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, application, human)

        token = create_access_token(subject=human.id, token_type="human")
        response = client.post(
            "/api/v1/payments/my/preview",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "application_id": str(application.id),
                "products": [
                    {
                        "product_id": str(product.id),
                        "attendee_id": str(attendee.id),
                        "quantity": 1,
                    }
                ],
            },
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert Decimal(data["contribution_amount"]) == Decimal("0"), (
            f"Expected contribution_amount=0, got {data.get('contribution_amount')}"
        )

    def test_contribution_enabled_null_percentage_returns_zero(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """SCN-04: enabled=True, percentage=null → contribution_amount=0."""
        popup = _make_popup(
            db,
            tenant_a,
            contribution_enabled=True,
            contribution_percentage=None,
        )
        product = _make_product(db, tenant_a, popup, price="100.00")
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, application, human)

        token = create_access_token(subject=human.id, token_type="human")
        response = client.post(
            "/api/v1/payments/my/preview",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "application_id": str(application.id),
                "products": [
                    {
                        "product_id": str(product.id),
                        "attendee_id": str(attendee.id),
                        "quantity": 1,
                    }
                ],
            },
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert Decimal(data["contribution_amount"]) == Decimal("0"), (
            f"Expected contribution_amount=0 with null percentage, got {data.get('contribution_amount')}"
        )

    def test_insurance_and_contribution_do_not_compound(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """SCN-07: Both insurance (5%) and contribution (3%) on $100 pre-fee snapshot.

        insurance_amount = 5% × 100 = 5.00 (eligible product × pct)
        contribution_amount = 3% × 100 = 3.00 (pre-fee snapshot × pct)
        grand total = 100 + 5 + 3 = 108.00
        Neither fee base includes the other fee.
        """
        popup = _make_popup(
            db,
            tenant_a,
            insurance_enabled=True,
            insurance_percentage="5.00",
            contribution_enabled=True,
            contribution_percentage="3.00",
        )
        # insurance_eligible=True so insurance also applies over the full product price
        product = _make_product(
            db, tenant_a, popup, price="100.00", insurance_eligible=True
        )
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, application, human)

        token = create_access_token(subject=human.id, token_type="human")
        response = client.post(
            "/api/v1/payments/my/preview",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "application_id": str(application.id),
                "products": [
                    {
                        "product_id": str(product.id),
                        "attendee_id": str(attendee.id),
                        "quantity": 1,
                    }
                ],
                "insurance": True,
            },
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert Decimal(data["insurance_amount"]) == Decimal("5.00"), (
            f"Expected insurance_amount=5.00, got {data.get('insurance_amount')}"
        )
        assert Decimal(data["contribution_amount"]) == Decimal("3.00"), (
            f"Expected contribution_amount=3.00, got {data.get('contribution_amount')}"
        )
        assert Decimal(data["amount"]) == Decimal("108.00"), (
            f"Expected grand total=108.00, got {data.get('amount')}"
        )


class TestContributionColumnDefault:
    """SCN-08: Payments.contribution_amount defaults to 0 when not explicitly set.

    Guards the column server_default so any flow that skips the contribution
    calculation (e.g. a contribution-disabled popup) yields 0 on the row rather
    than NULL. The open-checkout flow DOES apply contribution — see
    test_create_open_ticketing_payment.py.
    """

    def test_payments_model_has_zero_contribution_amount_by_default(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """SCN-08: Payments created without contribution_amount → defaults to 0.

        Validates the column server_default for payments built without an
        explicit contribution_amount.
        """
        from app.api.payment.models import Payments
        from app.api.payment.schemas import PaymentStatus

        popup = _make_popup(
            db,
            tenant_a,
            contribution_enabled=True,
            contribution_percentage="5.00",
            sale_type=SaleType.direct,
        )

        # Build Payments WITHOUT passing contribution_amount — the
        # server_default kicks in and the row lands at 0, not NULL.
        payment = Payments(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            status=PaymentStatus.PENDING.value,
            amount=Decimal("100.00"),
            currency="USD",
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)

        # contribution_amount must be 0 — not computed in direct-sale path
        assert payment.contribution_amount == Decimal("0"), (
            f"Direct-sale Payments row should have contribution_amount=0, "
            f"got {payment.contribution_amount}"
        )
