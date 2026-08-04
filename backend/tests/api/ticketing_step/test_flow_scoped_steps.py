"""Tests for flow-scoped ticketing-step resolution (sdd/sales-flows slice 8).

Design (task 8 binding): a flow that owns ANY step row uses ONLY its own
list — the popup tier never leaks in, even for a fully-disabled flow-owned
list. A flow with zero rows of its own falls back to the popup-shared tier
(`sales_flow_id IS NULL`, the exact step list every popup had before this
slice). Mirrors slice 6's `find_for_flow` (forms) pattern exactly.
"""

import uuid

from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import (
    SalesFlowIdentityMode,
    SalesFlowReviewersMode,
    SalesFlowVisibility,
)
from app.api.tenant.models import Tenants
from app.api.ticketing_step.crud import ticketing_steps_crud
from app.api.ticketing_step.models import TicketingSteps


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Ticketing Step Flow Popup {uuid.uuid4().hex[:8]}",
        slug=f"ticketing-step-flow-popup-{uuid.uuid4().hex[:8]}",
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


def _make_step(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    step_type: str,
    sales_flow_id: uuid.UUID | None = None,
    is_enabled: bool = True,
    template: str | None = None,
) -> TicketingSteps:
    step = TicketingSteps(
        tenant_id=tenant.id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id,
        step_type=step_type,
        title=step_type,
        is_enabled=is_enabled,
        template=template,
    )
    db.add(step)
    db.commit()
    db.refresh(step)
    return step


class TestFindForFlowFallback:
    def test_none_flow_id_returns_popup_shared_steps(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_step(db, tenant_a, popup, step_type="tickets")

        steps, total = ticketing_steps_crud.find_for_flow(db, popup.id, None)

        assert total == 1
        assert [s.step_type for s in steps] == ["tickets"]

    def test_flow_with_no_own_steps_falls_back_to_popup_shared(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="flow-a")
        _make_step(db, tenant_a, popup, step_type="tickets")

        steps, total = ticketing_steps_crud.find_for_flow(db, popup.id, flow.id)

        assert total == 1
        assert [s.step_type for s in steps] == ["tickets"]


class TestFindForFlowOwnership:
    def test_flow_owned_steps_exclude_popup_shared(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="flow-owner")
        _make_step(db, tenant_a, popup, step_type="tickets")
        _make_step(db, tenant_a, popup, step_type="buyer", sales_flow_id=flow.id)

        steps, total = ticketing_steps_crud.find_for_flow(db, popup.id, flow.id)

        assert total == 1
        assert [s.step_type for s in steps] == ["buyer"], (
            "A flow that owns any step must use ONLY its own list"
        )

    def test_flow_owned_all_disabled_never_falls_back(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="flow-all-disabled")
        _make_step(db, tenant_a, popup, step_type="tickets")
        _make_step(
            db,
            tenant_a,
            popup,
            step_type="buyer",
            sales_flow_id=flow.id,
            is_enabled=False,
        )

        steps, total = ticketing_steps_crud.find_for_flow(db, popup.id, flow.id)

        assert total == 1
        assert steps[0].step_type == "buyer", (
            "Ownership is ANY row regardless of is_enabled — a fully-disabled "
            "flow-owned list still owns it, it never falls through"
        )

    def test_editing_flow_a_steps_does_not_affect_flow_b(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow_a = _make_flow(db, tenant_a, popup, slug="flow-a")
        flow_b = _make_flow(db, tenant_a, popup, slug="flow-b")
        _make_step(db, tenant_a, popup, step_type="tickets")
        _make_step(db, tenant_a, popup, step_type="buyer", sales_flow_id=flow_a.id)

        steps_a, _ = ticketing_steps_crud.find_for_flow(db, popup.id, flow_a.id)
        steps_b, _ = ticketing_steps_crud.find_for_flow(db, popup.id, flow_b.id)

        assert [s.step_type for s in steps_a] == ["buyer"]
        assert [s.step_type for s in steps_b] == ["tickets"], (
            "Flow B owns no steps of its own — must fall back to the "
            "popup-shared tier, not leak flow A's steps"
        )


class TestFindPortalForFlow:
    def test_portal_resolution_filters_enabled_within_owned_tier(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="flow-portal")
        _make_step(db, tenant_a, popup, step_type="buyer", sales_flow_id=flow.id)
        _make_step(
            db,
            tenant_a,
            popup,
            step_type="hidden",
            sales_flow_id=flow.id,
            is_enabled=False,
        )

        steps = ticketing_steps_crud.find_portal_for_flow(db, popup.id, flow.id)

        assert [s.step_type for s in steps] == ["buyer"]

    def test_portal_resolution_falls_back_when_flow_owns_nothing(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="flow-empty")
        _make_step(db, tenant_a, popup, step_type="tickets")

        steps = ticketing_steps_crud.find_portal_for_flow(db, popup.id, flow.id)

        assert [s.step_type for s in steps] == ["tickets"]


class TestPatronPresetGuardPerTier:
    def test_flow_tier_guard_ignores_popup_shared_patron_step(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="flow-patron")
        _make_step(db, tenant_a, popup, step_type="patron", template="patron-preset")

        # Must not raise — flow tier has no patron-preset row of its own yet.
        ticketing_steps_crud._assert_no_active_patron_preset(
            db, popup.id, flow_id=flow.id
        )

    def test_popup_shared_guard_ignores_flow_owned_patron_step(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="flow-patron-2")
        _make_step(
            db,
            tenant_a,
            popup,
            step_type="patron",
            sales_flow_id=flow.id,
            template="patron-preset",
        )

        # Must not raise — popup-shared tier has no patron-preset row.
        ticketing_steps_crud._assert_no_active_patron_preset(db, popup.id)
