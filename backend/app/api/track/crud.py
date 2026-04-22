import uuid

from sqlmodel import Session, col, func, select

from app.api.shared.crud import BaseCRUD
from app.api.track.models import Tracks
from app.api.track.schemas import TrackCreate, TrackUpdate


class TracksCRUD(BaseCRUD[Tracks, TrackCreate, TrackUpdate]):
    def __init__(self) -> None:
        super().__init__(Tracks)

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        search: str | None = None,
    ) -> tuple[list[Tracks], int]:
        statement = select(Tracks).where(Tracks.popup_id == popup_id)

        if search:
            term = f"%{search}%"
            statement = statement.where(col(Tracks.name).ilike(term))

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.order_by(Tracks.name).offset(skip).limit(limit)
        return list(session.exec(statement).all()), total


tracks_crud = TracksCRUD()
