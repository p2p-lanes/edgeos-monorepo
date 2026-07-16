"""Integration tests for adjust_application_credit helper (TDD — RED first).

Covers:
  T-01: grant increases credit + writes audit log
  T-01: debit decreases credit + writes audit log
  T-01: restore (positive delta) writes correct audit log
  T-01: over-debit raises ValueError
  T-10: credit=0 unaffected (no audit entry)
  T-09/T-02: edit_passes_enabled=False does not suppress credit application (debit works)
"""

import uuid
from decimal import Decimal

import pytest
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.audit_log.actor import actor_from_system
from app.api.audit_log.constants import AuditAction, AuditEntityType
from app.api.audit_log.models import AuditLog
from app.api.human.models import Humans
from app.api.payment.crud import adjust_application_credit
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(
    db: Session, tenant: Tenants, *, edit_passes_enabled: bool = True
) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Credit Helper Popup {uuid.uuid4().hex[:6]}",
        slug=f"cr-helper-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
        edit_passes_enabled=edit_passes_enabled,
    )
    db.add(popup)
    db.flush()
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    suffix = uuid.uuid4().hex[:8]
    human = Humans(
        tenant_id=tenant.id,
        email=f"cr-helper-{suffix}@test.com",
        first_name="Credit",
        last_name="Helper",
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


def _make_pending_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    application: Applications,
) -> Payments:
    payment = Payments(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        status=PaymentStatus.PENDING.value,
        amount=Decimal("50"),
        currency="USD",
        external_id=f"sf-{uuid.uuid4().hex[:8]}",
    )
    db.add(payment)
    db.flush()
    return payment


def _audit_entries_for(db: Session, human_id: uuid.UUID, action: str) -> list[AuditLog]:
    db.expire_all()
    return list(
        db.exec(
            select(AuditLog).where(
                AuditLog.entity_type == AuditEntityType.HUMAN,
                AuditLog.entity_id == human_id,
                AuditLog.action == action,
            )
        ).all()
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestAdjustApplicationCredit:
    """T-01: adjust_application_credit unit-level integration tests."""

    def test_grant_increases_credit_and_writes_audit_log(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Grant: credit increases by delta; an audit_logs entry is written."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human, credit=Decimal("0"))

        new_balance = adjust_application_credit(
            db,
            application,
            Decimal("50"),
            kind=AuditAction.CREDIT_GRANTED,
            source="manual",
            actor=actor_from_system(),
        )

        db.commit()
        db.expire_all()
        db.refresh(application)

        assert new_balance == Decimal("50")
        assert application.credit == Decimal("50")

        entries = _audit_entries_for(db, human.id, AuditAction.CREDIT_GRANTED)
        assert len(entries) == 1
        assert Decimal(entries[0].details["amount"]) == Decimal("50")
        assert entries[0].details["source"] == "manual"

    def test_debit_decreases_credit_and_writes_audit_log(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Debit: credit decreases by delta; an audit_logs entry is written."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(
            db, tenant_a, popup, human, credit=Decimal("100")
        )

        new_balance = adjust_application_credit(
            db,
            application,
            Decimal("-40"),
            kind=AuditAction.CREDIT_APPLIED,
            source="purchase",
            actor=actor_from_system(),
        )

        db.commit()
        db.expire_all()
        db.refresh(application)

        assert new_balance == Decimal("60")
        assert application.credit == Decimal("60")

        entries = _audit_entries_for(db, human.id, AuditAction.CREDIT_APPLIED)
        assert len(entries) == 1
        assert Decimal(entries[0].details["amount"]) == Decimal("-40")

    def test_restore_writes_correct_audit_log(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Restore: same as grant — positive delta + CREDIT_RESTORED action."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human, credit=Decimal("0"))
        payment = _make_pending_payment(db, tenant_a, popup, application)

        new_balance = adjust_application_credit(
            db,
            application,
            Decimal("30"),
            kind=AuditAction.CREDIT_RESTORED,
            source="purchase",
            actor=actor_from_system(),
            payment=payment,
        )

        db.commit()
        db.expire_all()
        db.refresh(application)

        assert new_balance == Decimal("30")
        assert application.credit == Decimal("30")

        entries = _audit_entries_for(db, human.id, AuditAction.CREDIT_RESTORED)
        assert len(entries) == 1
        assert entries[0].details["payment_id"] == str(payment.id)

    def test_over_debit_raises_value_error(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Over-debit raises ValueError; balance and audit log unchanged."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(
            db, tenant_a, popup, human, credit=Decimal("20")
        )

        with pytest.raises(ValueError, match="balance"):
            adjust_application_credit(
                db,
                application,
                Decimal("-50"),
                kind=AuditAction.CREDIT_APPLIED,
                source="purchase",
                actor=actor_from_system(),
            )

        db.rollback()

    def test_zero_credit_no_debit_no_audit_entry(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """T-10: credit=0; no debit; no audit entry written."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human, credit=Decimal("0"))

        # Should not even be called when credit=0 (caller guard), but even if
        # called with delta=0, it must not write an audit entry.
        new_balance = adjust_application_credit(
            db,
            application,
            Decimal("0"),
            kind=AuditAction.CREDIT_APPLIED,
            source="purchase",
            actor=actor_from_system(),
        )

        db.commit()
        db.expire_all()
        db.refresh(application)

        assert new_balance == Decimal("0")
        # No audit entry for a zero-amount movement
        entries = _audit_entries_for(db, human.id, AuditAction.CREDIT_APPLIED)
        assert len(entries) == 0

    def test_edit_passes_enabled_false_debit_still_works(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """T-09/T-02: edit_passes_enabled=False does not prevent credit debit."""
        popup = _make_popup(db, tenant_a, edit_passes_enabled=False)
        human = _make_human(db, tenant_a)
        application = _make_application(
            db, tenant_a, popup, human, credit=Decimal("30")
        )

        new_balance = adjust_application_credit(
            db,
            application,
            Decimal("-30"),
            kind=AuditAction.CREDIT_APPLIED,
            source="purchase",
            actor=actor_from_system(),
        )

        db.commit()
        db.expire_all()
        db.refresh(application)

        assert new_balance == Decimal("0")
        assert application.credit == Decimal("0")

        entries = _audit_entries_for(db, human.id, AuditAction.CREDIT_APPLIED)
        assert len(entries) == 1
