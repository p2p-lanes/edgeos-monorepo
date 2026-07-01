"""Integration tests for credit restore on payment EXPIRE/CANCEL (TDD — RED first).

Covers T-03:
  - expire restores credit
  - cancel restores credit
  - double-expire is idempotent (no double-restore)
  - credit_applied=0 is not restored
"""

import uuid
from decimal import Decimal

from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.audit_log.constants import AuditAction, AuditEntityType
from app.api.audit_log.models import AuditLog
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Restore Test Popup {uuid.uuid4().hex[:6]}",
        slug=f"restore-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    suffix = uuid.uuid4().hex[:8]
    human = Humans(
        tenant_id=tenant.id,
        email=f"restore-{suffix}@test.com",
        first_name="Restore",
        last_name="Test",
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
    credit: Decimal = Decimal("0"),
) -> Applications:
    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
        credit=credit,
    )
    db.add(application)
    db.flush()
    return application


def _make_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    application: Applications,
) -> Attendees:
    suffix = uuid.uuid4().hex[:6]
    attendee = Attendees(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        name=f"Attendee {suffix}",
        category="main",
        email=f"att-{suffix}@test.com",
    )
    db.add(attendee)
    db.flush()
    return attendee


def _make_pending_payment_with_credit(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    application: Applications,
    *,
    credit_applied: Decimal,
) -> Payments:
    """Create a PENDING payment with credit_applied set (simulates prior debit)."""
    payment = Payments(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        status=PaymentStatus.PENDING.value,
        amount=Decimal("50"),
        currency="USD",
        external_id=f"sf-{uuid.uuid4().hex[:8]}",
        credit_applied=credit_applied,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def _restore_audit_entries(db: Session, human_id: uuid.UUID) -> list[AuditLog]:
    db.expire_all()
    return list(
        db.exec(
            select(AuditLog).where(
                AuditLog.entity_type == AuditEntityType.HUMAN,
                AuditLog.entity_id == human_id,
                AuditLog.action == AuditAction.CREDIT_RESTORED,
            )
        ).all()
    )


def _fresh_credit(db: Session, application_id: uuid.UUID) -> Decimal:
    db.expire_all()
    app = db.get(Applications, application_id)
    assert app is not None
    return Decimal(str(app.credit)) if app.credit else Decimal("0")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestCreditRestoreOnTerminalStatus:
    """Credit is restored when a PENDING payment expires or is cancelled."""

    def test_expire_restores_credit(self, db: Session, tenant_a: Tenants) -> None:
        """PENDING with credit_applied → EXPIRED: credit restored to application."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human, credit=Decimal("0"))
        payment = _make_pending_payment_with_credit(
            db, tenant_a, popup, application, credit_applied=Decimal("50")
        )

        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)

        assert _fresh_credit(db, application.id) == Decimal("50")

        entries = _restore_audit_entries(db, human.id)
        assert len(entries) == 1
        assert Decimal(entries[0].details["amount"]) == Decimal("50")

    def test_cancel_restores_credit(self, db: Session, tenant_a: Tenants) -> None:
        """PENDING with credit_applied → CANCELLED: credit restored."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human, credit=Decimal("0"))
        payment = _make_pending_payment_with_credit(
            db, tenant_a, popup, application, credit_applied=Decimal("30")
        )

        payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)

        assert _fresh_credit(db, application.id) == Decimal("30")

        entries = _restore_audit_entries(db, human.id)
        assert len(entries) == 1

    def test_double_expire_is_idempotent(self, db: Session, tenant_a: Tenants) -> None:
        """Second expire on an already-EXPIRED payment does NOT double-restore."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human, credit=Decimal("0"))
        payment = _make_pending_payment_with_credit(
            db, tenant_a, popup, application, credit_applied=Decimal("50")
        )

        # First expire: restores credit
        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)
        assert _fresh_credit(db, application.id) == Decimal("50")

        # Second expire on an already-expired payment: PENDING guard prevents re-restore
        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)
        assert _fresh_credit(db, application.id) == Decimal("50")  # unchanged

        # Only one restore audit entry
        entries = _restore_audit_entries(db, human.id)
        assert len(entries) == 1

    def test_zero_credit_applied_not_restored(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Payment with credit_applied=0 → EXPIRED: no restore, no audit entry."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human, credit=Decimal("0"))
        payment = _make_pending_payment_with_credit(
            db, tenant_a, popup, application, credit_applied=Decimal("0")
        )

        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)

        assert _fresh_credit(db, application.id) == Decimal("0")

        entries = _restore_audit_entries(db, human.id)
        assert len(entries) == 0
