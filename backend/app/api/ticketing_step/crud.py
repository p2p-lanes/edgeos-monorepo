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
        flow_id: uuid.UUID,
        exclude_id: uuid.UUID | None = None,
    ) -> None:
        """Raise 422 if `flow_id` already has an enabled patron-preset step
        (sdd/sales-flows-rediseno slice 2) — mirrors the DB-level
        `uq_ticketing_step_patron_flow` partial unique index."""
        stmt = select(TicketingSteps).where(
            TicketingSteps.sales_flow_id == flow_id,
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
                    "This sales flow already has a Patron step. "
                    "Only one Patron step is allowed per sales flow."
                ),
            )

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[TicketingSteps], int]:
        """Every step of a popup, across all of its flows — the admin
        cross-flow surface. Use `find_by_flow` to read one flow's list."""
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

    def find_by_flow(
        self,
        session: Session,
        flow_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[TicketingSteps], int]:
        """The step list of `flow_id` — the only way to read steps for a
        flow (sdd/sales-flows-rediseno slice 2). An empty result means the
        flow has no steps, never that it should borrow someone else's."""
        statement = (
            select(TicketingSteps)
            .where(TicketingSteps.sales_flow_id == flow_id)
            .order_by(TicketingSteps.order)
        )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def find_portal_by_flow(
        self,
        session: Session,
        flow_id: uuid.UUID,
    ) -> list[TicketingSteps]:
        """Enabled steps of `flow_id`, ordered. The portal read path — no
        auth required, and no fallback: what this flow owns is what the
        buyer sees."""
        statement = (
            select(TicketingSteps)
            .where(
                TicketingSteps.sales_flow_id == flow_id,
                TicketingSteps.is_enabled == True,  # noqa: E712
            )
            .order_by(TicketingSteps.order)
        )
        return list(session.exec(statement).all())


ticketing_steps_crud = TicketingStepsCRUD()
