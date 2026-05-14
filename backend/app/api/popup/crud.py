from typing import Any

from sqlalchemy import case
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.popup.schemas import PopupCreate, PopupStatus, PopupUpdate
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
        attendee_categories_crud.seed_main_for_popup(session, popup.id, popup.tenant_id)

        session.commit()
        session.refresh(popup)
        return popup

    def _apply_sorting(
        self,
        statement: Any,
        sort_by: str | None = None,
        sort_order: str = "desc",
    ) -> Any:
        if sort_by:
            return super()._apply_sorting(statement, sort_by, sort_order)
        active_first = case(
            (Popups.status == PopupStatus.active, 0),  # ty: ignore[invalid-argument-type]
            else_=1,
        )
        return statement.order_by(
            active_first,
            Popups.start_date.desc().nulls_last(),  # type: ignore[attr-defined]
        )


popups_crud = PopupsCRUD()
