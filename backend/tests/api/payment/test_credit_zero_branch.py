"""Integration tests for zero/negative amount branch credit handling (TDD — RED first).

Covers:
  T-11: edit give-up uses source=edit_passes (R-BE-11, R-ZR-03)
  T-04 zero branch: zero-amount path writes correct credit_applied + audit
  R-ZR-03: SimpleFi zero/negative-amount path still stores leftover correctly
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
from app.api.payment.schemas import PaymentCreate, PaymentProductRequest, PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
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
        name=f"Zero Branch Test {uuid.uuid4().hex[:6]}",
        slug=f"zero-{uuid.uuid4().hex[:6]}",
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
        email=f"zero-{suffix}@test.com",
        first_name="Zero",
        last_name="Branch",
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


def _make_product(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    price: Decimal,
    category: str = "ticket",
    duration_type: str = "week",
) -> Products:
    slug = uuid.uuid4().hex[:8]
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Pass {slug[:4]}",
        slug=slug,
        price=price,
        currency="USD",
        category=category,
        duration_type=duration_type,
        discountable=True,
    )
    db.add(product)
    db.flush()
    return product


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


def _fresh_credit(db: Session, application_id: uuid.UUID) -> Decimal:
    db.expire_all()
    app = db.get(Applications, application_id)
    assert app is not None
    return Decimal(str(app.credit)) if app.credit else Decimal("0")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestZeroNegativeBranchCredit:
    """Zero/negative amount branch routes credit through adjust_application_credit."""

    def test_full_credit_cover_zero_amount_branch(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """T-04 zero branch: credit=100, total=100 → payment.amount=0, credit zeroed.

        The stored balance covers the entire cart. payment.credit_applied = 100.
        application.credit = 0.
        """
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(
            db, tenant_a, popup, human, credit=Decimal("100")
        )
        attendee = _make_attendee(db, tenant_a, popup, application)
        product = _make_product(db, tenant_a, popup, price=Decimal("100"))

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

        payment, preview = payments_crud.create_payment(db, obj, attribution=None)

        db.expire_all()
        db.refresh(payment)

        assert payment.status == PaymentStatus.APPROVED.value
        assert payment.credit_applied == Decimal("100")
        assert _fresh_credit(db, application.id) == Decimal("0")

        # Audit entry for debit
        entries = _audit_entries_for(db, human.id, AuditAction.CREDIT_APPLIED)
        assert len(entries) == 1

    def test_leftover_credit_stored_correctly(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """R-ZR-03: credit=200, total=60 → leftover=140, payment is zero-amount, approved.

        credit_applied=60, application.credit=140 (not 0, not lost).
        """
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(
            db, tenant_a, popup, human, credit=Decimal("200")
        )
        attendee = _make_attendee(db, tenant_a, popup, application)
        product = _make_product(db, tenant_a, popup, price=Decimal("60"))

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

        payment, preview = payments_crud.create_payment(db, obj, attribution=None)

        db.expire_all()
        db.refresh(payment)

        assert payment.status == PaymentStatus.APPROVED.value
        assert payment.credit_applied == Decimal("60")
        assert _fresh_credit(db, application.id) == Decimal("140")

    def test_edit_passes_give_up_surplus_stored_via_helper(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """T-11: edit give-up surplus is stored via adjust_application_credit.

        Set up: application has a purchased week pass worth $100.
        New cart (edit_passes=True): $30 product.
        Give-up: $100. New cart: $30. Surplus: $70.
        Expected: payment amount=0 (approved), credit stored = 0 + 70 = 70.

        We verify the audit log has source=edit_passes.
        """
        popup = _make_popup(db, tenant_a, edit_passes_enabled=True)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human, credit=Decimal("0"))
        attendee = _make_attendee(db, tenant_a, popup, application)

        # Product to simulate a "previously purchased" week pass in the application
        # (used by _edit_giveup_credit to compute give-up value)
        from app.api.attendee.crud import generate_check_in_code
        from app.api.attendee.models import AttendeeProducts

        old_product = _make_product(db, tenant_a, popup, price=Decimal("100"))
        ap = AttendeeProducts(
            tenant_id=tenant_a.id,
            attendee_id=attendee.id,
            product_id=old_product.id,
            quantity=1,
            check_in_code=generate_check_in_code(),
        )
        db.add(ap)
        db.flush()

        # New product to purchase (edit pass) worth $30
        new_product = _make_product(db, tenant_a, popup, price=Decimal("30"))

        obj = PaymentCreate(
            application_id=application.id,
            products=[
                PaymentProductRequest(
                    product_id=new_product.id,
                    attendee_id=attendee.id,
                    quantity=1,
                )
            ],
            edit_passes=True,
        )

        payment, preview = payments_crud.create_payment(db, obj, attribution=None)

        db.expire_all()
        db.refresh(payment)

        assert payment.status == PaymentStatus.APPROVED.value
        # Surplus = give-up ($100) - new cart ($30) = $70 stored to credit
        assert _fresh_credit(db, application.id) == Decimal("70")

        # Audit entry should use source=edit_passes
        granted_entries = _audit_entries_for(db, human.id, AuditAction.CREDIT_GRANTED)
        assert len(granted_entries) == 1
        assert granted_entries[0].details["source"] == "edit_passes"

    def test_non_edit_surplus_uses_purchase_source_and_human_actor(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Regression: a plain purchase whose stored credit exceeds the cart
        settles through the surplus branch. The audit movement must read as a
        purchase attributed to the buying human, not a system-attributed
        edit_passes give-up.

        Stored credit $100, cart $30, edit_passes=False.
        Expected: approved, balance $70, one CREDIT_APPLIED entry with
        source=purchase and actor_type=human.
        """
        from app.api.audit_log.actor import actor_from_human

        popup = _make_popup(db, tenant_a, edit_passes_enabled=False)
        human = _make_human(db, tenant_a)
        application = _make_application(
            db, tenant_a, popup, human, credit=Decimal("100")
        )
        attendee = _make_attendee(db, tenant_a, popup, application)

        product = _make_product(db, tenant_a, popup, price=Decimal("30"))

        obj = PaymentCreate(
            application_id=application.id,
            products=[
                PaymentProductRequest(
                    product_id=product.id,
                    attendee_id=attendee.id,
                    quantity=1,
                )
            ],
            edit_passes=False,
        )

        payment, _preview = payments_crud.create_payment(
            db, obj, attribution=None, actor=actor_from_human(human)
        )

        db.expire_all()
        db.refresh(payment)

        assert payment.status == PaymentStatus.APPROVED.value
        assert _fresh_credit(db, application.id) == Decimal("70")

        applied = _audit_entries_for(db, human.id, AuditAction.CREDIT_APPLIED)
        assert len(applied) == 1
        assert applied[0].details["source"] == "purchase"
        assert applied[0].actor_type == "human"
