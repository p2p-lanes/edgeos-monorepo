"""Tests for TicketEvent model, CheckInPayload, and TicketEventPublic schemas.

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
        from app.api.ticket_event.schemas import CheckInPayload

        payload = CheckInPayload(source="qr")
        assert payload.source == "qr"

    def test_valid_manual_source(self) -> None:
        """CheckInPayload with source='manual' is valid."""
        from app.api.ticket_event.schemas import CheckInPayload

        payload = CheckInPayload(source="manual")
        assert payload.source == "manual"

    def test_invalid_source_raises(self) -> None:
        """CheckInPayload with unknown source raises ValidationError."""
        from pydantic import ValidationError

        from app.api.ticket_event.schemas import CheckInPayload

        with pytest.raises(ValidationError):
            CheckInPayload(source="invalid_source")

    def test_virtual_source_rejected(self) -> None:
        """'virtual' is no longer a valid source value."""
        from pydantic import ValidationError

        from app.api.ticket_event.schemas import CheckInPayload

        with pytest.raises(ValidationError):
            CheckInPayload(source="virtual")

    def test_admin_override_source_rejected(self) -> None:
        """'admin_override' is no longer a valid source value."""
        from pydantic import ValidationError

        from app.api.ticket_event.schemas import CheckInPayload

        with pytest.raises(ValidationError):
            CheckInPayload(source="admin_override")

    def test_notes_defaults_to_none(self) -> None:
        """notes defaults to None when not provided."""
        from app.api.ticket_event.schemas import CheckInPayload

        payload = CheckInPayload(source="qr")
        assert payload.notes is None

    def test_notes_accepted(self) -> None:
        """notes is accepted when provided."""
        from app.api.ticket_event.schemas import CheckInPayload

        payload = CheckInPayload(
            source="manual",
            notes="Manual override — bracelet lost",
        )
        assert payload.notes == "Manual override — bracelet lost"


class TestTicketEventPublic:
    """TicketEventPublic must expose all event log fields."""

    def test_ticket_event_public_fields(self) -> None:
        """TicketEventPublic must have id, event_type, occurred_at, payload."""
        from app.api.ticket_event.schemas import TicketEventPublic

        event = TicketEventPublic(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            attendee_product_id=uuid.uuid4(),
            event_type="check_in",
            occurred_at=datetime.now(),
            actor_user_id=None,
            payload={"source": "qr"},
            created_at=datetime.now(),
        )
        assert event.event_type == "check_in"
        assert event.payload == {"source": "qr"}
        assert event.actor_user_id is None

    def test_ticket_event_public_from_attributes(self) -> None:
        """TicketEventPublic must support from_attributes (ORM→schema)."""
        from app.api.ticket_event.schemas import TicketEventPublic

        config = TicketEventPublic.model_config
        assert config.get("from_attributes") is True, (
            "TicketEventPublic must have model_config with from_attributes=True"
        )


class TestTicketEventModel:
    """TicketEvent SQLModel must map to ticket_events table."""

    def test_ticket_event_table_name(self) -> None:
        """TicketEvent model must map to 'ticket_events' table."""
        from app.api.ticket_event.models import TicketEvent

        assert TicketEvent.__tablename__ == "ticket_events", (
            f"Expected table 'ticket_events', got '{TicketEvent.__tablename__}'"
        )

    def test_ticket_event_model_fields(self) -> None:
        """TicketEvent model must have all required fields."""
        from app.api.ticket_event.models import TicketEvent

        required_fields = {
            "id",
            "tenant_id",
            "attendee_product_id",
            "event_type",
            "occurred_at",
            "actor_user_id",
            "payload",
            "created_at",
        }
        model_fields = set(TicketEvent.model_fields.keys())
        missing = required_fields - model_fields
        assert not missing, f"TicketEvent missing fields: {missing}"

    def test_ticket_event_orm_create(
        self,
        db,
        tenant_a,
        popup_tenant_a,
    ) -> None:
        """TicketEvent can be created and persisted to DB."""
        import uuid
        from decimal import Decimal

        from app.api.attendee.models import AttendeeProducts, Attendees
        from app.api.human.models import Humans
        from app.api.product.models import Products
        from app.api.ticket_event.models import TicketEvent

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
            check_in_code=None,
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

        # Create a TicketEvent
        event = TicketEvent(
            id=uuid.uuid4(),
            tenant_id=tenant_a.id,
            attendee_product_id=ticket.id,
            event_type="check_in",
            actor_user_id=None,
            payload={"source": "qr", "notes": None},
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        assert event.id is not None
        assert event.event_type == "check_in"
        assert event.payload["source"] == "qr"
