"""Tests for flow-scoped approval strategy resolution (sdd/sales-flows slice 7).

Design: orchestrator's binding extension of D4 — the one-per-popup
`approval_strategies` constraint re-keys to the flow dimension with popup
fallback, mirroring the reviewer tri-state's own two-tier pattern.
`get_by_flow(session, sales_flow_id)` returns that flow's own strategy
if one exists, else the popup-shared (`sales_flow_id IS NULL`) fallback. No write
path creates a flow-scoped row yet (the backoffice editor is slice 14) —
these tests seed rows directly to prove the resolution logic ahead of that
write path.
"""

import uuid

from sqlmodel import Session

from app.api.approval_strategy.crud import approval_strategies_crud
from app.api.approval_strategy.models import ApprovalStrategies
from app.api.approval_strategy.schemas import ApprovalStrategyType
from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import (
    SalesFlowIdentityMode,
    SalesFlowReviewersMode,
    SalesFlowVisibility,
)
from app.api.tenant.models import Tenants
from tests._flow_helpers import provision_default_flow


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Strategy Flow Popup {uuid.uuid4().hex[:8]}",
        slug=f"strategy-flow-popup-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    provision_default_flow(db, popup)
    return popup


def _make_flow(db: Session, tenant: Tenants, popup: Popups, *, slug: str) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=tenant.id,
        popup_id=popup.id,
        type="application",
        slug=slug,
        name=slug,
        visibility=SalesFlowVisibility.portal_listed,
        is_default=False,
        order=0,
        reviewers_mode=SalesFlowReviewersMode.inherit,
        identity_mode=SalesFlowIdentityMode.portal_auth,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _make_strategy(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    strategy_type: ApprovalStrategyType,
    sales_flow_id: uuid.UUID,
) -> ApprovalStrategies:
    strategy = ApprovalStrategies(
        tenant_id=tenant.id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id,
        strategy_type=strategy_type,
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


class TestStrategyOwnership:
    def test_flow_without_a_strategy_gets_none(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The deleted fallback: a sibling's strategy must not leak in."""
        popup = _make_popup(db, tenant_a)
        populated = _make_flow(db, tenant_a, popup, slug="flow-populated")
        empty = _make_flow(db, tenant_a, popup, slug="flow-empty")
        _make_strategy(
            db,
            tenant_a,
            popup,
            strategy_type=ApprovalStrategyType.AUTO_ACCEPT,
            sales_flow_id=populated.id,
        )

        assert approval_strategies_crud.get_by_flow(db, empty.id) is None

    def test_get_by_popup_reads_the_default_flows_strategy(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Naming a popup means its default flow, not a shared tier."""
        from app.api.sales_flow.crud import sales_flows_crud

        popup = _make_popup(db, tenant_a)
        default_flow = sales_flows_crud.get_default_flow(db, popup.id)
        _make_strategy(
            db,
            tenant_a,
            popup,
            strategy_type=ApprovalStrategyType.ANY_REVIEWER,
            sales_flow_id=default_flow.id,
        )

        resolved = approval_strategies_crud.get_by_popup(db, popup.id)

        assert resolved is not None
        assert resolved.strategy_type == ApprovalStrategyType.ANY_REVIEWER

    def test_two_flows_review_independently(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow_a = _make_flow(db, tenant_a, popup, slug="flow-a")
        flow_b = _make_flow(db, tenant_a, popup, slug="flow-b")
        _make_strategy(
            db,
            tenant_a,
            popup,
            strategy_type=ApprovalStrategyType.AUTO_ACCEPT,
            sales_flow_id=flow_b.id,
        )
        _make_strategy(
            db,
            tenant_a,
            popup,
            strategy_type=ApprovalStrategyType.ALL_REVIEWERS,
            sales_flow_id=flow_a.id,
        )

        resolved = approval_strategies_crud.get_by_flow(db, flow_a.id)

        assert resolved is not None
        assert resolved.strategy_type == ApprovalStrategyType.ALL_REVIEWERS
        assert resolved.sales_flow_id == flow_a.id

    def test_editing_flow_a_strategy_does_not_affect_flow_b(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow_a = _make_flow(db, tenant_a, popup, slug="flow-a")
        flow_b = _make_flow(db, tenant_a, popup, slug="flow-b")
        _make_strategy(
            db,
            tenant_a,
            popup,
            strategy_type=ApprovalStrategyType.AUTO_ACCEPT,
            sales_flow_id=flow_b.id,
        )
        _make_strategy(
            db,
            tenant_a,
            popup,
            strategy_type=ApprovalStrategyType.THRESHOLD,
            sales_flow_id=flow_a.id,
        )

        resolved_a = approval_strategies_crud.get_by_flow(db, flow_a.id)
        resolved_b = approval_strategies_crud.get_by_flow(db, flow_b.id)

        assert resolved_a is not None
        assert resolved_a.strategy_type == ApprovalStrategyType.THRESHOLD
        assert resolved_b is not None
        assert resolved_b.strategy_type == ApprovalStrategyType.AUTO_ACCEPT, (
            "Each flow keeps its own strategy — editing one never reaches the other"
        )
