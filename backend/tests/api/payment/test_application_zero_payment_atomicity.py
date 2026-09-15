"""Application checkout validation and transaction-boundary regressions."""

import uuid
from decimal import Decimal
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import Engine
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.attendee.models import AttendeeProducts
from app.api.audit_log.constants import AuditAction
from app.api.audit_log.models import AuditLog
from app.api.coupon.models import Coupons
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentCreate, PaymentProductRequest, PaymentStatus
from app.api.tenant.models import Tenants
from tests.api.payment.test_credit_zero_branch import (
    _make_application,
    _make_attendee,
    _make_human,
    _make_popup,
    _make_product,
)


@pytest.fixture
def checkout(db: Session, tenant_a: Tenants):
    popup = _make_popup(db, tenant_a)
    popup.allows_coupons = True
    db.add(popup)
    human = _make_human(db, tenant_a)
    application = _make_application(db, tenant_a, popup, human, credit=Decimal("50"))
    attendee = _make_attendee(db, tenant_a, popup, application)
    product = _make_product(db, tenant_a, popup, price=Decimal("100"))
    coupon = Coupons(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=application.sales_flow_id,
        code="HALF",
        discount_value=50,
        max_uses=1,
        is_active=True,
    )
    db.add(coupon)
    db.commit()
    request = PaymentCreate(
        application_id=application.id,
        products=[
            PaymentProductRequest(product_id=product.id, attendee_id=attendee.id)
        ],
        coupon_code=coupon.code,
    )
    return request, coupon.id, human.id


def _credit_movements(session: Session, human_id: uuid.UUID):
    return session.exec(
        select(AuditLog).where(
            AuditLog.entity_id == human_id,
            AuditLog.action == AuditAction.CREDIT_APPLIED,
        )
    ).all()


def _assert_unsettled(
    session: Session,
    request: PaymentCreate,
    coupon_id: uuid.UUID,
    human_id: uuid.UUID,
) -> None:
    application = session.get(Applications, request.application_id)
    assert application is not None
    assert application.credit == Decimal("50")
    coupon = session.get(Coupons, coupon_id)
    assert coupon is not None
    assert coupon.current_uses == 0
    assert not _credit_movements(session, human_id)
    assert not session.exec(
        select(Payments).where(Payments.application_id == request.application_id)
    ).all()
    product_id = request.products[0].product_id
    assert not session.exec(
        select(PaymentProducts).where(PaymentProducts.product_id == product_id)
    ).all()
    assert not session.exec(
        select(AttendeeProducts).where(AttendeeProducts.product_id == product_id)
    ).all()


@pytest.mark.parametrize("quantity", [0, -1])
@pytest.mark.parametrize("edit_passes", [False, True])
def test_invalid_quantity_rejected_before_preview_or_writes(
    test_engine: Engine, checkout, quantity: int, edit_passes: bool
) -> None:
    request, coupon_id, human_id = checkout
    request.edit_passes = edit_passes
    request.products.append(
        request.products[0].model_copy(update={"quantity": quantity})
    )

    with (
        Session(test_engine) as session,
        patch.object(payments_crud, "preview_payment") as preview,
        patch.object(payments_crud, "supersede_pending_payments") as supersede,
    ):
        with pytest.raises(HTTPException) as exc:
            payments_crud.create_payment(session, request)
        assert exc.value.status_code == 422
        assert exc.value.detail == "Each product quantity must be at least 1."
        preview.assert_not_called()
        supersede.assert_not_called()
        _assert_unsettled(session, request, coupon_id, human_id)
        # Even a caller committing after validation cannot persist checkout writes.
        session.commit()

    with Session(test_engine) as verification:
        _assert_unsettled(verification, request, coupon_id, human_id)


@pytest.mark.parametrize("explicit_rollback", [False, True])
def test_fulfillment_failure_rolls_back_coupon_payment_and_credit(
    test_engine: Engine, checkout, explicit_rollback: bool
) -> None:
    request, coupon_id, human_id = checkout
    finalize = payments_crud._finalize_zero_amount_payment

    def fail_real_fulfillment(session, payment, products, **kwargs):
        coupon = session.get(Coupons, coupon_id)
        assert coupon is not None
        assert coupon.current_uses == 1
        application = session.get(Applications, request.application_id)
        assert application is not None
        assert application.credit == Decimal("0")
        assert len(_credit_movements(session, human_id)) == 1
        assert payment.status == PaymentStatus.APPROVED.value
        line = session.exec(
            select(PaymentProducts).where(PaymentProducts.payment_id == payment.id)
        ).one()
        # Inject inconsistent persisted input, then execute the real finalizer
        # and reconciler rather than substituting a mocked fulfillment exception.
        line.quantity = 0
        session.add(line)
        return finalize(session, payment, products, **kwargs)

    with (
        Session(test_engine) as session,
        patch.object(
            payments_crud,
            "_finalize_zero_amount_payment",
            side_effect=fail_real_fulfillment,
        ) as finalizer,
    ):
        with pytest.raises(HTTPException) as exc:
            payments_crud.create_payment(session, request)
        assert exc.value.detail == "Recipient could not be fulfilled"
        finalizer.assert_called_once()
        if explicit_rollback:
            session.rollback()
        # Otherwise Session.close() must roll back the entire unfinished checkout.

    with Session(test_engine) as verification:
        _assert_unsettled(verification, request, coupon_id, human_id)


def test_success_commits_coupon_payment_credit_and_pass_together(
    test_engine: Engine, checkout
) -> None:
    request, coupon_id, human_id = checkout
    with Session(test_engine) as session:
        payment, preview = payments_crud.create_payment(session, request)
        payment_id = payment.id
        assert preview.status == PaymentStatus.APPROVED.value

    with Session(test_engine) as verification:
        payment = verification.get(Payments, payment_id)
        assert payment is not None
        assert payment.status == PaymentStatus.APPROVED.value
        assert payment.amount == Decimal("0")
        assert payment.credit_applied == Decimal("50")
        assert payment.coupon_id == coupon_id
        coupon = verification.get(Coupons, coupon_id)
        assert coupon is not None
        assert coupon.current_uses == 1
        application = verification.get(Applications, request.application_id)
        assert application is not None
        assert application.credit == Decimal("0")
        assert len(_credit_movements(verification, human_id)) == 1
        line = verification.exec(
            select(PaymentProducts).where(PaymentProducts.payment_id == payment_id)
        ).one()
        unit = verification.exec(
            select(AttendeeProducts).where(AttendeeProducts.payment_id == payment_id)
        ).one()
        assert line.quantity == 1
        assert unit.payment_product_id == line.id
        assert unit.attendee_id == request.products[0].attendee_id
        assert unit.revoked_at is None
