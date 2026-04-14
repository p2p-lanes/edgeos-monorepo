import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship

from app.api.event.schemas import EventBase

if TYPE_CHECKING:
    from app.api.event_participant.models import EventParticipants
    from app.api.event_venue.models import EventVenues
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants


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
    participants: list["EventParticipants"] = Relationship(
        back_populates="event",
        cascade_delete=True,
    )
