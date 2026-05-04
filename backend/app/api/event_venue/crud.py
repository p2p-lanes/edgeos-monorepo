import uuid

from sqlmodel import Session, col, func, select

from app.api.event_venue.models import EventVenues
from app.api.event_venue.schemas import EventVenueCreate, EventVenueUpdate
from app.api.shared.crud import BaseCRUD


class EventVenuesCRUD(BaseCRUD[EventVenues, EventVenueCreate, EventVenueUpdate]):
    """CRUD operations for EventVenues."""

    def __init__(self) -> None:
        super().__init__(EventVenues)

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        search: str | None = None,
    ) -> tuple[list[EventVenues], int]:
        statement = select(EventVenues).where(EventVenues.popup_id == popup_id)

        if search:
            term = f"%{search}%"
            statement = statement.where(
                col(EventVenues.title).ilike(term)
                | col(EventVenues.location).ilike(term)
            )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.order_by(EventVenues.title)
        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total


event_venues_crud = EventVenuesCRUD()
