"""Integration tests for credit debit at payment creation (TDD — RED first).

Covers:
  T-02: positive-amount debit + audit log (edit_passes_enabled=False still works)
  T-04: carryover — credit=100, total=60 → credit_applied=60, credit=40
  T-10: zero-credit no audit

These tests hit create_payment via the PaymentsCRUD layer with a testcontainers
Postgres — mirrors the coupon_release_on_terminal pattern.
"""

import uuid
from decimal import Decimal
from unittest.mock import MagicMock, patch

from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.audit_log.constants import AuditAction, AuditEntityType
from app.api.audit_log.models import AuditLog
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.schemas import PaymentCreate, PaymentProductRequest
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    edit_passes_enabled: bool = True,
    simplefi_api_key: str | None = "fake-simplefi-key",
) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Debit Test Popup {uuid.uuid4().hex[:6]}",
        slug=f"debit-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
        edit_passes_enabled=edit_passes_enabled,
        simplefi_api_key=simplefi_api_key,
    )
    db.add(popup)
    db.flush()
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    suffix = uuid.uuid4().hex[:8]
    human = Humans(
        tenant_id=tenant.id,
        email=f"debit-{suffix}@test.com",
        first_name="Debit",
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


def _make_product(
    db: Session, tenant: Tenants, popup: Popups, *, price: Decimal
) -> Products:
    slug = uuid.uuid4().hex[:8]
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Week Pass {slug[:4]}",
        slug=slug,
        price=price,
        currency="USD",
        category="ticket",
        duration_type="week",
        discountable=True,
    )
    db.add(product)
    db.flush()
    return product


def _make_non_discountable_product(
    db: Session, tenant: Tenants, popup: Popups, *, price: Decimal
) -> Products:
    slug = uuid.uuid4().hex[:8]
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"NonDisc {slug[:4]}",
        slug=slug,
        price=price,
        currency="USD",
        category="ticket",
        duration_type="week",
        discountable=False,
    )
    db.add(product)
    db.flush()
    return product


def _credit_audit_entries(
    db: Session, human_id: uuid.UUID, action: str
) -> list[AuditLog]:
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
# Fake SimpleFI response
# ---------------------------------------------------------------------------


def _fake_simplefi_response() -> MagicMock:
    resp = MagicMock()
    resp.id = f"sf-{uuid.uuid4().hex[:8]}"
    resp.status = "pending"
    resp.checkout_url = "https://simplefi.co/checkout/test"
    resp.is_installment_plan = False
    return resp


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestCreditDebitAtCreation:
    """Credit is debited from application at payment creation (positive-amount path)."""

    def test_positive_amount_debit_and_audit_log(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """T-02: application with credit=50, cart=100 → credit_applied=50, credit=0.

        Works even when edit_passes_enabled=False (R-BE-03).
        """
        popup = _make_popup(db, tenant_a, edit_passes_enabled=False)
        human = _make_human(db, tenant_a)
        application = _make_application(
            db, tenant_a, popup, human, credit=Decimal("50")
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

        fake_resp = _fake_simplefi_response()
        with patch(
            "app.services.simplefi.get_simplefi_client",
        ) as mock_client_factory:
            mock_client_factory.return_value.create_payment.return_value = fake_resp
            payment, preview = payments_crud.create_payment(db, obj, attribution=None)

        db.expire_all()
        db.refresh(application)
        db.refresh(payment)

        assert payment.credit_applied == Decimal("50")
        assert application.credit == Decimal("0")

        entries = _credit_audit_entries(db, human.id, AuditAction.CREDIT_APPLIED)
        assert len(entries) == 1
        assert Decimal(entries[0].details["amount"]) == Decimal("-50")

    def test_carryover_credit_exceeds_purchase(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """T-04: credit=100, total=60 → credit_applied=60, credit=40."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(
            db, tenant_a, popup, human, credit=Decimal("100")
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

        # credit=100 > price=60 → amount=0, zero-amount branch
        payment, preview = payments_crud.create_payment(db, obj, attribution=None)

        db.expire_all()
        db.refresh(application)
        db.refresh(payment)

        assert payment.credit_applied == Decimal("60")
        assert application.credit == Decimal("40")

    def test_zero_credit_no_debit_no_audit_entry(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """T-10: credit=0 → no debit, no audit entry."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human, credit=Decimal("0"))
        attendee = _make_attendee(db, tenant_a, popup, application)
        product = _make_product(db, tenant_a, popup, price=Decimal("80"))

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

        fake_resp = _fake_simplefi_response()
        with patch("app.services.simplefi.get_simplefi_client") as mock_client_factory:
            mock_client_factory.return_value.create_payment.return_value = fake_resp
            payment, preview = payments_crud.create_payment(db, obj, attribution=None)

        db.expire_all()
        db.refresh(application)
        db.refresh(payment)

        assert payment.credit_applied == Decimal("0")
        assert application.credit == Decimal("0")

        # No audit entry for zero-credit movement
        entries = _credit_audit_entries(db, human.id, AuditAction.CREDIT_APPLIED)
        assert len(entries) == 0

    def test_credit_applied_full_balance_with_non_discountable_product(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """FIX-1: credit=50, discountable=$30, non-discountable=$100, edit_passes=False.

        Final price: 30 + 100 - 50 = 80 (positive → SimpleFi path).
        credit_applied must be 50 (the full stored balance), not 30 (the old
        discounted_standard cap). Balance debited 50 -> 0.
        """
        popup = _make_popup(db, tenant_a, edit_passes_enabled=False)
        human = _make_human(db, tenant_a)
        application = _make_application(
            db, tenant_a, popup, human, credit=Decimal("50")
        )
        attendee = _make_attendee(db, tenant_a, popup, application)
        disc_product = _make_product(db, tenant_a, popup, price=Decimal("30"))
        nondisc_product = _make_non_discountable_product(
            db, tenant_a, popup, price=Decimal("100")
        )

        obj = PaymentCreate(
            application_id=application.id,
            products=[
                PaymentProductRequest(
                    product_id=disc_product.id,
                    attendee_id=attendee.id,
                    quantity=1,
                ),
                PaymentProductRequest(
                    product_id=nondisc_product.id,
                    attendee_id=attendee.id,
                    quantity=1,
                ),
            ],
        )

        fake_resp = _fake_simplefi_response()
        with patch("app.services.simplefi.get_simplefi_client") as mock_client_factory:
            mock_client_factory.return_value.create_payment.return_value = fake_resp
            payment, preview = payments_crud.create_payment(db, obj, attribution=None)

        db.expire_all()
        db.refresh(application)
        db.refresh(payment)

        # Final price = 30 + 100 - 50 = 80 (SimpleFi positive-amount path)
        assert preview.amount == Decimal("80.00")
        # Full stored balance consumed, not just the discounted standard amount
        assert payment.credit_applied == Decimal("50")
        assert application.credit == Decimal("0")

        entries = _credit_audit_entries(db, human.id, AuditAction.CREDIT_APPLIED)
        assert len(entries) == 1
        assert Decimal(entries[0].details["amount"]) == Decimal("-50")
