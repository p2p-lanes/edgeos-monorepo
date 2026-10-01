import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Index, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship, SQLModel, text

from app.api.event_participant.schemas import CheckInMethod, EventParticipantBase

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


class EventCheckIns(SQLModel, table=True):
    """One attendance mark, and its annulment if it was voided (SIM-106).

    ``event_participants.status`` says whether someone is present *now*;
    this table says how they got there and how that changed. A void never
    deletes the row: it stamps who voided it, when and why, and a later
    check-in adds a new row, so a correction never loses the earlier mark.

    At most one un-voided row per participation (partial unique index), so
    two concurrent marks for the same person cannot both land.
    """

    __tablename__ = "event_check_ins"
    __table_args__ = (
        Index(
            "uq_event_check_ins_active_participant",
            "participant_id",
            unique=True,
            postgresql_where=text("voided_at IS NULL"),
        ),
        Index("ix_event_check_ins_event_occurrence", "event_id", "occurrence_start"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    event_id: uuid.UUID = Field(foreign_key="events.id")
    participant_id: uuid.UUID = Field(foreign_key="event_participants.id", index=True)
    profile_id: uuid.UUID = Field(index=True)
    occurrence_start: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)
    )
    method: CheckInMethod = Field(max_length=20)
    # Whether the person held a seat (an RSVP) before this mark. Decides what
    # a void restores: back to ``registered``, or ``cancelled`` for a walk-in
    # so the seat they took is freed.
    had_rsvp: bool = Field(default=False)
    checked_in_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_type=DateTime(timezone=True),
    )
    # Exactly one of the actor pair is set when known: a portal human (the
    # attendee scanning, or an organizer on the roll call) or a backoffice
    # user. Both NULL only for rows backfilled from before this table.
    checked_in_by_human_id: uuid.UUID | None = Field(default=None)
    checked_in_by_user_id: uuid.UUID | None = Field(default=None)
    # Display name of the actor when the mark was made. Kept on the row
    # because tenant sessions cannot read backoffice users, and because the
    # history should say who acted as they were known at the time.
    checked_in_by_name: str | None = Field(default=None, max_length=255)
    voided_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    voided_by_human_id: uuid.UUID | None = Field(default=None)
    voided_by_user_id: uuid.UUID | None = Field(default=None)
    voided_by_name: str | None = Field(default=None, max_length=255)
    void_reason: str | None = Field(default=None, sa_type=Text())
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_type=DateTime(timezone=True),
    )
