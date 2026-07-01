"""Integration tests for _maybe_grant_fee_credit (TDD — RED first).

Covers:
  T-05: grant once on ACCEPTED application with approved fee payment
  T-06: idempotency — second call is a no-op (no double-grant)
  T-07: rejected application is a no-op (no grant)
  T-07: popup without requires_application_fee is a no-op
  T-07: approved fee + not-accepted status is a no-op
"""

import uuid
from decimal import Decimal

from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.audit_log.constants import AuditAction, AuditEntityType
from app.api.audit_log.models import AuditLog
from app.api.human.models import Humans
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus, PaymentType
from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    requires_application_fee: bool = True,
    application_fee_amount: Decimal = Decimal("50.00"),
) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Fee Credit Popup {uuid.uuid4().hex[:6]}",
        slug=f"fc-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
        requires_application_fee=requires_application_fee,
        application_fee_amount=application_fee_amount
        if requires_application_fee
        else None,
    )
    db.add(popup)
    db.flush()
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    suffix = uuid.uuid4().hex[:8]
    human = Humans(
        tenant_id=tenant.id,
        email=f"fc-{suffix}@test.com",
        first_name="Fee",
        last_name="Credit",
    )
    db.add(human)
    db.flush()
    return human


def _make_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    status: str = ApplicationStatus.ACCEPTED.value,
    credit: Decimal = Decimal("0"),
    fee_credit_granted: bool = False,
) -> Applications:
    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=status,
        credit=credit,
        fee_credit_granted=fee_credit_granted,
    )
    db.add(application)
    db.flush()
    return application


def _make_fee_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    application: Applications,
    *,
    status: str = PaymentStatus.APPROVED.value,
    amount: Decimal = Decimal("50.00"),
) -> Payments:
    payment = Payments(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        payment_type=PaymentType.APPLICATION_FEE.value,
        status=status,
        amount=amount,
        currency="USD",
        external_id=f"sf-fee-{uuid.uuid4().hex[:8]}",
    )
    db.add(payment)
    db.flush()
    return payment


def _credit_granted_audit_entries(db: Session, human_id: uuid.UUID) -> list[AuditLog]:
    db.expire_all()
    return list(
        db.exec(
            select(AuditLog).where(
                AuditLog.entity_type == AuditEntityType.HUMAN,
                AuditLog.entity_id == human_id,
                AuditLog.action == AuditAction.CREDIT_GRANTED,
            )
        ).all()
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestMaybeGrantFeeCredit:
    """T-05, T-06, T-07: _maybe_grant_fee_credit unit-level integration tests."""

    def test_grant_on_accepted_with_approved_fee(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """T-05: ACCEPTED application + APPROVED fee → credit increases by fee amount, audit log written."""
        from app.api.application.crud import _maybe_grant_fee_credit

        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        _make_fee_payment(db, tenant_a, popup, application, amount=Decimal("50.00"))

        _maybe_grant_fee_credit(db, application)
        db.commit()
        db.expire_all()
        db.refresh(application)

        assert application.credit == Decimal("50.00")
        assert application.fee_credit_granted is True

        entries = _credit_granted_audit_entries(db, human.id)
        assert len(entries) == 1
        assert entries[0].details["source"] == "application_fee"
        assert Decimal(entries[0].details["amount"]) == Decimal("50.00")

    def test_idempotent_second_call_is_noop(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """T-06: Second call with fee_credit_granted=True is a no-op (no double-grant)."""
        from app.api.application.crud import _maybe_grant_fee_credit

        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(
            db, tenant_a, popup, human, credit=Decimal("50.00"), fee_credit_granted=True
        )
        _make_fee_payment(db, tenant_a, popup, application, amount=Decimal("50.00"))

        # Second call — must be no-op
        _maybe_grant_fee_credit(db, application)
        db.commit()
        db.expire_all()
        db.refresh(application)

        # Credit must remain unchanged
        assert application.credit == Decimal("50.00")
        # No new audit entry written
        entries = _credit_granted_audit_entries(db, human.id)
        assert len(entries) == 0

    def test_rejected_application_is_noop(self, db: Session, tenant_a: Tenants) -> None:
        """T-07: REJECTED application — no grant even if fee is approved."""
        from app.api.application.crud import _maybe_grant_fee_credit

        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(
            db, tenant_a, popup, human, status=ApplicationStatus.REJECTED.value
        )
        _make_fee_payment(db, tenant_a, popup, application, amount=Decimal("50.00"))

        _maybe_grant_fee_credit(db, application)
        db.commit()
        db.expire_all()
        db.refresh(application)

        assert application.credit == Decimal("0")
        assert application.fee_credit_granted is False
        assert len(_credit_granted_audit_entries(db, human.id)) == 0

    def test_popup_without_fee_requirement_is_noop(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """T-07: Popup with requires_application_fee=False → no grant."""
        from app.api.application.crud import _maybe_grant_fee_credit

        popup = _make_popup(db, tenant_a, requires_application_fee=False)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)

        _maybe_grant_fee_credit(db, application)
        db.commit()
        db.expire_all()
        db.refresh(application)

        assert application.credit == Decimal("0")
        assert application.fee_credit_granted is False

    def test_pending_fee_payment_is_noop(self, db: Session, tenant_a: Tenants) -> None:
        """T-07: Fee payment exists but is still PENDING — no grant yet."""
        from app.api.application.crud import _maybe_grant_fee_credit

        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)
        _make_fee_payment(
            db, tenant_a, popup, application, status=PaymentStatus.PENDING.value
        )

        _maybe_grant_fee_credit(db, application)
        db.commit()
        db.expire_all()
        db.refresh(application)

        assert application.credit == Decimal("0")
        assert application.fee_credit_granted is False
        assert len(_credit_granted_audit_entries(db, human.id)) == 0
