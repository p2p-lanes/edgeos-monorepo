import uuid
from datetime import datetime

from sqlalchemy import Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, SQLModel


class HumanGoogleCredentials(SQLModel, table=True):
    """Per-human stored Google OAuth credentials.

    One row per human (enforced via unique constraint on human_id). The
    refresh_token is the primary artifact — access_token may be refreshed
    via google-auth on demand.
    """

    __tablename__ = "human_google_credentials"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    human_id: uuid.UUID = Field(foreign_key="humans.id", unique=True)
    access_token: str | None = Field(default=None, sa_type=Text())
    refresh_token: str = Field(sa_type=Text())
    token_expiry: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)
    )
    scope: str | None = Field(default=None, sa_type=Text())
    google_calendar_id: str = Field(default="primary", sa_type=Text())
    revoked: bool = Field(default=False)
    created_at: datetime = Field(
        default_factory=datetime.utcnow, sa_type=DateTime(timezone=True)
    )
    updated_at: datetime = Field(
        default_factory=datetime.utcnow, sa_type=DateTime(timezone=True)
    )


class EventGcalSync(SQLModel, table=True):
    """Tracks the Google Calendar event id mirroring an EdgeOS event for a human."""

    __tablename__ = "event_gcal_sync"
    __table_args__ = (
        UniqueConstraint("event_id", "human_id", name="uq_event_gcal_sync"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    event_id: uuid.UUID = Field(foreign_key="events.id", index=True)
    human_id: uuid.UUID = Field(foreign_key="humans.id", index=True)
    gcal_event_id: str = Field(sa_type=Text())
    last_synced_at: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)
    )
    etag: str | None = Field(default=None, sa_type=Text())
