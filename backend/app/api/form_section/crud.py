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
        limit: int | None = 100,
    ) -> tuple[list[FormSections], int]:
        """Find sections for a popup ordered by position.

        limit=None returns all sections (no offset/limit) — callers that
        post-filter in Python need the full set to paginate correctly.

        Returns ALL sections for the popup regardless of `sales_flow_id`
        (admin/legacy management surface — untouched by sdd/sales-flows
        slice 6, see `find_for_flow` for the flow-aware read path).
        """
        statement = (
            select(FormSections)
            .where(FormSections.popup_id == popup_id)
            .order_by(FormSections.order)
        )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        if limit is not None:
            statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def find_by_flow(
        self,
        session: Session,
        flow_id: uuid.UUID,
        skip: int = 0,
        limit: int | None = 100,
    ) -> tuple[list[FormSections], int]:
        """Sections owned exclusively by `flow_id` (sdd/sales-flows slice 6)."""
        statement = (
            select(FormSections)
            .where(FormSections.sales_flow_id == flow_id)
            .order_by(FormSections.order)
        )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        if limit is not None:
            statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def find_shared(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int | None = 100,
    ) -> tuple[list[FormSections], int]:
        """Popup-shared sections (`sales_flow_id IS NULL`) — the fallback
        tier every flow reads until it owns its own sections."""
        statement = (
            select(FormSections)
            .where(
                FormSections.popup_id == popup_id,
                FormSections.sales_flow_id.is_(None),  # type: ignore[union-attr]
            )
            .order_by(FormSections.order)
        )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        if limit is not None:
            statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def find_for_flow(
        self,
        session: Session,
        popup_id: uuid.UUID,
        flow_id: uuid.UUID | None,
        skip: int = 0,
        limit: int | None = 100,
    ) -> tuple[list[FormSections], int]:
        """Flow-owned sections if `flow_id` owns any, else the popup-shared
        fallback (Q1: flow-owned forms). `flow_id=None` always returns the
        popup-shared tier directly."""
        if flow_id is not None:
            flow_rows, flow_total = self.find_by_flow(
                session, flow_id, skip=skip, limit=limit
            )
            if flow_total:
                return flow_rows, flow_total
        return self.find_shared(session, popup_id, skip=skip, limit=limit)


form_sections_crud = FormSectionsCRUD()
