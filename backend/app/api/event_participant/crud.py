import uuid

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
        self, session: Session, event_id: uuid.UUID, profile_id: uuid.UUID
    ) -> EventParticipants | None:
        statement = select(EventParticipants).where(
            EventParticipants.event_id == event_id,
            EventParticipants.profile_id == profile_id,
        )
        return session.exec(statement).first()

    def find_by_event(
        self,
        session: Session,
        event_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[EventParticipants], int]:
        return self.find(session, skip=skip, limit=limit, event_id=event_id)

    def count_active_for_event(self, session: Session, event_id: uuid.UUID) -> int:
        statement = (
            select(func.count())
            .select_from(EventParticipants)
            .where(
                EventParticipants.event_id == event_id,
                EventParticipants.status != ParticipantStatus.CANCELLED,
            )
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
