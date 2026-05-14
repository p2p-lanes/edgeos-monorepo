"""Integration tests for patron payment creation.

Tests the full patron payment flow via PaymentsCRUD.create_payment,
verifying that effective_unit_price is persisted, validations fire, and
non-patreon rows are unaffected.

Spec: payments Delta — Requirement: unit_price_override + effective_unit_price
"""

import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud, resolve_patron_template_config
from app.api.payment.models import PaymentProducts
from app.api.payment.schemas import PaymentCreate, PaymentProductRequest
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps

# ---- Fixtures ---------------------------------------------------------------


@pytest.fixture(scope="module")
def human_tenant_a(db: Session, tenant_a: Tenants) -> Humans:
    """A Human record scoped to tenant_a for use in patron payment tests."""
    email = f"patron-test-{uuid.uuid4().hex[:8]}@test.com"
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        email=email,
        first_name="Patron",
        last_name="Tester",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


# ---- Helpers ----------------------------------------------------------------


def _make_popup(
    db: Session, tenant: Tenants, *, slug_prefix: str = "patron-test"
) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Patron Test {slug_prefix}",
        slug=f"{slug_prefix}-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.application.value,
        status="active",
        simplefi_api_key="simplefi_test_key",
        currency="USD",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_patreon_product(db: Session, popup: Popups) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name="Patron",
        slug=f"patron-{uuid.uuid4().hex[:6]}",
        price=Decimal("0"),
        category="patreon",
        is_active=True,
    )
    db.add(product)
    db.flush()
    return product


def _make_ticket_product(db: Session, popup: Popups, price: str = "3000") -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name="General Admission",
        slug=f"ticket-{uuid.uuid4().hex[:6]}",
        price=Decimal(price),
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.flush()
    return product


def _make_patron_step(
    db: Session,
    popup: Popups,
    *,
    minimum: int = 1000,
    presets: list[int] | None = None,
    allow_custom: bool = True,
) -> TicketingSteps:
    if presets is None:
        presets = [2500, 5000, 7500]
    step = TicketingSteps(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        step_type="patron",
        title="Patron",
        template="patron-preset",
        template_config={
            "minimum": minimum,
            "presets": presets,
            "allow_custom": allow_custom,
        },
        is_enabled=True,
        order=3,
    )
    db.add(step)
    db.flush()
    return step


def _make_application_with_attendee(
    db: Session,
    popup: Popups,
    human,
) -> tuple[Applications, Attendees]:
    app = Applications(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(app)
    db.flush()

    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        application_id=app.id,
        name="Test Attendee",
        email=human.email,
        category="main",
    )
    db.add(attendee)
    db.flush()
    return app, attendee


# ---- Tests ------------------------------------------------------------------


class TestResolvePatronTemplateConfig:
    """resolve_patron_template_config returns the active step config."""

    def test_returns_config_when_step_exists(
        self, db: Session, tenant_a, popup_tenant_a: Popups
    ) -> None:
        """Creates a step and verifies resolve finds it."""
        step = _make_patron_step(db, popup_tenant_a)
        try:
            result = resolve_patron_template_config(db, popup_tenant_a.id)
            assert result is not None
            assert result["minimum"] == 1000
        finally:
            db.delete(step)
            db.commit()

    def test_returns_none_when_no_step(self, db: Session, tenant_a) -> None:
        """Returns None for a popup with no patron step."""
        popup = _make_popup(db, tenant_a, slug_prefix="no-step")
        db.commit()
        try:
            result = resolve_patron_template_config(db, popup.id)
            assert result is None
        finally:
            db.delete(popup)
            db.commit()


class TestPatronPaymentCreation:
    """End-to-end tests for patron payment creation via CRUD."""

    def _setup_scenario(self, db, tenant_a, popup_tenant_a, human_tenant_a):
        """Create patreon product + patron step for the popup."""
        product = _make_patreon_product(db, popup_tenant_a)
        step = _make_patron_step(db, popup_tenant_a)
        application, attendee = _make_application_with_attendee(
            db, popup_tenant_a, human_tenant_a
        )
        db.commit()
        return product, step, application, attendee

    def test_patron_payment_persists_effective_unit_price(
        self, db: Session, tenant_a, popup_tenant_a: Popups, human_tenant_a
    ) -> None:
        """Patron payment stores effective_unit_price=5000, quantity=1, product_price=0.

        The donation amount comes from PaymentProductRequest.unit_price_override and
        becomes the preview total so SimpleFi is invoked normally. Without the
        unit_price_override path the preview would compute 0 and the zero-amount
        auto-approve branch would skip SimpleFi.
        """
        product, step, application, attendee = self._setup_scenario(
            db, tenant_a, popup_tenant_a, human_tenant_a
        )
        original_key = popup_tenant_a.simplefi_api_key
        popup_tenant_a.simplefi_api_key = "simplefi_test_key"
        db.add(popup_tenant_a)
        db.commit()
        try:
            obj = PaymentCreate(
                application_id=application.id,
                products=[
                    PaymentProductRequest(
                        product_id=product.id,
                        attendee_id=attendee.id,
                        quantity=1,
                        unit_price_override=Decimal("5000"),
                    )
                ],
            )

            # Donation amount drives the preview total; SimpleFi must be called.
            preview = payments_crud.preview_payment(db, obj)
            assert preview.amount == Decimal("5000")

            sf_resp = SimpleNamespace(
                id="sf_patron_test",
                status="pending",
                checkout_url="https://sf.test/patron",
            )
            with patch("app.services.simplefi.get_simplefi_client") as mock_client:
                mock_client.return_value.create_payment.return_value = sf_resp
                payment, _ = payments_crud.create_payment(db, obj)

            # Find the PaymentProducts row
            pp = db.exec(
                select(PaymentProducts).where(
                    PaymentProducts.payment_id == payment.id,
                    PaymentProducts.product_id == product.id,
                )
            ).first()
            assert pp is not None
            assert pp.quantity == 1
            assert pp.product_price == Decimal("0")
            assert pp.effective_unit_price == Decimal("5000")
            assert payment.amount == Decimal("5000")
        finally:
            popup_tenant_a.simplefi_api_key = original_key
            db.add(popup_tenant_a)
            try:
                for pp_row in db.exec(
                    select(PaymentProducts).where(
                        PaymentProducts.payment_id == payment.id
                    )
                ).all():
                    db.delete(pp_row)
                db.delete(payment)
            except UnboundLocalError:
                pass
            db.delete(attendee)
            db.delete(application)
            db.delete(step)
            db.delete(product)
            db.commit()

    def test_patron_payment_no_step_raises_422(
        self, db: Session, tenant_a, human_tenant_a
    ) -> None:
        """Patreon product but no patron step configured returns 422."""
        popup = _make_popup(db, tenant_a, slug_prefix="no-step-422")
        product = _make_patreon_product(db, popup)
        application, attendee = _make_application_with_attendee(
            db, popup, human_tenant_a
        )
        db.commit()
        try:
            obj = PaymentCreate(
                application_id=application.id,
                products=[
                    PaymentProductRequest(
                        product_id=product.id,
                        attendee_id=attendee.id,
                        quantity=1,
                        unit_price_override=Decimal("5000"),
                    )
                ],
            )
            with pytest.raises(HTTPException) as exc_info:
                payments_crud.create_payment(db, obj)
            assert exc_info.value.status_code == 422
            assert "patron" in exc_info.value.detail.lower()
        finally:
            db.delete(attendee)
            db.delete(application)
            db.delete(product)
            db.delete(popup)
            db.commit()

    def test_patron_payment_below_minimum_raises_422(
        self, db: Session, tenant_a, popup_tenant_a: Popups, human_tenant_a
    ) -> None:
        """unit_price_override below minimum raises 422."""
        product = _make_patreon_product(db, popup_tenant_a)
        step = _make_patron_step(db, popup_tenant_a, minimum=1000)
        application, attendee = _make_application_with_attendee(
            db, popup_tenant_a, human_tenant_a
        )
        db.commit()
        try:
            obj = PaymentCreate(
                application_id=application.id,
                products=[
                    PaymentProductRequest(
                        product_id=product.id,
                        attendee_id=attendee.id,
                        quantity=1,
                        unit_price_override=Decimal("999"),
                    )
                ],
            )
            with pytest.raises(HTTPException) as exc_info:
                payments_crud.create_payment(db, obj)
            assert exc_info.value.status_code == 422
        finally:
            db.delete(attendee)
            db.delete(application)
            db.delete(step)
            db.delete(product)
            db.commit()

    def test_unit_price_override_on_non_patreon_raises_422(
        self, db: Session, tenant_a, popup_tenant_a: Popups, human_tenant_a
    ) -> None:
        """unit_price_override on a non-patreon product raises 422."""
        product = _make_ticket_product(db, popup_tenant_a)
        application, attendee = _make_application_with_attendee(
            db, popup_tenant_a, human_tenant_a
        )
        db.commit()
        try:
            obj = PaymentCreate(
                application_id=application.id,
                products=[
                    PaymentProductRequest(
                        product_id=product.id,
                        attendee_id=attendee.id,
                        quantity=1,
                        unit_price_override=Decimal("5000"),
                    )
                ],
            )
            with pytest.raises(HTTPException) as exc_info:
                payments_crud.create_payment(db, obj)
            assert exc_info.value.status_code == 422
        finally:
            db.delete(attendee)
            db.delete(application)
            db.delete(product)
            db.commit()

    def test_patreon_quantity_not_one_raises_422(
        self, db: Session, tenant_a, popup_tenant_a: Popups, human_tenant_a
    ) -> None:
        """quantity != 1 for patreon product raises 422."""
        product = _make_patreon_product(db, popup_tenant_a)
        step = _make_patron_step(db, popup_tenant_a)
        application, attendee = _make_application_with_attendee(
            db, popup_tenant_a, human_tenant_a
        )
        db.commit()
        try:
            obj = PaymentCreate(
                application_id=application.id,
                products=[
                    PaymentProductRequest(
                        product_id=product.id,
                        attendee_id=attendee.id,
                        quantity=2,
                        unit_price_override=Decimal("5000"),
                    )
                ],
            )
            with pytest.raises(HTTPException) as exc_info:
                payments_crud.create_payment(db, obj)
            assert exc_info.value.status_code == 422
        finally:
            db.delete(attendee)
            db.delete(application)
            db.delete(step)
            db.delete(product)
            db.commit()
