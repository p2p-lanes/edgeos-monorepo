import uuid
from datetime import datetime

from sqlmodel import Session, func, select

from app.api.event_participant.models import EventParticipants
from app.api.event_participant.schemas import (
    EventParticipantCreate,
    EventParticipantUpdate,
    ParticipantStatus,
)
from app.api.shared.crud import BaseCRUD


class EventParticipantsCRUD(BaseCRUD[EventParticipants, EventParticipantCreate, EventParticipantUpdate]):
    """CRUD operations for EventParticipants."""

    def __init__(self) -> None:
        super().__init__(EventParticipants)

    def get_by_event_and_profile(
        self,
        session: Session,
        event_id: uuid.UUID,
        profile_id: uuid.UUID,
        occurrence_start: datetime | None = None,
    ) -> EventParticipants | None:
        """Match a participant row.

        ``occurrence_start`` is part of the identity for recurring instances:
        ``NULL`` rows are reserved for one-off events and never collide with
        per-occurrence rows.
        """
        statement = select(EventParticipants).where(
            EventParticipants.event_id == event_id,
            EventParticipants.profile_id == profile_id,
        )
        if occurrence_start is None:
            statement = statement.where(
                EventParticipants.occurrence_start.is_(None)  # type: ignore[union-attr]
            )
        else:
            statement = statement.where(
                EventParticipants.occurrence_start == occurrence_start
            )
        return session.exec(statement).first()

    def find_by_event(
        self,
        session: Session,
        event_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        occurrence_start: datetime | None = None,
        scope_to_occurrence: bool = False,
    ) -> tuple[list[EventParticipants], int]:
        """List participants for an event.

        When ``scope_to_occurrence`` is True we filter to a single instance:
        ``occurrence_start`` matches exactly (or IS NULL for one-offs).
        Otherwise all rows for the event are returned (legacy behavior).
        """
        if not scope_to_occurrence:
            return self.find(session, skip=skip, limit=limit, event_id=event_id)
        statement = select(EventParticipants).where(
            EventParticipants.event_id == event_id,
        )
        if occurrence_start is None:
            statement = statement.where(
                EventParticipants.occurrence_start.is_(None)  # type: ignore[union-attr]
            )
        else:
            statement = statement.where(
                EventParticipants.occurrence_start == occurrence_start
            )
        rows = list(session.exec(statement.offset(skip).limit(limit)).all())
        total = session.exec(
            select(func.count()).select_from(statement.subquery())
        ).one()
        return rows, int(total)

    def count_active_for_event(
        self,
        session: Session,
        event_id: uuid.UUID,
        occurrence_start: datetime | None = None,
    ) -> int:
        statement = (
            select(func.count())
            .select_from(EventParticipants)
            .where(
                EventParticipants.event_id == event_id,
                EventParticipants.status != ParticipantStatus.CANCELLED,
            )
        )
        if occurrence_start is not None:
            statement = statement.where(
                EventParticipants.occurrence_start == occurrence_start
            )
        return session.exec(statement).one()

    def find_by_profile(
        self,
        session: Session,
        profile_id: uuid.UUID,
        popup_id: uuid.UUID | None = None,
        status: ParticipantStatus | None = None,
    ) -> list[EventParticipants]:
        from app.api.event.models import Events

        statement = select(EventParticipants).where(
            EventParticipants.profile_id == profile_id,
        )
        if popup_id:
            statement = statement.join(Events).where(Events.popup_id == popup_id)
        if status:
            statement = statement.where(EventParticipants.status == status)

        return list(session.exec(statement).all())


event_participants_crud = EventParticipantsCRUD()
