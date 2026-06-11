import uuid
from typing import Any

from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, func, or_, select

from app.api.event_venue.models import EventVenues
from app.api.event_venue.schemas import (
    EventVenueCreate,
    EventVenueUpdate,
    VenueStatus,
)
from app.api.shared.crud import BaseCRUD


def _eager_load_options() -> tuple:
    """Relationships fetched alongside every EventVenues list query.

    EventVenuePublic includes weekly_hours, so without eager loading every
    listing endpoint issues one SELECT per venue (Sentry N+1 alert).
    """
    return (selectinload(EventVenues.weekly_hours),)  # type: ignore[arg-type]


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
        active_only: bool = False,
    ) -> tuple[list[EventVenues], int]:
        statement = select(EventVenues).where(EventVenues.popup_id == popup_id)

        if active_only:
            statement = statement.where(EventVenues.status == VenueStatus.ACTIVE.value)

        if search:
            term = f"%{search}%"
            statement = statement.where(
                col(EventVenues.title).ilike(term)
                | col(EventVenues.location).ilike(term)
            )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = (
            statement.options(*_eager_load_options())
            .order_by(EventVenues.display_order, EventVenues.title)
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())

        return results, total

    def find(
        self,
        session: Session,
        skip: int = 0,
        limit: int = 100,
        search: str | None = None,
        search_fields: list[str] | None = None,
        sort_by: str | None = None,
        sort_order: str = "desc",
        **filters: Any,
    ) -> tuple[list[EventVenues], int]:
        """Override BaseCRUD.find to eager-load weekly_hours."""
        statement = select(EventVenues)

        for field, value in filters.items():
            if value is not None:
                statement = statement.where(getattr(EventVenues, field) == value)

        if search and search_fields:
            term = f"%{search}%"
            search_conditions = [
                getattr(EventVenues, field).ilike(term)
                for field in search_fields
                if hasattr(EventVenues, field)
            ]
            if search_conditions:
                statement = statement.where(or_(*search_conditions))

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = self._apply_sorting(statement, sort_by, sort_order)
        statement = statement.options(*_eager_load_options()).offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total


event_venues_crud = EventVenuesCRUD()
