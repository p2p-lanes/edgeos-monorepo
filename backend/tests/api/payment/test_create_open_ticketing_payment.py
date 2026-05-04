"""Tests for PaymentsCRUD.create_open_ticketing_payment — CAP-C, CAP-D, CAP-F."""

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
from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.product.schemas import TicketAttendeeCategory
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants


def _make_popup(db: Session, tenant: Tenants, *, slug_prefix: str = "ot") -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Open Ticketing {slug_prefix}",
        slug=f"{slug_prefix}-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.direct.value,
        status="active",
        simplefi_api_key="simplefi_test_key",
        currency="USD",
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
    attendee_category: TicketAttendeeCategory | None = None,
) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=name,
        slug=f"prod-{uuid.uuid4().hex[:6]}",
        price=Decimal(price),
        category="ticket",
        attendee_category=attendee_category,
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


def _purchase_create(
    *,
    email: str,
    first_name: str,
    last_name: str,
    products: list[tuple[Products, int]],
    form_data: dict[str, object],
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
    )


def test_create_open_ticketing_payment_creates_main_and_companions(
    db: Session,
    tenant_a: Tenants,
) -> None:
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
    )

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.return_value = simplefi_response

        payment, checkout_url = payments_crud.create_open_ticketing_payment(
            db,
            obj=obj,
            popup=popup,
            tenant=tenant_a,
        )

    assert checkout_url == "https://simplefi.test/checkout/1"
    assert payment.status == "pending"
    assert payment.amount == Decimal("360.00")
    assert payment.external_id == "sf_open_ticketing_1"

    attendees = list(
        db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all()
    )
    assert len(attendees) == 3
    assert attendees[0].name == "Matias Walter"
    assert attendees[0].category == "main"
    assert attendees[0].email == "buyer@test.com"
    assert attendees[1].name == ""
    assert attendees[2].name == ""
    assert all(attendee.category == "main" for attendee in attendees)
    assert all(attendee.human_id == attendees[0].human_id for attendee in attendees)

    attendee_products = list(
        db.exec(
            select(AttendeeProducts).where(AttendeeProducts.product_id == product.id)
        ).all()
    )
    assert len(attendee_products) == 3
    assert all(link.quantity == 1 for link in attendee_products)

    payment_products = list(
        db.exec(
            select(PaymentProducts).where(PaymentProducts.payment_id == payment.id)
        ).all()
    )
    assert len(payment_products) == 3
    assert all(link.quantity == 1 for link in payment_products)

    assert payment.buyer_snapshot is not None
    assert payment.buyer_snapshot["schema_version"] == 1
    assert datetime.fromisoformat(payment.buyer_snapshot["submitted_at"]).tzinfo == UTC
    snapshot_fields = payment.buyer_snapshot["sections"][0]["fields"]
    assert snapshot_fields[0]["field_id"] == str(first_name_field.id)
    assert snapshot_fields[1]["field_id"] == str(dietary_field.id)
    assert snapshot_fields[1]["value"] == ["vegetarian", "gluten_free"]


def test_create_open_ticketing_payment_respects_explicit_attendee_categories(
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="categories")
    main_product = _make_product(db, popup, name="GA", price="100.00")
    spouse_product = _make_product(
        db,
        popup,
        name="Spouse Pass",
        price="80.00",
        attendee_category=TicketAttendeeCategory.SPOUSE,
    )
    section = _make_section(db, popup, label="Buyer Info")
    name_field = _make_field(
        db, popup, section, name="first_name", label="Nombre", required=True
    )
    db.commit()

    obj = _purchase_create(
        email="family@test.com",
        first_name="Buyer",
        last_name="Person",
        products=[(main_product, 1), (spouse_product, 1)],
        form_data={name_field.name: "Buyer"},
    )

    with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
        mock_get_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_open_ticketing_2",
            status="pending",
            checkout_url="https://simplefi.test/checkout/2",
        )

        payment, _ = payments_crud.create_open_ticketing_payment(
            db,
            obj=obj,
            popup=popup,
            tenant=tenant_a,
        )

    attendees = list(
        db.exec(
            select(Attendees)
            .where(Attendees.popup_id == popup.id)
            .order_by(Attendees.created_at)
        ).all()
    )
    assert len(attendees) == 2
    assert attendees[0].category == "main"
    assert attendees[1].category == "spouse"

    payment_products = list(
        db.exec(
            select(PaymentProducts).where(PaymentProducts.payment_id == payment.id)
        ).all()
    )
    spouse_link = next(
        pp for pp in payment_products if pp.product_id == spouse_product.id
    )
    assert spouse_link.attendee_id == attendees[1].id


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
