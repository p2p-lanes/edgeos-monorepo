import uuid
from datetime import datetime

from sqlalchemy import asc
from sqlmodel import Session, col, func, select

from app.api.event.models import Events
from app.api.event.schemas import EventCreate, EventStatus, EventUpdate
from app.api.shared.crud import BaseCRUD


class EventsCRUD(BaseCRUD[Events, EventCreate, EventUpdate]):
    """CRUD operations for Events."""

    def __init__(self) -> None:
        super().__init__(Events)

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        event_status: EventStatus | None = None,
        kind: str | None = None,
        start_after: datetime | None = None,
        start_before: datetime | None = None,
        search: str | None = None,
    ) -> tuple[list[Events], int]:
        statement = select(Events).where(Events.popup_id == popup_id)

        if event_status is not None:
            statement = statement.where(Events.status == event_status)
        if kind is not None:
            statement = statement.where(Events.kind == kind)
        if start_after is not None:
            statement = statement.where(Events.start_time >= start_after)
        if start_before is not None:
            statement = statement.where(Events.start_time <= start_before)
        if search:
            statement = statement.where(col(Events.title).ilike(f"%{search}%"))

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.order_by(asc(Events.start_time))
        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def find_by_owner(
        self,
        session: Session,
        owner_id: uuid.UUID,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Events], int]:
        return self.find(
            session,
            skip=skip,
            limit=limit,
            sort_by="start_time",
            sort_order="asc",
            owner_id=owner_id,
            popup_id=popup_id,
        )


events_crud = EventsCRUD()
