import uuid

from fastapi import HTTPException, status
from sqlmodel import Session, func, select

from app.api.shared.crud import BaseCRUD
from app.api.ticketing_step.models import TicketingSteps
from app.api.ticketing_step.schemas import TicketingStepCreate, TicketingStepUpdate


class TicketingStepsCRUD(
    BaseCRUD[TicketingSteps, TicketingStepCreate, TicketingStepUpdate]
):
    def __init__(self) -> None:
        super().__init__(TicketingSteps)

    def _assert_no_active_patron_preset(
        self,
        session: Session,
        popup_id: uuid.UUID,
        exclude_id: uuid.UUID | None = None,
    ) -> None:
        """Raise 422 if an enabled patron-preset step already exists for this popup."""
        stmt = select(TicketingSteps).where(
            TicketingSteps.popup_id == popup_id,
            TicketingSteps.template == "patron-preset",
            TicketingSteps.is_enabled == True,  # noqa: E712
        )
        if exclude_id is not None:
            stmt = stmt.where(TicketingSteps.id != exclude_id)
        existing = session.exec(stmt).first()
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "This popup already has a Patron step. "
                    "Only one Patron step is allowed per popup."
                ),
            )

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[TicketingSteps], int]:
        statement = (
            select(TicketingSteps)
            .where(TicketingSteps.popup_id == popup_id)
            .order_by(TicketingSteps.order)
        )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def find_portal_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
    ) -> list[TicketingSteps]:
        """Return only enabled steps, ordered by order. No auth required."""
        statement = (
            select(TicketingSteps)
            .where(
                TicketingSteps.popup_id == popup_id,
                TicketingSteps.is_enabled == True,  # noqa: E712
            )
            .order_by(TicketingSteps.order)
        )
        return list(session.exec(statement).all())


ticketing_steps_crud = TicketingStepsCRUD()
