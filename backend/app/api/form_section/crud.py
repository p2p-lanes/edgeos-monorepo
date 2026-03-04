import uuid

from sqlmodel import Session, func, select

from app.api.form_section.models import FormSections
from app.api.form_section.schemas import FormSectionCreate, FormSectionUpdate
from app.api.shared.crud import BaseCRUD


class FormSectionsCRUD(BaseCRUD[FormSections, FormSectionCreate, FormSectionUpdate]):
    def __init__(self) -> None:
        super().__init__(FormSections)

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[FormSections], int]:
        statement = (
            select(FormSections)
            .where(FormSections.popup_id == popup_id)
            .order_by(FormSections.order)
        )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total


form_sections_crud = FormSectionsCRUD()
