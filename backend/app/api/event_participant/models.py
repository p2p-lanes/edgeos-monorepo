import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship, text

from app.api.event_participant.schemas import EventParticipantBase

if TYPE_CHECKING:
    from app.api.event.models import Events
    from app.api.tenant.models import Tenants


class EventParticipants(EventParticipantBase, table=True):
    """Participant model for event registrations.

    Uniqueness is enforced via two partial indexes (created in migration
    ``0038_rsvp_occurrence_start``) so one-off events use ``(event_id,
    profile_id)`` while recurring instances use
    ``(event_id, profile_id, occurrence_start)``. Reflected here so
    SQLAlchemy/Alembic stay in sync with the database.
    """

    __tablename__ = "event_participants"
    __table_args__ = (
        Index(
            "uq_event_participant_oneoff",
            "event_id",
            "profile_id",
            unique=True,
            postgresql_where=text("occurrence_start IS NULL"),
        ),
        Index(
            "uq_event_participant_occurrence",
            "event_id",
            "profile_id",
            "occurrence_start",
            unique=True,
            postgresql_where=text("occurrence_start IS NOT NULL"),
        ),
        Index("ix_event_participants_profile_status", "profile_id", "status"),
        Index("ix_event_participants_event_status", "event_id", "status"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    tenant: "Tenants" = Relationship()
    event: "Events" = Relationship(back_populates="participants")
