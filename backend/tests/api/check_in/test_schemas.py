"""Tests for CheckIn model, CheckInPayload, and CheckInPublic schemas.

TDD phase: RED — written before model/schema implementations.
Addendum #12 design spec.
"""

import uuid
from datetime import datetime

import pytest


class TestCheckInPayload:
    """CheckInPayload must validate source enum and optional fields."""

    def test_valid_qr_source(self) -> None:
        """CheckInPayload with source='qr' is valid."""
        from app.api.check_in.schemas import CheckInPayload

        payload = CheckInPayload(source="qr")
        assert payload.source == "qr"

    def test_valid_manual_source(self) -> None:
        """CheckInPayload with source='manual' is valid."""
        from app.api.check_in.schemas import CheckInPayload

        payload = CheckInPayload(source="manual")
        assert payload.source == "manual"

    def test_invalid_source_raises(self) -> None:
        """CheckInPayload with unknown source raises ValidationError."""
        from pydantic import ValidationError

        from app.api.check_in.schemas import CheckInPayload

        with pytest.raises(ValidationError):
            CheckInPayload(source="invalid_source")

    def test_virtual_source_rejected(self) -> None:
        """'virtual' is no longer a valid source value."""
        from pydantic import ValidationError

        from app.api.check_in.schemas import CheckInPayload

        with pytest.raises(ValidationError):
            CheckInPayload(source="virtual")

    def test_admin_override_source_rejected(self) -> None:
        """'admin_override' is no longer a valid source value."""
        from pydantic import ValidationError

        from app.api.check_in.schemas import CheckInPayload

        with pytest.raises(ValidationError):
            CheckInPayload(source="admin_override")

    def test_notes_defaults_to_none(self) -> None:
        """notes defaults to None when not provided."""
        from app.api.check_in.schemas import CheckInPayload

        payload = CheckInPayload(source="qr")
        assert payload.notes is None

    def test_notes_accepted(self) -> None:
        """notes is accepted when provided."""
        from app.api.check_in.schemas import CheckInPayload

        payload = CheckInPayload(
            source="manual",
            notes="Manual override — bracelet lost",
        )
        assert payload.notes == "Manual override — bracelet lost"


class TestCheckInPublic:
    """CheckInPublic must expose all event log fields."""

    def test_check_in_public_fields(self) -> None:
        """CheckInPublic must have id, occurred_at, payload, popup_id."""
        from app.api.check_in.schemas import CheckInPublic

        event = CheckInPublic(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            popup_id=uuid.uuid4(),
            attendee_product_id=uuid.uuid4(),
            occurred_at=datetime.now(),
            actor_user_id=None,
            payload={"source": "qr"},
            created_at=datetime.now(),
        )
        assert event.payload == {"source": "qr"}
        assert event.actor_user_id is None

    def test_check_in_public_from_attributes(self) -> None:
        """CheckInPublic must support from_attributes (ORM→schema)."""
        from app.api.check_in.schemas import CheckInPublic

        config = CheckInPublic.model_config
        assert config.get("from_attributes") is True, (
            "CheckInPublic must have model_config with from_attributes=True"
        )


class TestCheckInModel:
    """CheckIn SQLModel must map to check_ins table."""

    def test_check_in_table_name(self) -> None:
        """CheckIn model must map to 'check_ins' table."""
        from app.api.check_in.models import CheckIn

        assert CheckIn.__tablename__ == "check_ins", (
            f"Expected table 'check_ins', got '{CheckIn.__tablename__}'"
        )

    def test_check_in_model_fields(self) -> None:
        """CheckIn model must have all required fields."""
        from app.api.check_in.models import CheckIn

        required_fields = {
            "id",
            "tenant_id",
            "popup_id",
            "attendee_product_id",
            "occurred_at",
            "actor_user_id",
            "payload",
            "created_at",
        }
        model_fields = set(CheckIn.model_fields.keys())
        missing = required_fields - model_fields
        assert not missing, f"CheckIn missing fields: {missing}"

    def test_check_in_orm_create(
        self,
        db,
        tenant_a,
        popup_tenant_a,
    ) -> None:
        """CheckIn can be created and persisted to DB."""
        import uuid
        from decimal import Decimal

        from app.api.attendee.models import AttendeeProducts, Attendees
        from app.api.check_in.models import CheckIn
        from app.api.human.models import Humans
        from app.api.product.models import Products

        # Create minimal product + attendee + ticket
        product = Products(
            id=uuid.uuid4(),
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            name=f"Schema Test Product {uuid.uuid4().hex[:6]}",
            slug=f"schema-test-{uuid.uuid4().hex[:6]}",
            price=Decimal("10"),
            category="ticket",
        )
        db.add(product)
        db.commit()

        human = Humans(
            id=uuid.uuid4(),
            tenant_id=tenant_a.id,
            email=f"te-schema-{uuid.uuid4().hex[:8]}@test.com",
            first_name="Schema",
            last_name="Test",
        )
        db.add(human)
        db.commit()

        attendee = Attendees(
            id=uuid.uuid4(),
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=human.id,
            name="Schema Test Attendee",
            category="main",
        )
        db.add(attendee)
        db.commit()

        ticket = AttendeeProducts(
            id=uuid.uuid4(),
            tenant_id=tenant_a.id,
            attendee_id=attendee.id,
            product_id=product.id,
            check_in_code=f"SCH{uuid.uuid4().hex[:5].upper()}",
        )
        db.add(ticket)
        db.commit()

        # Create a CheckIn
        event = CheckIn(
            id=uuid.uuid4(),
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            attendee_product_id=ticket.id,
            actor_user_id=None,
            payload={"source": "qr", "notes": None},
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        assert event.id is not None
        assert event.payload["source"] == "qr"
