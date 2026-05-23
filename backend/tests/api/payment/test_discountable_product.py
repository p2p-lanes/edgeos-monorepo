"""Tests for the per-product `discountable` flag.

Products with `discountable=False` should be routed to the non-discountable
bucket by `_calculate_amounts`, and `_calculate_price` must charge them at
full price regardless of the discount value.
"""

import uuid
from decimal import Decimal

import pytest
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.payment.crud import _calculate_amounts, _calculate_price
from app.api.payment.schemas import PaymentProductRequest
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants


@pytest.fixture(scope="module")
def human_for_discountable(db: Session, tenant_a: Tenants) -> Humans:
    email = f"discountable-test-{uuid.uuid4().hex[:8]}@test.com"
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        email=email,
        first_name="Discountable",
        last_name="Tester",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name="Discountable Test",
        slug=f"discountable-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.application.value,
        status="active",
        simplefi_api_key="simplefi_test_key",
        currency="USD",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_product(
    db: Session,
    popup: Popups,
    *,
    price: str,
    discountable: bool,
    category: str = "ticket",
) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"Product {category}",
        slug=f"{category}-{uuid.uuid4().hex[:6]}",
        price=Decimal(price),
        category=category,
        is_active=True,
        discountable=discountable,
    )
    db.add(product)
    db.flush()
    return product


def _make_application_and_attendee(
    db: Session, popup: Popups, human: Humans
) -> tuple[Applications, Attendees]:
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.flush()
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        application_id=application.id,
        email=human.email,
        name=f"{human.first_name} {human.last_name}",
        category="main",
    )
    db.add(attendee)
    db.flush()
    return application, attendee


class TestCalculateAmounts:
    def test_routes_non_discountable_product_to_dedicated_bucket(
        self, db: Session, tenant_a: Tenants, human_for_discountable: Humans
    ) -> None:
        """Discountable=False products go to non_discountable, not standard."""
        popup = _make_popup(db, tenant_a)
        standard_product = _make_product(db, popup, price="100", discountable=True)
        mandatory_product = _make_product(db, popup, price="50", discountable=False)
        _, attendee = _make_application_and_attendee(
            db, popup, human_for_discountable
        )
        db.commit()
        try:
            requested = [
                PaymentProductRequest(
                    product_id=standard_product.id,
                    attendee_id=attendee.id,
                    quantity=1,
                ),
                PaymentProductRequest(
                    product_id=mandatory_product.id,
                    attendee_id=attendee.id,
                    quantity=2,
                ),
            ]
            standard, non_discountable = _calculate_amounts(db, requested)
            assert standard == Decimal("100")
            assert non_discountable == Decimal("100")  # 50 * 2
        finally:
            db.delete(attendee)
            db.rollback()

    def test_patreon_donation_lands_in_non_discountable_bucket(
        self, db: Session, tenant_a: Tenants, human_for_discountable: Humans
    ) -> None:
        """Patreon donations route through non-discountable (unit_price_override)."""
        popup = _make_popup(db, tenant_a)
        # discountable defaults to false on patreon (forced by schema validator).
        patron = _make_product(
            db, popup, price="0", discountable=False, category="patreon"
        )
        _, attendee = _make_application_and_attendee(
            db, popup, human_for_discountable
        )
        db.commit()
        try:
            requested = [
                PaymentProductRequest(
                    product_id=patron.id,
                    attendee_id=attendee.id,
                    quantity=1,
                    unit_price_override=Decimal("1500"),
                ),
            ]
            standard, non_discountable = _calculate_amounts(db, requested)
            # Donation amount comes from unit_price_override, not product.price.
            assert non_discountable == Decimal("1500")
            assert standard == Decimal("0")
        finally:
            db.delete(attendee)
            db.rollback()


class TestCalculatePrice:
    def test_non_discountable_amount_bypasses_discount(self) -> None:
        """A 100% discount must not reduce the non_discountable bucket."""
        from types import SimpleNamespace

        application = SimpleNamespace(
            id=uuid.uuid4(),
            scholarship_status=None,
            discount_percentage=None,
            credit=None,
            group=None,
        )

        result = _calculate_price(
            standard_amount=Decimal("100"),
            non_discountable_amount=Decimal("50"),
            discount_value=Decimal("100"),
            application=application,  # type: ignore[arg-type]
            edit_passes=False,
        )
        # Standard discounted to 0, non_discountable still charged at 50.
        assert result == Decimal("50")

    def test_partial_discount_only_affects_standard(self) -> None:
        """50% off the standard side; non_discountable stays full."""
        from types import SimpleNamespace

        application = SimpleNamespace(
            id=uuid.uuid4(),
            scholarship_status=None,
            discount_percentage=None,
            credit=None,
            group=None,
        )

        result = _calculate_price(
            standard_amount=Decimal("200"),
            non_discountable_amount=Decimal("50"),
            discount_value=Decimal("50"),
            application=application,  # type: ignore[arg-type]
            edit_passes=False,
        )
        # 200 * 0.5 + 50 = 150
        assert result == Decimal("150")
