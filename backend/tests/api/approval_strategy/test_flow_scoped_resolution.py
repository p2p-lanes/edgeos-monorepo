"""Tests for flow-scoped approval strategy resolution (sdd/sales-flows slice 7).

Design: orchestrator's binding extension of D4 — the one-per-popup
`approval_strategies` constraint re-keys to the flow dimension with popup
fallback, mirroring the reviewer tri-state's own two-tier pattern.
`get_for_flow(session, popup_id, sales_flow_id)` returns the flow-owned strategy
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


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Strategy Flow Popup {uuid.uuid4().hex[:8]}",
        slug=f"strategy-flow-popup-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
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
    sales_flow_id: uuid.UUID | None = None,
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


class TestGetForFlowFallback:
    def test_flow_with_no_own_strategy_falls_back_to_popup_shared(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="flow-a")
        _make_strategy(
            db, tenant_a, popup, strategy_type=ApprovalStrategyType.AUTO_ACCEPT
        )

        resolved = approval_strategies_crud.get_for_flow(db, popup.id, flow.id)

        assert resolved is not None
        assert resolved.strategy_type == ApprovalStrategyType.AUTO_ACCEPT
        assert resolved.sales_flow_id is None

    def test_none_flow_id_returns_popup_shared_strategy(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_strategy(
            db, tenant_a, popup, strategy_type=ApprovalStrategyType.ANY_REVIEWER
        )

        resolved = approval_strategies_crud.get_for_flow(db, popup.id, None)

        assert resolved is not None
        assert resolved.strategy_type == ApprovalStrategyType.ANY_REVIEWER


class TestGetForFlowOwnership:
    def test_flow_owned_strategy_used_instead_of_popup_shared(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow_a = _make_flow(db, tenant_a, popup, slug="flow-a")
        _make_strategy(
            db, tenant_a, popup, strategy_type=ApprovalStrategyType.AUTO_ACCEPT
        )
        _make_strategy(
            db,
            tenant_a,
            popup,
            strategy_type=ApprovalStrategyType.ALL_REVIEWERS,
            sales_flow_id=flow_a.id,
        )

        resolved = approval_strategies_crud.get_for_flow(db, popup.id, flow_a.id)

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
            db, tenant_a, popup, strategy_type=ApprovalStrategyType.AUTO_ACCEPT
        )
        _make_strategy(
            db,
            tenant_a,
            popup,
            strategy_type=ApprovalStrategyType.THRESHOLD,
            sales_flow_id=flow_a.id,
        )

        resolved_a = approval_strategies_crud.get_for_flow(db, popup.id, flow_a.id)
        resolved_b = approval_strategies_crud.get_for_flow(db, popup.id, flow_b.id)

        assert resolved_a is not None
        assert resolved_a.strategy_type == ApprovalStrategyType.THRESHOLD
        assert resolved_b is not None
        assert resolved_b.strategy_type == ApprovalStrategyType.AUTO_ACCEPT, (
            "Flow B has no strategy of its own — must fall back to the "
            "popup-shared tier, not leak flow A's strategy"
        )
