import uuid

from sqlmodel import Session, func, select

from app.api.ticketing_step.models import TicketingSteps
from app.api.ticketing_step.schemas import TicketingStepCreate, TicketingStepUpdate
from app.api.shared.crud import BaseCRUD


class TicketingStepsCRUD(BaseCRUD[TicketingSteps, TicketingStepCreate, TicketingStepUpdate]):
    def __init__(self) -> None:
        super().__init__(TicketingSteps)

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
