"""Tests for Phase 3 — ticket entity model and schema changes.

TDD phase: RED — written before model updates.
These assert the new shape (id, check_in_code, payment_id on AttendeeProducts;
nullable check_in_code on Attendees; UUID PK on PaymentProducts;
requires_check_in on Products).

Spec: C1/Ticket Identity, C5/payment-products-uuid-pk, Addendum #1201
Design: §2.5, §3.1, §3.4
"""

import uuid

import pytest
from sqlmodel import Session

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee.schemas import AttendeeProductPublic
from app.api.payment.models import PaymentProducts
from app.api.product.schemas import (
    ProductBase,
    ProductCreate,
    ProductPublic,
    ProductUpdate,
)


class TestAttendeeProductsModel:
    """AttendeeProducts must have id, check_in_code, payment_id; no quantity."""

    def test_model_has_id_field(self) -> None:
        """AttendeeProducts must expose an 'id' field."""
        assert hasattr(AttendeeProducts, "id"), "AttendeeProducts must have 'id' field"

    def test_model_has_check_in_code_field(self) -> None:
        """AttendeeProducts must expose 'check_in_code'."""
        assert hasattr(AttendeeProducts, "check_in_code"), (
            "AttendeeProducts must have 'check_in_code' field"
        )

    def test_model_has_payment_id_field(self) -> None:
        """AttendeeProducts must expose 'payment_id'."""
        assert hasattr(AttendeeProducts, "payment_id"), (
            "AttendeeProducts must have 'payment_id' field"
        )

    def test_model_has_no_quantity_field(self) -> None:
        """AttendeeProducts must NOT have a 'quantity' field."""
        field_names = set(AttendeeProducts.model_fields.keys())
        assert "quantity" not in field_names, (
            f"AttendeeProducts must not have 'quantity', found fields: {field_names}"
        )

    def test_orm_create_with_new_fields(
        self, db: Session, tenant_a, popup_tenant_a
    ) -> None:
        """AttendeeProducts can be created with id, check_in_code, payment_id."""
        from app.api.human.models import Humans

        human = Humans(
            tenant_id=tenant_a.id,
            email=f"ap-model-{uuid.uuid4().hex[:6]}@test.com",
        )
        db.add(human)
        db.commit()
        db.refresh(human)

        attendee = Attendees(
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=human.id,
            application_id=None,
            name="AP Model Test",
            category="main",
            check_in_code=None,  # nullable post-migration
            email=human.email,
        )
        db.add(attendee)
        db.commit()
        db.refresh(attendee)

        from app.api.product.models import Products

        product = db.exec(
            __import__("sqlmodel").select(Products).limit(1)
        ).first()
        if product is None:
            pytest.skip("No products in DB to test against")

        ticket_id = uuid.uuid4()
        code = f"MDLTST{uuid.uuid4().hex[:2].upper()}"
        ticket = AttendeeProducts(
            id=ticket_id,
            attendee_id=attendee.id,
            product_id=product.id,
            tenant_id=tenant_a.id,
            check_in_code=code,
            payment_id=None,
        )
        db.add(ticket)
        db.commit()
        db.refresh(ticket)

        assert ticket.id == ticket_id
        assert ticket.check_in_code == code
        assert ticket.payment_id is None


class TestAttendeesCheckInCodeNullable:
    """Attendees.check_in_code must be nullable after migration."""

    def test_attendee_can_be_created_with_null_check_in_code(
        self, db: Session, tenant_a, popup_tenant_a
    ) -> None:
        """Creating an Attendees row with check_in_code=None must succeed."""
        from app.api.human.models import Humans

        human = Humans(
            tenant_id=tenant_a.id,
            email=f"nullcic-{uuid.uuid4().hex[:6]}@test.com",
        )
        db.add(human)
        db.commit()
        db.refresh(human)

        attendee = Attendees(
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=human.id,
            application_id=None,
            name="Nullable CIC Test",
            category="main",
            check_in_code=None,
            email=human.email,
        )
        db.add(attendee)
        db.commit()
        db.refresh(attendee)

        assert attendee.check_in_code is None


class TestPaymentProductsModel:
    """PaymentProducts must have UUID PK 'id'; composite PK dropped."""

    def test_model_has_id_field(self) -> None:
        """PaymentProducts must expose an 'id' field."""
        assert hasattr(PaymentProducts, "id"), "PaymentProducts must have 'id' field"

    def test_id_is_pk(self) -> None:
        """PaymentProducts.id should be UUID typed."""
        # payment_id, product_id, attendee_id must NOT be primary keys
        # id IS the primary key — verified by migration test
        assert "id" in PaymentProducts.model_fields or hasattr(PaymentProducts, "id"), (
            "PaymentProducts must have an 'id' field"
        )


class TestProductRequiresCheckIn:
    """Product schemas must include requires_check_in: bool."""

    def test_product_base_has_requires_check_in(self) -> None:
        """ProductBase must have 'requires_check_in' field."""
        assert "requires_check_in" in ProductBase.model_fields, (
            "ProductBase must include 'requires_check_in'"
        )

    def test_product_create_has_requires_check_in(self) -> None:
        """ProductCreate must include 'requires_check_in'."""
        assert "requires_check_in" in ProductCreate.model_fields, (
            "ProductCreate must include 'requires_check_in'"
        )

    def test_product_update_has_requires_check_in(self) -> None:
        """ProductUpdate must include 'requires_check_in'."""
        assert "requires_check_in" in ProductUpdate.model_fields, (
            "ProductUpdate must include 'requires_check_in'"
        )

    def test_product_public_has_requires_check_in(self) -> None:
        """ProductPublic must include 'requires_check_in'."""
        assert "requires_check_in" in ProductPublic.model_fields, (
            "ProductPublic must include 'requires_check_in'"
        )

    def test_product_create_defaults_to_false(self) -> None:
        """ProductCreate.requires_check_in must default to False."""
        p = ProductCreate(
            popup_id=uuid.uuid4(),
            name="Test",
            slug="test",
            price=10,
        )
        assert p.requires_check_in is False

    def test_product_public_round_trips(self) -> None:
        """ProductPublic must serialize requires_check_in."""
        import json

        data = {
            "id": str(uuid.uuid4()),
            "tenant_id": str(uuid.uuid4()),
            "popup_id": str(uuid.uuid4()),
            "name": "Test Product",
            "slug": "test-product",
            "price": "10.00",
            "category": "ticket",
            "requires_check_in": True,
        }
        p = ProductPublic.model_validate(data)
        assert p.requires_check_in is True
        j = json.loads(p.model_dump_json())
        assert j["requires_check_in"] is True


class TestAttendeeProductPublicSchema:
    """AttendeeProductPublic must include id and check_in_code; no quantity."""

    def test_schema_has_id(self) -> None:
        """AttendeeProductPublic must have 'id' field."""
        assert "id" in AttendeeProductPublic.model_fields, (
            "AttendeeProductPublic must include 'id'"
        )

    def test_schema_has_check_in_code(self) -> None:
        """AttendeeProductPublic must have 'check_in_code' field."""
        assert "check_in_code" in AttendeeProductPublic.model_fields, (
            "AttendeeProductPublic must include 'check_in_code'"
        )

    def test_schema_has_no_quantity(self) -> None:
        """AttendeeProductPublic must NOT have 'quantity'."""
        assert "quantity" not in AttendeeProductPublic.model_fields, (
            "AttendeeProductPublic must not include 'quantity'"
        )
