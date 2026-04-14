import uuid
from typing import TYPE_CHECKING

from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship

from app.api.event_venue.schemas import EventVenueBase

if TYPE_CHECKING:
    from app.api.event.models import Events
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants


class EventVenues(EventVenueBase, table=True):
    """Venue model for event locations."""

    __tablename__ = "event_venues"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    tenant: "Tenants" = Relationship()
    popup: "Popups" = Relationship()
    events: list["Events"] = Relationship(back_populates="venue")
