"""Regression tests for PR-#179 meal_plan_select purchase_metadata propagation.

The meal_plan step ships per-day menu choices, dietary restriction, and
special request as a single JSONB blob (``purchase_metadata``). Two paths
materialize ``attendee_products`` rows that must carry it:

1. ``$0 auto-approve`` (cupón 100% off / credits cover cost): products
   flow directly from the inbound ``PaymentProductRequest`` into
   ``_add_products_to_attendees``. The snapshot row gets the blob too
   so a later status-change rebuild still has the data.

2. ``SimpleFI paid``: payment is created PENDING, the webhook later
   approves. ``approve_payment`` rebuilds ``PaymentProductRequest``
   entries from ``payment.products_snapshot`` — that snapshot must
   carry ``purchase_metadata`` so the blob survives the async hop.

These tests guard against silent regressions of either path.
"""

import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import (
    PaymentCreate,
    PaymentProductRequest,
    PaymentStatus,
)
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants

SAMPLE_METADATA = {
    "daily_choices": {
        "2026-06-01": "veggie",
        "2026-06-02": "chicken",
        "2026-06-03": "chef",
        "2026-06-04": "pasta",
        "2026-06-05": "fish",
    },
    "dietary_restriction": "gluten-free",
    "special_request": "Earlier dinners por favor",
}


# ---- Helpers ----------------------------------------------------------------


@pytest.fixture
def human(db: Session, tenant_a: Tenants) -> Humans:
    h = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        email=f"meal-plan-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Meal",
        last_name="Plan",
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


def _meal_plan_product(db: Session, popup: Popups, *, price: str = "75") -> Products:
    p = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name="Week 1 Meal Plan",
        slug=f"mp-{uuid.uuid4().hex[:6]}",
        price=Decimal(price),
        category="meal_plan",
        is_active=True,
    )
    db.add(p)
    db.flush()
    return p


def _ticket_product(db: Session, popup: Popups, *, price: str = "10") -> Products:
    p = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name="Week 1 Pass",
        slug=f"tkt-{uuid.uuid4().hex[:6]}",
        price=Decimal(price),
        category="ticket",
        is_active=True,
    )
    db.add(p)
    db.flush()
    return p


def _application_and_attendee(
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
        name="Test Meal Planner",
        email=human.email,
        category="main",
    )
    db.add(attendee)
    db.flush()
    return app, attendee


def _cleanup(db: Session, *entities) -> None:
    """Best-effort delete of test entities in reverse order, ignoring not-found."""
    for e in entities:
        try:
            db.delete(e)
        except Exception:
            pass
    db.commit()


# ---- Tests ------------------------------------------------------------------


class TestSimpleFiPaidPath:
    """Covers the webhook-approval path that rebuilds from products_snapshot."""

    def test_approve_payment_propagates_purchase_metadata_to_attendee_products(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        human: Humans,
    ) -> None:
        """Payment created → snapshot carries metadata → approval materializes it onto attendee_products."""
        original_key = popup_tenant_a.simplefi_api_key
        popup_tenant_a.simplefi_api_key = "simplefi_test_key"
        db.add(popup_tenant_a)
        db.commit()

        product = _meal_plan_product(db, popup_tenant_a)
        app, attendee = _application_and_attendee(db, popup_tenant_a, human)
        db.commit()

        payment: Payments | None = None
        try:
            obj = PaymentCreate(
                application_id=app.id,
                products=[
                    PaymentProductRequest(
                        product_id=product.id,
                        attendee_id=attendee.id,
                        quantity=1,
                        purchase_metadata=SAMPLE_METADATA,
                    )
                ],
            )
            sf_resp = SimpleNamespace(
                id=f"sf_{uuid.uuid4().hex[:10]}",
                status="pending",
                checkout_url="https://sf.test/meal-plan",
            )
            with patch("app.services.simplefi.get_simplefi_client") as mock_client:
                mock_client.return_value.create_payment.return_value = sf_resp
                payment, _ = payments_crud.create_payment(db, obj)

            assert payment is not None
            assert payment.status == PaymentStatus.PENDING.value

            # 1) Snapshot row carries the blob (the fix to crud.py site ~1653).
            pp = db.exec(
                select(PaymentProducts).where(
                    PaymentProducts.payment_id == payment.id,
                    PaymentProducts.product_id == product.id,
                )
            ).first()
            assert pp is not None, "PaymentProducts snapshot row missing"
            assert pp.purchase_metadata == SAMPLE_METADATA, (
                "Snapshot did not preserve purchase_metadata at payment-create time"
            )

            # No attendee_products yet — payment is PENDING (SimpleFI hasn't paid).
            assert (
                db.exec(
                    select(AttendeeProducts).where(
                        AttendeeProducts.attendee_id == attendee.id,
                        AttendeeProducts.product_id == product.id,
                    )
                ).first()
                is None
            )

            # 2) Webhook approves → AttendeeProducts row materialized with metadata.
            payments_crud.approve_payment(db, payment.id, source="SimpleFI")

            ap = db.exec(
                select(AttendeeProducts).where(
                    AttendeeProducts.attendee_id == attendee.id,
                    AttendeeProducts.product_id == product.id,
                )
            ).first()
            assert ap is not None, (
                "approve_payment did not materialize attendee_products"
            )
            assert ap.purchase_metadata == SAMPLE_METADATA, (
                "approve_payment dropped purchase_metadata when rebuilding from "
                "products_snapshot (regression of PR-#179 fix)"
            )
        finally:
            # Cleanup: attendee_products → payment_products → payment → attendee → app → product
            for ap_row in db.exec(
                select(AttendeeProducts).where(
                    AttendeeProducts.attendee_id == attendee.id,
                )
            ).all():
                db.delete(ap_row)
            if payment is not None:
                for pp_row in db.exec(
                    select(PaymentProducts).where(
                        PaymentProducts.payment_id == payment.id,
                    )
                ).all():
                    db.delete(pp_row)
                db.delete(payment)
            _cleanup(db, attendee, app, product)
            popup_tenant_a.simplefi_api_key = original_key
            db.add(popup_tenant_a)
            db.commit()


class TestZeroAmountAutoApprovePath:
    """Covers the inline auto-approve path used for $0 totals."""

    def test_zero_amount_path_persists_purchase_metadata_on_both_rows(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        human: Humans,
    ) -> None:
        """Free meal_plan order → both attendee_products and payment_products carry metadata."""
        # Free product → preview.amount == 0 → triggers inline auto-approve branch.
        product = _meal_plan_product(db, popup_tenant_a, price="0")
        app, attendee = _application_and_attendee(db, popup_tenant_a, human)
        db.commit()

        payment: Payments | None = None
        try:
            obj = PaymentCreate(
                application_id=app.id,
                products=[
                    PaymentProductRequest(
                        product_id=product.id,
                        attendee_id=attendee.id,
                        quantity=1,
                        purchase_metadata=SAMPLE_METADATA,
                    )
                ],
            )
            payment, _ = payments_crud.create_payment(db, obj)
            assert payment is not None
            assert payment.status == PaymentStatus.APPROVED.value

            ap = db.exec(
                select(AttendeeProducts).where(
                    AttendeeProducts.attendee_id == attendee.id,
                    AttendeeProducts.product_id == product.id,
                )
            ).first()
            assert ap is not None
            assert ap.purchase_metadata == SAMPLE_METADATA

            pp = db.exec(
                select(PaymentProducts).where(
                    PaymentProducts.payment_id == payment.id,
                    PaymentProducts.product_id == product.id,
                )
            ).first()
            assert pp is not None
            assert pp.purchase_metadata == SAMPLE_METADATA, (
                "Even free orders must populate the snapshot — a later "
                "status-change rebuild reads from here."
            )
        finally:
            for ap_row in db.exec(
                select(AttendeeProducts).where(
                    AttendeeProducts.attendee_id == attendee.id,
                )
            ).all():
                db.delete(ap_row)
            if payment is not None:
                for pp_row in db.exec(
                    select(PaymentProducts).where(
                        PaymentProducts.payment_id == payment.id,
                    )
                ).all():
                    db.delete(pp_row)
                db.delete(payment)
            _cleanup(db, attendee, app, product)


class TestAttendeeReadSerialization:
    """Covers the AttendeeProductPublic constructor in attendee/router.py."""

    def test_attendee_with_origin_serializes_purchase_metadata(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        human: Humans,
    ) -> None:
        """A row with metadata in the DB must appear in the AttendeeWithOriginPublic response."""
        from app.api.attendee.router import _build_attendee_with_origin

        product = _ticket_product(db, popup_tenant_a, price="10")
        app, attendee = _application_and_attendee(db, popup_tenant_a, human)
        ap = AttendeeProducts(
            id=uuid.uuid4(),
            tenant_id=popup_tenant_a.tenant_id,
            attendee_id=attendee.id,
            product_id=product.id,
            check_in_code="ABCDEFGH",
            purchase_metadata=SAMPLE_METADATA,
        )
        db.add(ap)
        db.commit()
        db.refresh(attendee)
        try:
            response = _build_attendee_with_origin(attendee)
            mp_row = next(
                (p for p in response.products if p.product_id == product.id),
                None,
            )
            assert mp_row is not None
            assert mp_row.purchase_metadata == SAMPLE_METADATA, (
                "AttendeeProductPublic dropped purchase_metadata at the response builder "
                "(regression of PR-#179 router fix)"
            )
        finally:
            db.delete(ap)
            _cleanup(db, attendee, app, product)
