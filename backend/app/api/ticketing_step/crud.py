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
        flow_id: uuid.UUID | None = None,
    ) -> None:
        """Raise 422 if an enabled patron-preset step already exists at this
        tier (sdd/sales-flows slice 8): the flow's own tier when `flow_id`
        is set, otherwise the popup-shared tier (`sales_flow_id IS NULL`) —
        mirrors the DB-level two-tier partial unique index."""
        stmt = select(TicketingSteps).where(
            TicketingSteps.popup_id == popup_id,
            TicketingSteps.template == "patron-preset",
            TicketingSteps.is_enabled == True,  # noqa: E712
        )
        if flow_id is not None:
            stmt = stmt.where(TicketingSteps.sales_flow_id == flow_id)
        else:
            stmt = stmt.where(TicketingSteps.sales_flow_id.is_(None))  # type: ignore[union-attr]
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
        """Find all steps for a popup, regardless of `sales_flow_id` tier
        (admin/legacy surface, sdd/sales-flows slice 8 — see `find_for_flow`
        for the flow-aware read path)."""
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
        """Steps owned exclusively by `flow_id` (sdd/sales-flows slice 8)."""
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

    def find_shared(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[TicketingSteps], int]:
        """Popup-shared steps (`sales_flow_id IS NULL`) — the fallback
        every flow reads until it owns its own step list."""
        statement = (
            select(TicketingSteps)
            .where(
                TicketingSteps.popup_id == popup_id,
                TicketingSteps.sales_flow_id.is_(None),  # type: ignore[union-attr]
            )
            .order_by(TicketingSteps.order)
        )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def find_for_flow(
        self,
        session: Session,
        popup_id: uuid.UUID,
        flow_id: uuid.UUID | None,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[TicketingSteps], int]:
        """Flow-owned steps if `flow_id` owns any, else the popup-shared
        fallback (sdd/sales-flows slice 8). `flow_id=None` always resolves
        the popup-shared tier. Ownership is ANY row for that flow,
        regardless of `is_enabled` — a flow that owns a fully-disabled step
        list still owns it, it never falls through to the popup tier."""
        if flow_id is not None:
            flow_steps, total = self.find_by_flow(
                session, flow_id, skip=skip, limit=limit
            )
            if flow_steps:
                return flow_steps, total
        return self.find_shared(session, popup_id, skip=skip, limit=limit)

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

    def find_portal_by_flow(
        self,
        session: Session,
        flow_id: uuid.UUID,
    ) -> list[TicketingSteps]:
        """Enabled steps owned exclusively by `flow_id`. No auth required."""
        statement = (
            select(TicketingSteps)
            .where(
                TicketingSteps.sales_flow_id == flow_id,
                TicketingSteps.is_enabled == True,  # noqa: E712
            )
            .order_by(TicketingSteps.order)
        )
        return list(session.exec(statement).all())

    def find_portal_shared(
        self,
        session: Session,
        popup_id: uuid.UUID,
    ) -> list[TicketingSteps]:
        """Enabled popup-shared steps (`sales_flow_id IS NULL`) — the exact
        step list every popup rendered before sdd/sales-flows slice 8."""
        statement = (
            select(TicketingSteps)
            .where(
                TicketingSteps.popup_id == popup_id,
                TicketingSteps.sales_flow_id.is_(None),  # type: ignore[union-attr]
                TicketingSteps.is_enabled == True,  # noqa: E712
            )
            .order_by(TicketingSteps.order)
        )
        return list(session.exec(statement).all())

    def find_portal_for_flow(
        self,
        session: Session,
        popup_id: uuid.UUID,
        flow_id: uuid.UUID | None,
    ) -> list[TicketingSteps]:
        """Enabled flow-owned steps if `flow_id` owns ANY step (enabled or
        not), else the enabled popup-shared fallback (sdd/sales-flows
        slice 8, no auth required — portal surface)."""
        if flow_id is not None:
            owns_any = (
                session.exec(
                    select(func.count())
                    .select_from(TicketingSteps)
                    .where(TicketingSteps.sales_flow_id == flow_id)
                ).one()
                > 0
            )
            if owns_any:
                return self.find_portal_by_flow(session, flow_id)
        return self.find_portal_shared(session, popup_id)


ticketing_steps_crud = TicketingStepsCRUD()
