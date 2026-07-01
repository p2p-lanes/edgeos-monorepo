"""Integration tests for credit audit log projection into build_human_activity (TDD — RED first).

Covers:
  R-AT-02: credit audit log entries appear as timeline items with correct HumanActivityKind
  Scenario 14: each credit movement kind is projected with amount, source, actor, timestamp
"""

import uuid
from decimal import Decimal

from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.audit_log.actor import actor_from_system
from app.api.audit_log.constants import AuditAction
from app.api.human.activity_crud import build_human_activity
from app.api.human.activity_schemas import HumanActivityKind
from app.api.human.models import Humans
from app.api.payment.crud import adjust_application_credit
from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Activity Test Popup {uuid.uuid4().hex[:6]}",
        slug=f"act-{uuid.uuid4().hex[:6]}",
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
        email=f"act-{suffix}@test.com",
        first_name="Activity",
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


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestCreditActivityProjection:
    """Credit audit entries project into the human activity timeline."""

    def test_credit_granted_appears_in_timeline(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """A CREDIT_GRANTED audit entry projects as CREDIT_GRANTED timeline item."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)

        adjust_application_credit(
            db,
            application,
            Decimal("50"),
            kind=AuditAction.CREDIT_GRANTED,
            source="manual",
            actor=actor_from_system(),
        )
        db.commit()

        items, total = build_human_activity(db, db, human.id, skip=0, limit=100)

        credit_items = [i for i in items if i.kind == HumanActivityKind.CREDIT_GRANTED]
        assert len(credit_items) >= 1
        item = credit_items[0]
        assert item.amount == Decimal("50")
        assert item.source == "manual"

    def test_credit_applied_appears_in_timeline(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """A CREDIT_APPLIED audit entry projects as CREDIT_APPLIED timeline item."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(
            db, tenant_a, popup, human, credit=Decimal("80")
        )

        adjust_application_credit(
            db,
            application,
            Decimal("-30"),
            kind=AuditAction.CREDIT_APPLIED,
            source="purchase",
            actor=actor_from_system(),
        )
        db.commit()

        items, _ = build_human_activity(db, db, human.id, skip=0, limit=100)

        credit_items = [i for i in items if i.kind == HumanActivityKind.CREDIT_APPLIED]
        assert len(credit_items) >= 1
        item = credit_items[0]
        assert item.amount == Decimal("-30")
        assert item.source == "purchase"

    def test_credit_restored_appears_in_timeline(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """A CREDIT_RESTORED audit entry projects as CREDIT_RESTORED timeline item."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)

        adjust_application_credit(
            db,
            application,
            Decimal("25"),
            kind=AuditAction.CREDIT_RESTORED,
            source="purchase",
            actor=actor_from_system(),
        )
        db.commit()

        items, _ = build_human_activity(db, db, human.id, skip=0, limit=100)

        credit_items = [i for i in items if i.kind == HumanActivityKind.CREDIT_RESTORED]
        assert len(credit_items) >= 1
        item = credit_items[0]
        assert item.amount == Decimal("25")
        assert item.source == "purchase"

    def test_all_three_kinds_are_distinguishable(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Scenario 14: all three credit movement kinds appear with correct kinds."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(
            db, tenant_a, popup, human, credit=Decimal("100")
        )

        # Grant
        adjust_application_credit(
            db,
            application,
            Decimal("50"),
            kind=AuditAction.CREDIT_GRANTED,
            source="manual",
            actor=actor_from_system(),
        )
        # Debit
        adjust_application_credit(
            db,
            application,
            Decimal("-30"),
            kind=AuditAction.CREDIT_APPLIED,
            source="purchase",
            actor=actor_from_system(),
        )
        # Restore
        adjust_application_credit(
            db,
            application,
            Decimal("15"),
            kind=AuditAction.CREDIT_RESTORED,
            source="purchase",
            actor=actor_from_system(),
        )
        db.commit()

        items, _ = build_human_activity(db, db, human.id, skip=0, limit=100)

        kinds = {i.kind for i in items}
        assert HumanActivityKind.CREDIT_GRANTED in kinds
        assert HumanActivityKind.CREDIT_APPLIED in kinds
        assert HumanActivityKind.CREDIT_RESTORED in kinds
