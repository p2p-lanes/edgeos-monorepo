"""Integration tests for create_payment with installment plans enabled.

Pin the cross-feature wire-format and persistence behavior end-to-end:
  - SimpleFi gets the right max_installments / interval / total_amount
  - Payment row carries is_installment_plan, installments_paid=0,
    installments_total=NULL (until the activation webhook lands)
  - contribution_amount flows through to the Payment row alongside the
    installment-plan fields (catches a future drop in either feature)
  - edit_passes forces one-shot regardless of popup config
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentCreate, PaymentProductRequest
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import InstallmentInterval, SaleType
from app.api.tenant.models import Tenants

# ---- Helpers ----------------------------------------------------------------


def _make_popup_with_installments(
    db: Session,
    tenant: Tenants,
    *,
    installments_enabled: bool = True,
    installments_max: int | None = 6,
    deadline_months_ahead: int = 6,
    contribution_enabled: bool = False,
    contribution_percentage: Decimal | None = None,
) -> Popups:
    """Build a popup ready to exercise the installments flow.

    Default fixture: monthly installments, max 6, 6-month deadline window so
    _calculate_max_installments returns 6 cycles (not clamped). When
    contribution_enabled is True we also flip on a percentage fee so the
    SimpleFi total_amount includes it.
    """
    deadline = (
        datetime.now(UTC).replace(day=1) + timedelta(days=30 * deadline_months_ahead)
        if installments_enabled
        else None
    )
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Installments Test {uuid.uuid4().hex[:6]}",
        slug=f"inst-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.application.value,
        status="active",
        simplefi_api_key="simplefi_test_key",
        currency="USD",
        installments_enabled=installments_enabled,
        installments_deadline=deadline,
        installments_max=installments_max if installments_enabled else None,
        installments_interval=InstallmentInterval.month.value,
        installments_interval_count=1,
        contribution_enabled=contribution_enabled,
        contribution_percentage=contribution_percentage,
    )
    db.add(popup)
    db.flush()
    return popup


def _make_ticket(db: Session, popup: Popups, price: str = "600") -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name="General Admission",
        slug=f"ga-{uuid.uuid4().hex[:6]}",
        price=Decimal(price),
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.flush()
    return product


def _make_application_with_attendee(
    db: Session, popup: Popups, human: Humans
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
        name="Buyer",
        email=human.email,
        category="main",
    )
    db.add(attendee)
    db.flush()
    return app, attendee


@pytest.fixture
def human_buyer(db: Session, tenant_a: Tenants) -> Humans:
    """Per-test Human so each test owns a fresh row (avoids cross-test leakage
    from the application/attendee fixtures we create below)."""
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        email=f"inst-buyer-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Installments",
        last_name="Buyer",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


# ---- Tests -----------------------------------------------------------------


class TestInstallmentsHappyPath:
    """A popup with installments enabled drives the /installment_plans branch."""

    def test_installments_enabled_routes_to_plan_endpoint(
        self, db: Session, tenant_a: Tenants, human_buyer: Humans
    ) -> None:
        """Popup config + payment creation → SimpleFi gets max_installments=6,
        month interval. The Payment row carries is_installment_plan=True,
        installments_paid=0, installments_total=None (until activation webhook).
        """
        popup = _make_popup_with_installments(db, tenant_a)
        product = _make_ticket(db, popup, price="600")
        application, attendee = _make_application_with_attendee(db, popup, human_buyer)
        db.commit()

        obj = PaymentCreate(
            application_id=application.id,
            products=[
                PaymentProductRequest(
                    product_id=product.id,
                    attendee_id=attendee.id,
                    quantity=1,
                )
            ],
        )

        sf_resp = SimpleNamespace(
            id="plan_happy_1",
            status="pending",
            checkout_url="https://sf.test/plan/plan_happy_1",
            is_installment_plan=True,
        )
        with patch("app.services.simplefi.get_simplefi_client") as mock_client:
            mock_create = mock_client.return_value.create_payment
            mock_create.return_value = sf_resp
            payment, _ = payments_crud.create_payment(db, obj)

        # Wire format: SimpleFi got max_installments and month/1 interval.
        _, call_kwargs = mock_create.call_args
        assert call_kwargs["max_installments"] == 6
        assert call_kwargs["installment_interval"] == "month"
        assert call_kwargs["installment_interval_count"] == 1
        assert call_kwargs["user_email"] == human_buyer.email
        assert call_kwargs["plan_name"] == popup.name
        assert call_kwargs["amount"] == Decimal("600")

        # Persistence: installment-plan markers written, total still NULL.
        assert payment.is_installment_plan is True
        assert payment.installments_paid == 0
        assert payment.installments_total is None
        assert payment.external_id == "plan_happy_1"


class TestInstallmentsWithContribution:
    """Cross-feature: contribution fee + installments coexist correctly.

    Pins the post-rebase invariant — the SimpleFi total_amount must include
    contribution, and the Payment row must carry both contribution_amount
    AND is_installment_plan.
    """

    def test_contribution_included_in_simplefi_total_and_payment_row(
        self, db: Session, tenant_a: Tenants, human_buyer: Humans
    ) -> None:
        # 10% contribution on a $600 ticket → preview.amount = 660.
        popup = _make_popup_with_installments(
            db,
            tenant_a,
            contribution_enabled=True,
            contribution_percentage=Decimal("10"),
        )
        product = _make_ticket(db, popup, price="600")
        application, attendee = _make_application_with_attendee(db, popup, human_buyer)
        db.commit()

        obj = PaymentCreate(
            application_id=application.id,
            products=[
                PaymentProductRequest(
                    product_id=product.id,
                    attendee_id=attendee.id,
                    quantity=1,
                )
            ],
        )

        preview = payments_crud.preview_payment(db, obj)
        assert preview.contribution_amount > 0
        assert preview.amount == Decimal("600") + preview.contribution_amount

        sf_resp = SimpleNamespace(
            id="plan_with_contribution_1",
            status="pending",
            checkout_url="https://sf.test/plan/with-contrib",
            is_installment_plan=True,
        )
        with patch("app.services.simplefi.get_simplefi_client") as mock_client:
            mock_create = mock_client.return_value.create_payment
            mock_create.return_value = sf_resp
            payment, _ = payments_crud.create_payment(db, obj)

        # SimpleFi total_amount must include contribution — buyer pays installments
        # on (subtotal + contribution), not on the bare subtotal.
        _, call_kwargs = mock_create.call_args
        assert call_kwargs["amount"] == preview.amount
        assert call_kwargs["amount"] > Decimal("600")
        assert call_kwargs["max_installments"] == 6

        # Both features land on the Payment row.
        assert payment.is_installment_plan is True
        assert payment.contribution_amount == preview.contribution_amount
        assert payment.amount == preview.amount


class TestEditPassesForcesOneShot:
    """edit_passes deltas are always one-shot, even when popup opts in to plans."""

    def test_edit_passes_with_installments_popup_skips_plan_endpoint(
        self, db: Session, tenant_a: Tenants, human_buyer: Humans
    ) -> None:
        """First, a completed plan exists on the application (so the guard
        doesn't trip). Then edit_passes=True with a fresh selection should
        call SimpleFi WITHOUT max_installments — forcing /payment_requests.
        """
        popup = _make_popup_with_installments(db, tenant_a)
        product = _make_ticket(db, popup, price="600")
        application, attendee = _make_application_with_attendee(db, popup, human_buyer)

        # Seed a COMPLETED installment plan (paid == total) on this application
        # so the guard doesn't block edit_passes — completed plans are finalized.
        completed_plan = Payments(
            id=uuid.uuid4(),
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            application_id=application.id,
            status="approved",
            amount=Decimal("600"),
            currency="USD",
            is_installment_plan=True,
            installments_total=6,
            installments_paid=6,
        )
        db.add(completed_plan)
        db.commit()

        obj = PaymentCreate(
            application_id=application.id,
            products=[
                PaymentProductRequest(
                    product_id=product.id,
                    attendee_id=attendee.id,
                    quantity=1,
                )
            ],
            edit_passes=True,
        )

        sf_resp = SimpleNamespace(
            id="pr_edit_passes_1",
            status="pending",
            checkout_url="https://sf.test/checkout/pr",
            is_installment_plan=False,
        )
        with patch("app.services.simplefi.get_simplefi_client") as mock_client:
            mock_create = mock_client.return_value.create_payment
            mock_create.return_value = sf_resp
            payment, _ = payments_crud.create_payment(db, obj)

        # edit_passes must override popup.installments_enabled — no max_installments.
        _, call_kwargs = mock_create.call_args
        assert call_kwargs.get("max_installments") is None

        # And the resulting Payment must NOT be marked as an installment plan.
        assert payment.is_installment_plan is False
