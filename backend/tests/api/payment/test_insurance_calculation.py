"""Tests for the refactored _calculate_insurance (POPUP-6).

Pure unit tests against `calculate_insurance_amount` — a pure function extracted
from PaymentsCRUD that uses popup.insurance_percentage and product.insurance_eligible.

Scenarios (POPUP-6):
  - eligible-only filter: non-eligible products excluded from calc
  - disabled popup → 0
  - null pct → 0
  - no eligible products → 0
  - correct amount when enabled with eligible products

HTTP-level integration tests (POPUP-6 Scenario 5):
  - POST /api/v1/payments/my/preview with insurance=True verifies that the
    insurance_amount in the response equals popup.insurance_percentage × eligible subtotal.
"""
import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.payment.crud import calculate_insurance_amount
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.core.security import create_access_token


class _FakeProduct:
    """Minimal product stand-in for pure-function tests."""

    def __init__(
        self,
        *,
        price: str,
        insurance_eligible: bool,
    ) -> None:
        self.price = Decimal(price)
        self.insurance_eligible = insurance_eligible


class _FakePopup:
    """Minimal popup stand-in for pure-function tests."""

    def __init__(
        self,
        *,
        insurance_enabled: bool,
        insurance_percentage: str | None,
    ) -> None:
        self.insurance_enabled = insurance_enabled
        self.insurance_percentage = (
            Decimal(insurance_percentage) if insurance_percentage is not None else None
        )


class TestCalculateInsuranceAmount:
    def test_only_eligible_products_included(self) -> None:
        """POPUP-6: non-eligible products are excluded from the insurance total."""
        popup = _FakePopup(insurance_enabled=True, insurance_percentage="5.00")
        products = [
            (_FakeProduct(price="100.00", insurance_eligible=True), 1),
            (_FakeProduct(price="200.00", insurance_eligible=False), 1),
        ]
        # 5% of 100 only = 5.00
        result = calculate_insurance_amount(popup, products)
        assert result == Decimal("5.00")

    def test_disabled_popup_returns_zero(self) -> None:
        """POPUP-6: insurance_enabled=False → 0 regardless of products."""
        popup = _FakePopup(insurance_enabled=False, insurance_percentage="10.00")
        products = [
            (_FakeProduct(price="200.00", insurance_eligible=True), 2),
        ]
        result = calculate_insurance_amount(popup, products)
        assert result == Decimal("0")

    def test_null_percentage_returns_zero(self) -> None:
        """POPUP-6: insurance_enabled=True but pct=null (data inconsistency) → 0."""
        popup = _FakePopup(insurance_enabled=True, insurance_percentage=None)
        products = [
            (_FakeProduct(price="100.00", insurance_eligible=True), 1),
        ]
        result = calculate_insurance_amount(popup, products)
        assert result == Decimal("0")

    def test_no_eligible_products_returns_zero(self) -> None:
        """POPUP-6: all products are non-eligible → 0."""
        popup = _FakePopup(insurance_enabled=True, insurance_percentage="5.00")
        products = [
            (_FakeProduct(price="300.00", insurance_eligible=False), 3),
        ]
        result = calculate_insurance_amount(popup, products)
        assert result == Decimal("0")

    def test_correct_amount_with_eligible_products(self) -> None:
        """POPUP-6: 10% of eligible subtotal (quantity considered)."""
        popup = _FakePopup(insurance_enabled=True, insurance_percentage="10.00")
        products = [
            (_FakeProduct(price="200.00", insurance_eligible=True), 1),
        ]
        # 10% of 200 = 20.00
        result = calculate_insurance_amount(popup, products)
        assert result == Decimal("20.00")

    def test_eligible_subtotal_respects_quantity(self) -> None:
        """POPUP-6: quantity multiplies price for eligible subtotal."""
        popup = _FakePopup(insurance_enabled=True, insurance_percentage="5.00")
        products = [
            (_FakeProduct(price="100.00", insurance_eligible=True), 3),
            # 3 × 100 = 300; 5% = 15.00
        ]
        result = calculate_insurance_amount(popup, products)
        assert result == Decimal("15.00")


# ---------------------------------------------------------------------------
# HTTP-level integration test: POPUP-6 Scenario 5
# ---------------------------------------------------------------------------


def _make_insurance_popup(db: Session, tenant: Tenants) -> Popups:
    """Create a popup with insurance_enabled=true and insurance_percentage=5.00."""
    popup = Popups(
        name=f"Insurance HTTP Test {uuid.uuid4().hex[:8]}",
        slug=f"insurance-http-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        insurance_enabled=True,
        insurance_percentage=Decimal("5.00"),
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
    name: str,
    price: str,
    insurance_eligible: bool,
) -> Products:
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=name,
        slug=f"{name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:6]}",
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
        email=f"insurance-http-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Insurance",
        last_name="Tester",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_application(
    db: Session, tenant: Tenants, popup: Popups, human: Humans
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
        name="Insurance Tester",
        category="main",
        email=human.email,
        check_in_code=f"INS{uuid.uuid4().hex[:6].upper()}",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


class TestInsuranceCalculationHttp:
    """POPUP-6 Scenario 5: HTTP-level test for application-flow payment insurance_amount.

    Uses POST /api/v1/payments/my/preview which runs the full calculation pipeline
    (application → popup → products → _calculate_insurance) and returns insurance_amount
    without requiring a SimpleFI API key or network call.
    """

    def test_preview_payment_insurance_amount_uses_eligible_products_only(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """POPUP-6 Scenario 5: insurance_amount = popup.insurance_percentage × eligible subtotal.

        Setup:
          - popup.insurance_enabled=True, popup.insurance_percentage=5.00
          - product_a: price=100.00, insurance_eligible=True
          - product_b: price=50.00, insurance_eligible=False
          - one attendee, both products in the payment request, insurance=True

        Expected: insurance_amount = 5% × 100.00 = 5.00 (product_b excluded).
        """
        popup = _make_insurance_popup(db, tenant_a)
        product_eligible = _make_product(
            db,
            tenant_a,
            popup,
            name="Eligible Product",
            price="100.00",
            insurance_eligible=True,
        )
        product_not_eligible = _make_product(
            db,
            tenant_a,
            popup,
            name="Non-Eligible Product",
            price="50.00",
            insurance_eligible=False,
        )
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        attendee = _make_attendee(db, tenant_a, popup, application, human)

        human_token = create_access_token(subject=human.id, token_type="human")
        headers = {"Authorization": f"Bearer {human_token}"}

        response = client.post(
            "/api/v1/payments/my/preview",
            headers=headers,
            json={
                "application_id": str(application.id),
                "products": [
                    {
                        "product_id": str(product_eligible.id),
                        "attendee_id": str(attendee.id),
                        "quantity": 1,
                    },
                    {
                        "product_id": str(product_not_eligible.id),
                        "attendee_id": str(attendee.id),
                        "quantity": 1,
                    },
                ],
                "insurance": True,
            },
        )

        assert response.status_code == 200, response.text
        data = response.json()

        # 5% of $100 (eligible only) = $5.00; non-eligible $50 excluded
        assert Decimal(data["insurance_amount"]) == Decimal("5.00"), (
            f"Expected insurance_amount=5.00 but got {data['insurance_amount']}. "
            "Non-eligible product must not contribute to the insurance subtotal."
        )
