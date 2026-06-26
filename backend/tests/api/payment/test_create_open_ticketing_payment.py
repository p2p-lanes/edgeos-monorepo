"""Tests for PaymentsCRUD.create_open_ticketing_payment — CAP-C, CAP-D, CAP-F.

Phase 5: Rewritten to match new design where one attendee is shared across all
direct purchases by the same (human, popup), and each ticket becomes an
AttendeeProducts row (no quantity aggregation).
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.checkout.schemas import BuyerInfo, OpenTicketingPurchaseCreate, ProductLine
from app.api.coupon.models import Coupons
from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    slug_prefix: str = "ot",
    contribution_enabled: bool = False,
    contribution_percentage: str | None = None,
) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Open Ticketing {slug_prefix}",
        slug=f"{slug_prefix}-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.direct.value,
        status="active",
        simplefi_api_key="simplefi_test_key",
        currency="USD",
        contribution_enabled=contribution_enabled,
        contribution_percentage=Decimal(contribution_percentage)
        if contribution_percentage
        else None,
    )
    db.add(popup)
    db.flush()
    return popup


def _make_product(
    db: Session,
    popup: Popups,
    *,
    name: str,
    price: str,
    attendee_category_id: uuid.UUID | None = None,
) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=name,
        slug=f"prod-{uuid.uuid4().hex[:6]}",
        price=Decimal(price),
        category="ticket",
        attendee_category_id=attendee_category_id,
        is_active=True,
    )
    db.add(product)
    db.flush()
    return product


def _make_section(
    db: Session, popup: Popups, *, label: str, order: int = 0
) -> FormSections:
    section = FormSections(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        label=label,
        order=order,
        kind="standard",
    )
    db.add(section)
    db.flush()
    return section


def _make_field(
    db: Session,
    popup: Popups,
    section: FormSections,
    *,
    name: str,
    label: str,
    field_type: str = "text",
    required: bool = False,
    position: int = 0,
) -> FormFields:
    field = FormFields(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        section_id=section.id,
        name=f"{name}_{uuid.uuid4().hex[:4]}",
        label=label,
        field_type=field_type,
        required=required,
        position=position,
    )
    db.add(field)
    db.flush()
    return field


def _make_coupon(
    db: Session,
    popup: Popups,
    *,
    code: str,
    discount_value: int,
) -> Coupons:
    coupon = Coupons(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        code=code,
        discount_value=discount_value,
        is_active=True,
    )
    db.add(coupon)
    db.flush()
    return coupon


def _purchase_create(
    *,
    email: str,
    first_name: str,
    last_name: str,
    products: list[tuple[Products, int]],
    form_data: dict[str, object],
    coupon_code: str | None = None,
) -> OpenTicketingPurchaseCreate:
    return OpenTicketingPurchaseCreate(
        products=[
            ProductLine(product_id=product.id, quantity=quantity)
            for product, quantity in products
        ],
        buyer=BuyerInfo(
            email=email,
            first_name=first_name,
            last_name=last_name,
            form_data=form_data,
        ),
        coupon_code=coupon_code,
    )


def test_create_open_ticketing_payment_one_attendee_n_tickets(
    db: Session,
    tenant_a: Tenants,
) -> None:
    """quantity=3 → 1 attendee + 3 PaymentProducts (snapshot). AttendeeProducts are created only on approval. Design §2.1/§2.2."""
    popup = _make_popup(db, tenant_a, slug_prefix="main-comp")
    product = _make_product(db, popup, name="GA", price="120.00")
    section = _make_section(db, popup, label="Buyer Info")
    first_name_field = _make_field(
        db, popup, section, name="first_name", label="Nombre", required=True
    )
    dietary_field = _make_field(
        db,
        popup,
        section,
        name="dietary",
        label="Dietary",
        field_type="multiselect",
        position=1,
    )
    db.commit()

    obj = _purchase_create(
        email="buyer@test.com",
        first_name="Matias",
        last_name="Walter",
        products=[(product, 3)],
        form_data={
            first_name_field.name: "Matias",
            dietary_field.name: ["vegetarian", "gluten_free"],
        },
    )

    simplefi_response = SimpleNamespace(
        id="sf_open_ticketing_1",
        status="pending",
        checkout_url="https://simplefi.test/checkout/1",
        is_installment_plan=False,
    )

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.return_value = simplefi_response

        payment, checkout_url, _ = payments_crud.create_open_ticketing_payment(
            db,
            obj=obj,
            popup=popup,
            tenant=tenant_a,
            attribution={
                "fbc": "fb.1.1710000000.click",
                "fbp": "fb.1.1710000000.browser",
                "client_ip": "203.0.113.10",
                "client_user_agent": "Mozilla/5.0 Test",
            },
        )

    assert checkout_url == "https://simplefi.test/checkout/1"
    assert payment.status == "pending"
    assert payment.amount == Decimal("360.00")
    assert payment.external_id == "sf_open_ticketing_1"
    assert payment.meta_fbc == "fb.1.1710000000.click"
    assert payment.meta_fbp == "fb.1.1710000000.browser"
    assert payment.meta_client_ip == "203.0.113.10"
    assert payment.meta_client_user_agent == "Mozilla/5.0 Test"

    # New design: 1 attendee for 3 tickets (not 3 attendees)
    attendees = list(
        db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all()
    )
    assert len(attendees) == 1
    assert attendees[0].name == "Matias Walter"
    assert attendees[0].category == "main"
    assert attendees[0].email == "buyer@test.com"

    # AttendeeProducts are NOT created at checkout — only when payment is approved.
    attendee_products = list(
        db.exec(
            select(AttendeeProducts).where(AttendeeProducts.product_id == product.id)
        ).all()
    )
    assert len(attendee_products) == 0

    payment_products = list(
        db.exec(
            select(PaymentProducts).where(PaymentProducts.payment_id == payment.id)
        ).all()
    )
    assert len(payment_products) == 3

    assert payment.buyer_snapshot is not None
    assert payment.buyer_snapshot["schema_version"] == 1
    assert datetime.fromisoformat(payment.buyer_snapshot["submitted_at"]).tzinfo == UTC
    snapshot_fields = payment.buyer_snapshot["sections"][0]["fields"]
    assert snapshot_fields[0]["field_id"] == str(first_name_field.id)
    assert snapshot_fields[1]["field_id"] == str(dietary_field.id)
    assert snapshot_fields[1]["value"] == ["vegetarian", "gluten_free"]


def test_create_open_ticketing_payment_second_purchase_reuses_attendee(
    db: Session,
    tenant_a: Tenants,
) -> None:
    """Second purchase by same (human, popup) reuses the existing attendee.  Design §2.1 / Spec C2."""
    popup = _make_popup(db, tenant_a, slug_prefix="reuse")
    product = _make_product(db, popup, name="GA", price="50.00")
    section = _make_section(db, popup, label="Buyer Info")
    name_field = _make_field(
        db, popup, section, name="first_name", label="Nombre", required=True
    )
    db.commit()

    obj1 = _purchase_create(
        email="repeat@test.com",
        first_name="Repeat",
        last_name="Buyer",
        products=[(product, 1)],
        form_data={name_field.name: "Repeat"},
    )
    obj2 = _purchase_create(
        email="repeat@test.com",
        first_name="Repeat",
        last_name="Buyer",
        products=[(product, 2)],
        form_data={name_field.name: "Repeat"},
    )

    sf_resp1 = SimpleNamespace(
        id="sf_reuse_1",
        status="pending",
        checkout_url="https://sf.test/1",
        is_installment_plan=False,
    )
    sf_resp2 = SimpleNamespace(
        id="sf_reuse_2",
        status="pending",
        checkout_url="https://sf.test/2",
        is_installment_plan=False,
    )

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.side_effect = [sf_resp1, sf_resp2]

        payments_crud.create_open_ticketing_payment(
            db, obj=obj1, popup=popup, tenant=tenant_a
        )
        payments_crud.create_open_ticketing_payment(
            db, obj=obj2, popup=popup, tenant=tenant_a
        )

    # Still exactly 1 attendee after two purchases
    attendees = list(
        db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all()
    )
    assert len(attendees) == 1

    # AttendeeProducts are NOT created at checkout — only when each payment is approved.
    tickets = list(
        db.exec(
            select(AttendeeProducts).where(
                AttendeeProducts.attendee_id == attendees[0].id
            )
        ).all()
    )
    assert len(tickets) == 0


def test_create_open_ticketing_payment_does_not_overwrite_existing_human(
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="existing-human")
    product = _make_product(db, popup, name="GA", price="50.00")
    section = _make_section(db, popup, label="Buyer Info")
    name_field = _make_field(
        db, popup, section, name="first_name", label="Nombre", required=True
    )

    existing = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        email="existing@test.com",
        first_name="Original",
        last_name="Human",
    )
    db.add(existing)
    db.commit()

    obj = _purchase_create(
        email="existing@test.com",
        first_name="New",
        last_name="Buyer",
        products=[(product, 1)],
        form_data={name_field.name: "New"},
    )

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_open_ticketing_3",
            status="pending",
            checkout_url="https://simplefi.test/checkout/3",
            is_installment_plan=False,
        )

        payments_crud.create_open_ticketing_payment(
            db, obj=obj, popup=popup, tenant=tenant_a
        )

    db.expire(existing)
    db.refresh(existing)
    assert existing.first_name == "Original"
    assert existing.last_name == "Human"

    attendee = db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).first()
    assert attendee is not None
    assert attendee.name == "New Buyer"
    assert attendee.human_id == existing.id


def test_create_open_ticketing_payment_rolls_back_payment_artifacts_on_provider_failure(
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="rollback")
    product = _make_product(db, popup, name="GA", price="99.00")
    section = _make_section(db, popup, label="Buyer Info")
    name_field = _make_field(
        db, popup, section, name="first_name", label="Nombre", required=True
    )
    db.commit()

    obj = _purchase_create(
        email="rollback@test.com",
        first_name="Rollback",
        last_name="Case",
        products=[(product, 2)],
        form_data={name_field.name: "Rollback"},
    )

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.side_effect = RuntimeError("boom")

        with pytest.raises(HTTPException):
            payments_crud.create_open_ticketing_payment(
                db,
                obj=obj,
                popup=popup,
                tenant=tenant_a,
            )

    payments = list(
        db.exec(select(Payments).where(Payments.popup_id == popup.id)).all()
    )
    attendees = list(
        db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all()
    )
    payment_products = list(
        db.exec(
            select(PaymentProducts)
            .join(Payments, PaymentProducts.payment_id == Payments.id)  # type: ignore[arg-type]
            .where(Payments.popup_id == popup.id)
        ).all()
    )
    attendee_products = list(
        db.exec(
            select(AttendeeProducts)
            .join(Attendees, AttendeeProducts.attendee_id == Attendees.id)  # type: ignore[arg-type]
            .where(Attendees.popup_id == popup.id)
        ).all()
    )

    assert payments == []
    assert attendees == []
    assert payment_products == []
    assert attendee_products == []


def test_create_open_ticketing_payment_does_not_consume_coupon_on_provider_failure(
    db: Session,
    tenant_a: Tenants,
) -> None:
    """A coupon is consumed only after SimpleFI accepts the payment. A provider
    failure must NOT burn a single-use code. Regression: the open-checkout path
    used to consume the coupon before the SimpleFI call, creating false uses."""
    popup = _make_popup(db, tenant_a, slug_prefix="coupon-rollback")
    product = _make_product(db, popup, name="GA", price="100.00")
    coupon = _make_coupon(db, popup, code="SAFE10", discount_value=10)
    db.commit()

    obj = _purchase_create(
        email="buyer@test.com",
        first_name="Matias",
        last_name="Walter",
        products=[(product, 2)],
        form_data={},
        coupon_code="SAFE10",
    )

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.side_effect = RuntimeError("boom")

        with pytest.raises(HTTPException):
            payments_crud.create_open_ticketing_payment(
                db,
                obj=obj,
                popup=popup,
                tenant=tenant_a,
            )

    db.expire(coupon)
    db.refresh(coupon)
    assert coupon.current_uses == 0


def test_create_open_ticketing_payment_applies_coupon_discount(
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="coupon")
    product = _make_product(db, popup, name="GA", price="100.00")
    coupon = _make_coupon(db, popup, code="DISCOUNT10", discount_value=10)
    db.commit()

    obj = _purchase_create(
        email="buyer@test.com",
        first_name="Matias",
        last_name="Walter",
        products=[(product, 2)],
        form_data={},
        coupon_code="DISCOUNT10",
    )

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_open_ticketing_coupon",
            status="pending",
            checkout_url="https://simplefi.test/checkout/coupon",
            is_installment_plan=False,
        )

        payment, _, _ = payments_crud.create_open_ticketing_payment(
            db,
            obj=obj,
            popup=popup,
            tenant=tenant_a,
        )

    # 2 × $100 = $200, minus 10% = $180
    assert payment.amount == Decimal("180.00")
    assert payment.coupon_id == coupon.id
    assert payment.coupon_code == "DISCOUNT10"
    assert payment.discount_value == Decimal("10")

    db.expire(coupon)
    db.refresh(coupon)
    assert coupon.current_uses == 1


def test_create_open_ticketing_payment_applies_contribution(
    db: Session,
    tenant_a: Tenants,
) -> None:
    """Popup-level contribution fee is added to the open-checkout total, persisted
    on the payment, and sent to SimpleFI. Regression: the festival popup showed the
    contribution in checkout but never charged it (separate code path from
    _apply_discounts)."""
    popup = _make_popup(
        db,
        tenant_a,
        slug_prefix="contribution",
        contribution_enabled=True,
        contribution_percentage="10.00",
    )
    product = _make_product(db, popup, name="GA", price="100.00")
    db.commit()

    obj = _purchase_create(
        email="buyer@test.com",
        first_name="Matias",
        last_name="Walter",
        products=[(product, 2)],
        form_data={},
    )

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_open_ticketing_contribution",
            status="pending",
            checkout_url="https://simplefi.test/checkout/contribution",
            is_installment_plan=False,
        )

        payment, _, _ = payments_crud.create_open_ticketing_payment(
            db,
            obj=obj,
            popup=popup,
            tenant=tenant_a,
        )

        sent_amount = mock_get_client.return_value.create_payment.call_args.kwargs[
            "amount"
        ]

    # 2 × $100 = $200 base, + 10% contribution = $20 → $220 grand total
    assert payment.contribution_amount == Decimal("20.00")
    assert payment.amount == Decimal("220.00")
    assert sent_amount == Decimal("220.00")


def test_create_open_ticketing_payment_100_percent_coupon_auto_approves(
    db: Session,
    tenant_a: Tenants,
) -> None:
    """A 100% coupon zeroes the cart: skip SimpleFI, mark APPROVED, materialize
    AttendeeProducts so the router can fire the confirmation email."""
    popup = _make_popup(db, tenant_a, slug_prefix="full-coupon")
    product = _make_product(db, popup, name="GA", price="75.00")
    coupon = _make_coupon(db, popup, code="FREEPASS", discount_value=100)
    db.commit()

    obj = _purchase_create(
        email="buyer@test.com",
        first_name="Matias",
        last_name="Walter",
        products=[(product, 2)],
        form_data={},
        coupon_code="FREEPASS",
    )

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        payment, checkout_url, _ = payments_crud.create_open_ticketing_payment(
            db,
            obj=obj,
            popup=popup,
            tenant=tenant_a,
        )

    mock_get_client.assert_not_called()
    assert payment.amount == Decimal("0.00")
    assert payment.status == "approved"
    assert payment.coupon_id == coupon.id
    assert payment.discount_value == Decimal("100")
    assert checkout_url == ""

    attendee_products = list(
        db.exec(
            select(AttendeeProducts).where(AttendeeProducts.payment_id == payment.id)
        ).all()
    )
    assert len(attendee_products) == 2

    db.expire(coupon)
    db.refresh(coupon)
    assert coupon.current_uses == 1


def test_create_open_ticketing_payment_rejects_invalid_coupon(
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="badcoupon")
    product = _make_product(db, popup, name="GA", price="50.00")
    db.commit()

    obj = _purchase_create(
        email="buyer@test.com",
        first_name="Matias",
        last_name="Walter",
        products=[(product, 1)],
        form_data={},
        coupon_code="NOPE",
    )

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        with pytest.raises(HTTPException) as exc_info:
            payments_crud.create_open_ticketing_payment(
                db, obj=obj, popup=popup, tenant=tenant_a
            )

    assert exc_info.value.status_code == 404
    mock_get_client.assert_not_called()
    assert (
        db.exec(select(Payments).where(Payments.popup_id == popup.id)).first() is None
    )
