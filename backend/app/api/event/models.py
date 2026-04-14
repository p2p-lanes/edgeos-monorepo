import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship, SQLModel

from app.api.event.schemas import EventBase

if TYPE_CHECKING:
    from app.api.event_participant.models import EventParticipants
    from app.api.event_venue.models import EventVenues
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants
    from app.api.track.models import Tracks


class Events(EventBase, table=True):
    """Event model for community events within a popup."""

    __table_args__ = (
        Index(
            "ix_events_popup_status_start",
            "popup_id",
            "status",
            "start_time",
        ),
        Index(
            "ix_events_published_lookup",
            "popup_id",
            "start_time",
            postgresql_where=text("status = 'published'"),
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    tenant: "Tenants" = Relationship(back_populates="events")
    popup: "Popups" = Relationship(back_populates="events")
    venue: Optional["EventVenues"] = Relationship(back_populates="events")
    track: Optional["Tracks"] = Relationship(back_populates="events")
    participants: list["EventParticipants"] = Relationship(
        back_populates="event",
        cascade_delete=True,
    )
    invitations: list["EventInvitations"] = Relationship(
        back_populates="event", cascade_delete=True
    )


class EventInvitations(SQLModel, table=True):
    """Invitation of a human to view/RSVP a private or unlisted event."""

    __tablename__ = "event_invitations"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    event_id: uuid.UUID = Field(foreign_key="events.id", index=True)
    human_id: uuid.UUID = Field(foreign_key="humans.id", index=True)
    invited_by: uuid.UUID | None = Field(default=None)
    created_at: datetime = Field(
        default_factory=datetime.utcnow, sa_type=DateTime(timezone=True)
    )

    event: "Events" = Relationship(back_populates="invitations")
