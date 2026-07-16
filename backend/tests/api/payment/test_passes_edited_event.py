"""Integration tests for the passes.edited audit event (TDD — RED first).

Covers S4-2 of the credit-decoupling SDD change:

  - A successful edit-passes settlement in the zero/negative branch emits
    exactly ONE passes.edited audit log row with entity_type=HUMAN and
    entity_id=human.id.
  - A successful edit-passes settlement in the positive-amount (SimpleFi) path
    emits exactly ONE passes.edited audit log row.
  - A non-edit purchase (edit_passes=False) emits NO passes.edited rows.
  - The two branches are mutually exclusive for a given cart, so the single
    emit per settlement invariant is structurally guaranteed — verified here
    by the positive-amount SimpleFi mock path producing exactly one row.
"""

import uuid
from decimal import Decimal
from unittest.mock import MagicMock, patch

from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.crud import generate_check_in_code
from app.api.attendee.models import AttendeeProducts, Attendees
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
        name=f"Passes Edited Test {uuid.uuid4().hex[:6]}",
        slug=f"pe-{uuid.uuid4().hex[:6]}",
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
        email=f"pe-{suffix}@test.com",
        first_name="Passes",
        last_name="Edited",
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


def _seed_purchased_product(
    db: Session,
    tenant: Tenants,
    attendee: Attendees,
    product: Products,
) -> AttendeeProducts:
    """Simulate a previously purchased product on an attendee (edit_passes context)."""
    ap = AttendeeProducts(
        tenant_id=tenant.id,
        attendee_id=attendee.id,
        product_id=product.id,
        quantity=1,
        check_in_code=generate_check_in_code(),
    )
    db.add(ap)
    db.flush()
    return ap


def _passes_edited_entries(db: Session, human_id: uuid.UUID) -> list[AuditLog]:
    db.expire_all()
    return list(
        db.exec(
            select(AuditLog).where(
                AuditLog.entity_type == AuditEntityType.HUMAN,
                AuditLog.entity_id == human_id,
                AuditLog.action == AuditAction.PASSES_EDITED,
            )
        ).all()
    )


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


class TestPassesEditedEvent:
    """passes.edited audit event is emitted exactly once per successful edit settlement."""

    def test_zero_amount_edit_passes_emits_passes_edited(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Zero/negative branch with edit_passes=True → exactly one passes.edited row.

        Setup: existing week pass worth $100, new cart $30 (edit_passes=True).
        Give-up > new cart → zero-amount branch, surplus stored as credit.
        The settlement must write one passes.edited audit row on entity_type=HUMAN.
        """
        popup = _make_popup(db, tenant_a, edit_passes_enabled=True)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human, credit=Decimal("0"))
        attendee = _make_attendee(db, tenant_a, popup, application)

        # Previously purchased pass being given up
        old_product = _make_product(db, tenant_a, popup, price=Decimal("100"))
        _seed_purchased_product(db, tenant_a, attendee, old_product)

        # New (cheaper) product in the edit cart
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

        payments_crud.create_payment(db, obj, attribution=None)

        entries = _passes_edited_entries(db, human.id)
        assert len(entries) == 1, (
            f"Expected 1 passes.edited audit row, got {len(entries)}"
        )
        assert entries[0].entity_type == AuditEntityType.HUMAN
        assert entries[0].entity_id == human.id
        assert entries[0].popup_id == popup.id

    def test_positive_amount_edit_passes_emits_passes_edited(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Positive-amount (SimpleFi) path with edit_passes=True → one passes.edited row.

        Setup: no existing passes, cart $150 (edit_passes=True, no give-up credit).
        Goes through the SimpleFi positive-amount path.
        The settlement must write one passes.edited audit row.
        """
        popup = _make_popup(
            db, tenant_a, edit_passes_enabled=True, simplefi_api_key="fake-key"
        )
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human, credit=Decimal("0"))
        attendee = _make_attendee(db, tenant_a, popup, application)
        product = _make_product(db, tenant_a, popup, price=Decimal("150"))

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

        fake_resp = _fake_simplefi_response()
        with patch("app.services.simplefi.get_simplefi_client") as mock_factory:
            mock_factory.return_value.create_payment.return_value = fake_resp
            payments_crud.create_payment(db, obj, attribution=None)

        entries = _passes_edited_entries(db, human.id)
        assert len(entries) == 1, (
            f"Expected 1 passes.edited audit row, got {len(entries)}"
        )
        assert entries[0].entity_type == AuditEntityType.HUMAN
        assert entries[0].entity_id == human.id
        assert entries[0].popup_id == popup.id

    def test_non_edit_purchase_emits_no_passes_edited(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """A regular purchase (edit_passes=False) must NOT emit passes.edited.

        The passes.edited event is strictly for the edit-passes flow.
        """
        popup = _make_popup(
            db, tenant_a, edit_passes_enabled=True, simplefi_api_key="fake-key"
        )
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
            edit_passes=False,
        )

        fake_resp = _fake_simplefi_response()
        with patch("app.services.simplefi.get_simplefi_client") as mock_factory:
            mock_factory.return_value.create_payment.return_value = fake_resp
            payments_crud.create_payment(db, obj, attribution=None)

        entries = _passes_edited_entries(db, human.id)
        assert len(entries) == 0, (
            f"Expected 0 passes.edited rows for non-edit purchase, got {len(entries)}"
        )
