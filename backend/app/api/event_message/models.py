import uuid
from datetime import UTC, datetime

from sqlalchemy import Index, Text
from sqlmodel import DateTime, Field, SQLModel


class EventMessages(SQLModel, table=True):
    __tablename__ = "event_messages"
    __table_args__ = (
        Index("ix_event_messages_event_created", "event_id", "created_at"),
    )

    id: uuid.UUID = Field(primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    event_id: uuid.UUID = Field(foreign_key="events.id", ondelete="CASCADE")
    author_id: uuid.UUID
    author_name: str
    body: str = Field(sa_type=Text())
    occurrence_start: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)
    )
    recipient_count: int
    sent_count: int = 0
    failed_count: int = 0
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC), sa_type=DateTime(timezone=True)
    )
    completed_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
