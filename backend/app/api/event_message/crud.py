import uuid
from datetime import UTC, datetime

from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, col, func, select

from app.api.event_message.models import EventMessages


class EventMessagesCRUD:
    def reserve(self, session: Session, message: EventMessages) -> bool:
        """Claim a send ID before SMTP so a retry never sends the message twice."""
        result = session.execute(
            insert(EventMessages)
            .values(**message.model_dump())
            .on_conflict_do_nothing(index_elements=["id"])
            .returning(EventMessages.id)
        ).scalar_one_or_none()
        session.commit()
        return result is not None

    def get(self, session: Session, message_id: uuid.UUID) -> EventMessages | None:
        return session.get(EventMessages, message_id)

    def record_delivery(
        self, session: Session, message: EventMessages, *, sent: bool
    ) -> None:
        if sent:
            message.sent_count += 1
        else:
            message.failed_count += 1
        session.add(message)
        session.commit()

    def complete(self, session: Session, message: EventMessages) -> None:
        message.completed_at = datetime.now(UTC)
        session.add(message)
        session.commit()
        session.refresh(message)

    def list_for_event(
        self, session: Session, event_id: uuid.UUID, skip: int, limit: int
    ) -> tuple[list[EventMessages], int]:
        query = select(EventMessages).where(EventMessages.event_id == event_id)
        total = session.exec(select(func.count()).select_from(query.subquery())).one()
        rows = session.exec(
            query.order_by(
                col(EventMessages.created_at).desc(), col(EventMessages.id).desc()
            )
            .offset(skip)
            .limit(limit)
        ).all()
        return list(rows), total


event_messages_crud = EventMessagesCRUD()
