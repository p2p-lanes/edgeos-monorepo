import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship

from app.api.event_participant.schemas import EventParticipantBase

if TYPE_CHECKING:
    from app.api.event.models import Events
    from app.api.tenant.models import Tenants


class EventParticipants(EventParticipantBase, table=True):
    """Participant model for event registrations."""

    __tablename__ = "event_participants"
    __table_args__ = (
        UniqueConstraint("event_id", "profile_id", name="uq_event_participant"),
        Index("ix_event_participants_profile_status", "profile_id", "status"),
        Index("ix_event_participants_event_status", "event_id", "status"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    tenant: "Tenants" = Relationship()
    event: "Events" = Relationship(back_populates="participants")
