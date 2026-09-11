"""Whether a sales flow can actually complete a sale.

Design: sdd/sales-flows-rediseno slice 8. The flow list showed
configuration — name, slug, type, visibility. Configuration does not tell
an operator that a flow is broken. A flow with no enabled steps looks
exactly like a working one in that table, and the buyer is the first to
find out: the empty checkout step that started this redesign was a flow in
that state.

This module answers a different question. It reports what each flow is
missing, in the buyer's terms rather than the schema's.

A blocker means the flow cannot complete a sale today. A warning means the
flow works but does something an operator does not usually intend.
"""

import uuid

from sqlmodel import Session, func, select

from app.api.approval_strategy.schemas import ApprovalStrategyType
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import (
    SalesFlowReadiness,
    SalesFlowType,
    SalesFlowVisibility,
)

# Blocker codes — the flow cannot complete a sale.
NO_STEPS = "no_steps"
SELLS_NOTHING = "sells_nothing"
NO_FORM = "no_form"

# Warning codes — the flow works, but not the way most operators expect.
UNLISTED = "unlisted"
ACCEPTS_EVERYONE = "accepts_everyone"


def _enabled_step_count(session: Session, flow_id: uuid.UUID) -> int:
    from app.api.ticketing_step.models import TicketingSteps

    return (
        session.exec(
            select(func.count())
            .select_from(TicketingSteps)
            .where(
                TicketingSteps.sales_flow_id == flow_id,
                TicketingSteps.is_enabled == True,  # noqa: E712
            )
        ).one()
        or 0
    )


def _form_field_count(
    session: Session,
    popup_id: uuid.UUID,
    flow_id: uuid.UUID,
) -> int:
    from app.api.form_field.crud import form_fields_crud

    schema = form_fields_crud.build_schema_for_flow(session, popup_id, flow_id)
    return len(schema["base_fields"]) + len(schema["custom_fields"])


def flow_readiness(session: Session, flow: SalesFlows) -> SalesFlowReadiness:
    """What `flow` is missing before it can sell."""
    from app.api.approval_strategy.crud import approval_strategies_crud
    from app.services.restrictions.offering import flow_offered_product_ids

    step_count = _enabled_step_count(session, flow.id)
    offered = flow_offered_product_ids(session, flow.id, flow.popup_id)
    field_count = _form_field_count(session, flow.popup_id, flow.id)
    is_application = flow.type == SalesFlowType.application
    strategy = (
        approval_strategies_crud.get_by_flow(session, flow.id)
        if is_application
        else None
    )
    has_strategy = False
    if is_application:
        has_strategy = (
            approval_strategies_crud.get_override_by_flow(session, flow.id) is not None
            or approval_strategies_crud.get_by_popup(session, flow.popup_id) is not None
        )

    blockers: list[str] = []
    if step_count == 0:
        # No enabled step means the checkout renders nothing at all. This is
        # the state the redesign opened on.
        blockers.append(NO_STEPS)
    elif not offered:
        # Steps exist but name no active product, so every step is empty.
        blockers.append(SELLS_NOTHING)
    if is_application and field_count == 0:
        blockers.append(NO_FORM)

    warnings: list[str] = []
    if flow.visibility == SalesFlowVisibility.direct_url_only:
        warnings.append(UNLISTED)
    if (
        strategy is not None
        and strategy.strategy_type == ApprovalStrategyType.AUTO_ACCEPT
    ):
        warnings.append(ACCEPTS_EVERYONE)

    return SalesFlowReadiness(
        flow_id=flow.id,
        enabled_step_count=step_count,
        offered_product_count=len(offered),
        form_field_count=field_count,
        has_approval_strategy=has_strategy,
        blockers=blockers,
        warnings=warnings,
    )
