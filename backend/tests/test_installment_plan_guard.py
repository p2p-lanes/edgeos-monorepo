"""Tests for the in-progress installment-plan guard and helper.

We exercise ``PaymentsCRUD._get_in_progress_installment_plan`` directly against
the testcontainer DB because building the full create_payment graph (products,
attendees, validation, SimpleFi mocks) would dwarf the actual logic under test.
The full create_payment integration is covered separately in the API tests.

The guard rule from the design: block edit_passes when a payment exists with
  is_installment_plan = True
  AND status IN (pending, approved)
  AND (installments_total IS NULL OR installments_paid < installments_total)
"""

import uuid
from decimal import Decimal

from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name="Installment Guard Popup",
        slug=f"installment-guard-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_application(
    db: Session, tenant: Tenants, popup: Popups
) -> Applications:
    human = Humans(
        tenant_id=tenant.id,
        email=f"guard-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Guard",
        last_name="Tester",
    )
    db.add(human)
    db.flush()

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


def _make_payment(
    db: Session,
    *,
    tenant: Tenants,
    popup: Popups,
    application: Applications,
    status: PaymentStatus,
    is_installment_plan: bool,
    installments_total: int | None,
    installments_paid: int | None,
) -> Payments:
    payment = Payments(
        tenant_id=tenant.id,
        popup_id=popup.id,
        application_id=application.id,
        status=status.value,
        amount=Decimal("600.00"),
        currency="USD",
        is_installment_plan=is_installment_plan,
        installments_total=installments_total,
        installments_paid=installments_paid,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def test_no_payments_returns_none(db: Session, tenant_a: Tenants) -> None:
    popup = _make_popup(db, tenant_a)
    application = _make_application(db, tenant_a, popup)

    assert (
        payments_crud._get_in_progress_installment_plan(db, application.id) is None
    )


def test_non_installment_payment_does_not_block(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a)
    application = _make_application(db, tenant_a, popup)
    _make_payment(
        db,
        tenant=tenant_a,
        popup=popup,
        application=application,
        status=PaymentStatus.APPROVED,
        is_installment_plan=False,
        installments_total=None,
        installments_paid=None,
    )

    assert (
        payments_crud._get_in_progress_installment_plan(db, application.id) is None
    )


def test_pending_installment_plan_blocks(
    db: Session, tenant_a: Tenants
) -> None:
    """Plan created but buyer hasn't paid any installment yet → block."""
    popup = _make_popup(db, tenant_a)
    application = _make_application(db, tenant_a, popup)
    plan = _make_payment(
        db,
        tenant=tenant_a,
        popup=popup,
        application=application,
        status=PaymentStatus.PENDING,
        is_installment_plan=True,
        installments_total=None,
        installments_paid=0,
    )

    found = payments_crud._get_in_progress_installment_plan(db, application.id)
    assert found is not None
    assert found.id == plan.id


def test_partial_paid_plan_blocks(db: Session, tenant_a: Tenants) -> None:
    """Plan with 2/6 installments paid → block."""
    popup = _make_popup(db, tenant_a)
    application = _make_application(db, tenant_a, popup)
    plan = _make_payment(
        db,
        tenant=tenant_a,
        popup=popup,
        application=application,
        status=PaymentStatus.APPROVED,
        is_installment_plan=True,
        installments_total=6,
        installments_paid=2,
    )

    found = payments_crud._get_in_progress_installment_plan(db, application.id)
    assert found is not None
    assert found.id == plan.id


def test_completed_plan_does_not_block(
    db: Session, tenant_a: Tenants
) -> None:
    """Fully paid plan (paid == total) is finalized → do not block."""
    popup = _make_popup(db, tenant_a)
    application = _make_application(db, tenant_a, popup)
    _make_payment(
        db,
        tenant=tenant_a,
        popup=popup,
        application=application,
        status=PaymentStatus.APPROVED,
        is_installment_plan=True,
        installments_total=6,
        installments_paid=6,
    )

    assert (
        payments_crud._get_in_progress_installment_plan(db, application.id) is None
    )


def test_cancelled_plan_does_not_block(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a)
    application = _make_application(db, tenant_a, popup)
    _make_payment(
        db,
        tenant=tenant_a,
        popup=popup,
        application=application,
        status=PaymentStatus.CANCELLED,
        is_installment_plan=True,
        installments_total=6,
        installments_paid=2,
    )

    assert (
        payments_crud._get_in_progress_installment_plan(db, application.id) is None
    )


def test_rejected_and_expired_plans_do_not_block(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a)
    application = _make_application(db, tenant_a, popup)
    _make_payment(
        db,
        tenant=tenant_a,
        popup=popup,
        application=application,
        status=PaymentStatus.REJECTED,
        is_installment_plan=True,
        installments_total=None,
        installments_paid=0,
    )
    _make_payment(
        db,
        tenant=tenant_a,
        popup=popup,
        application=application,
        status=PaymentStatus.EXPIRED,
        is_installment_plan=True,
        installments_total=None,
        installments_paid=0,
    )

    assert (
        payments_crud._get_in_progress_installment_plan(db, application.id) is None
    )


def test_other_application_plan_does_not_block_unrelated(
    db: Session, tenant_a: Tenants
) -> None:
    """Helper must scope to application_id — a plan on another application
    must not be returned."""
    popup = _make_popup(db, tenant_a)
    application_one = _make_application(db, tenant_a, popup)
    application_two = _make_application(db, tenant_a, popup)

    _make_payment(
        db,
        tenant=tenant_a,
        popup=popup,
        application=application_one,
        status=PaymentStatus.APPROVED,
        is_installment_plan=True,
        installments_total=6,
        installments_paid=1,
    )

    assert (
        payments_crud._get_in_progress_installment_plan(db, application_two.id)
        is None
    )
