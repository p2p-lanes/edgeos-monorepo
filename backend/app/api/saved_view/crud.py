import uuid

from sqlmodel import Session, select

from app.api.saved_view.models import SavedViews
from app.api.saved_view.schemas import SavedViewCreate, SavedViewUpdate
from app.api.shared.crud import BaseCRUD


class SavedViewsCRUD(BaseCRUD[SavedViews, SavedViewCreate, SavedViewUpdate]):
    """CRUD operations for SavedViews."""

    def __init__(self) -> None:
        super().__init__(SavedViews)

    def find_by_popup_entity(
        self, session: Session, popup_id: uuid.UUID, entity: str
    ) -> list[SavedViews]:
        statement = (
            select(SavedViews)
            .where(
                SavedViews.popup_id == popup_id,
                SavedViews.entity == entity,
            )
            .order_by(SavedViews.name)  # ty: ignore[invalid-argument-type]
        )
        return list(session.exec(statement).all())

    def get_by_popup_entity_name(
        self, session: Session, popup_id: uuid.UUID, entity: str, name: str
    ) -> SavedViews | None:
        statement = select(SavedViews).where(
            SavedViews.popup_id == popup_id,
            SavedViews.entity == entity,
            SavedViews.name == name,
        )
        return session.exec(statement).first()

    def create_view(
        self,
        session: Session,
        *,
        tenant_id: uuid.UUID,
        popup_id: uuid.UUID,
        entity: str,
        name: str,
        config: dict,
        created_by: uuid.UUID,
    ) -> SavedViews:
        db_obj = SavedViews(
            tenant_id=tenant_id,
            popup_id=popup_id,
            entity=entity,
            name=name,
            config=config,
            created_by=created_by,
        )
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def update_view(
        self,
        session: Session,
        view: SavedViews,
        *,
        name: str | None = None,
        config: dict | None = None,
    ) -> SavedViews:
        if name is not None:
            view.name = name
        if config is not None:
            view.config = config
        session.add(view)
        session.commit()
        session.refresh(view)
        return view


saved_views_crud = SavedViewsCRUD()
