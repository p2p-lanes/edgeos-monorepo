from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.popup.schemas import PopupCreate, PopupUpdate
from app.api.shared.crud import BaseCRUD


class PopupsCRUD(BaseCRUD[Popups, PopupCreate, PopupUpdate]):
    def __init__(self) -> None:
        super().__init__(Popups)

    def get_by_slug(self, session: Session, slug: str) -> Popups | None:
        return self.get_by_field(session, "slug", slug)

    def create(self, session: Session, obj_in: PopupCreate) -> Popups:
        """Create a popup and seed the main attendee category in the same transaction."""
        from app.api.attendee_category.crud import attendee_categories_crud

        popup = self.model(**obj_in.model_dump())
        session.add(popup)
        session.flush()  # Get the popup id without committing

        # Seed main category in same transaction
        attendee_categories_crud.seed_main_for_popup(
            session, popup.id, popup.tenant_id
        )

        session.commit()
        session.refresh(popup)
        return popup


popups_crud = PopupsCRUD()
