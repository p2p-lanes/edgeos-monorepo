"""Tests for gathering defaults and flow-specific approval overrides."""

import uuid

import pytest
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


def _make_flow(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    slug: str,
    flow_type: str = "application",
) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=tenant.id,
        popup_id=popup.id,
        type=flow_type,
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


class TestStrategyOwnership:
    def test_flow_without_an_override_inherits_the_gathering_strategy(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        empty = _make_flow(db, tenant_a, popup, slug="flow-empty")
        _make_strategy(
            db,
            tenant_a,
            popup,
            strategy_type=ApprovalStrategyType.AUTO_ACCEPT,
        )

        resolved = approval_strategies_crud.get_by_flow(db, empty.id)

        assert resolved is not None
        assert resolved.strategy_type == ApprovalStrategyType.AUTO_ACCEPT
        assert resolved.sales_flow_id is None

    def test_get_by_popup_reads_the_gathering_strategy(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_strategy(
            db,
            tenant_a,
            popup,
            strategy_type=ApprovalStrategyType.ANY_REVIEWER,
        )

        resolved = approval_strategies_crud.get_by_popup(db, popup.id)

        assert resolved is not None
        assert resolved.strategy_type == ApprovalStrategyType.ANY_REVIEWER
        assert resolved.sales_flow_id is None

    def test_missing_legacy_rows_safely_resolve_to_auto_accept(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="legacy-flow")

        resolved = approval_strategies_crud.get_by_flow(db, flow.id)

        assert resolved is not None
        assert resolved.strategy_type == ApprovalStrategyType.AUTO_ACCEPT
        assert resolved.sales_flow_id is None

    @pytest.mark.parametrize("flow_type", ["direct", "upsale"])
    def test_selling_flows_do_not_consume_the_gathering_strategy(
        self,
        db: Session,
        tenant_a: Tenants,
        flow_type: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(
            db,
            tenant_a,
            popup,
            slug=f"{flow_type}-flow",
            flow_type=flow_type,
        )
        _make_strategy(
            db,
            tenant_a,
            popup,
            strategy_type=ApprovalStrategyType.ANY_REVIEWER,
        )

        assert approval_strategies_crud.get_by_flow(db, flow.id) is None

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
            "A flow override must not alter the gathering default inherited by siblings"
        )
