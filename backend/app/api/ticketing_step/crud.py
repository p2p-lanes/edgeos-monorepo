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

    def copy_steps_to_flow(
        self,
        session: Session,
        *,
        tenant_id: uuid.UUID,
        popup_id: uuid.UUID,
        target_flow_id: uuid.UUID,
        source_flow_id: uuid.UUID,
    ) -> int:
        """Copy `source_flow_id`'s steps into `target_flow_id` as new rows.

        This is how a flow gets steps without inheriting any
        (sdd/sales-flows-rediseno R3): copying is a one-time event, after
        which the two flows are independent and editing either never
        reaches the other. Copying a flow with no steps yields none, which
        is the honest answer.

        The target's existing steps are deleted first, so this genuinely
        REPLACES rather than appends — matching what the create screen
        promises when it offers to start from another flow.
        """
        existing, _ = self.find_by_flow(session, target_flow_id, limit=1000)
        for step in existing:
            session.delete(step)
        session.flush()

        source, _ = self.find_by_flow(session, source_flow_id, limit=1000)
        for step in source:
            session.add(
                TicketingSteps(
                    tenant_id=tenant_id,
                    popup_id=popup_id,
                    sales_flow_id=target_flow_id,
                    step_type=step.step_type,
                    title=step.title,
                    description=step.description,
                    order=step.order,
                    is_enabled=step.is_enabled,
                    protected=step.protected,
                    product_category=step.product_category,
                    template=step.template,
                    template_config=step.template_config,
                    watermark=step.watermark,
                    show_title=step.show_title,
                    show_watermark=step.show_watermark,
                    show_in_navbar=step.show_in_navbar,
                    emoji=step.emoji,
                )
            )
        session.commit()
        return len(source)


ticketing_steps_crud = TicketingStepsCRUD()
