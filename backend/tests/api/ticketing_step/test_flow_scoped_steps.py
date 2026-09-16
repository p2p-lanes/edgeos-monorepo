"""Ticketing steps belong to exactly one sales flow.

Design: sdd/sales-flows-rediseno slice 2 — the popup-shared tier and the
read-time fallback are gone. A flow's step list is what that flow owns:
never another flow's, never a popup-level default. An empty list means
"this flow has no steps", which is a fact about the flow, not a cue to go
looking somewhere else.

These tests exist to keep the deleted fallback deleted. Every one of them
would have passed before slice 2 only by accident.
"""

import uuid

import pytest
from fastapi import HTTPException
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
    sales_flow_id: uuid.UUID,
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


class TestFlowOwnsItsSteps:
    def test_flow_reads_only_its_own_steps(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow_a = _make_flow(db, tenant_a, popup, slug=f"own-a-{uuid.uuid4().hex[:6]}")
        flow_b = _make_flow(db, tenant_a, popup, slug=f"own-b-{uuid.uuid4().hex[:6]}")
        _make_step(db, tenant_a, popup, step_type="tickets", sales_flow_id=flow_a.id)
        _make_step(db, tenant_a, popup, step_type="buyer", sales_flow_id=flow_b.id)

        steps, total = ticketing_steps_crud.find_by_flow(db, flow_a.id)

        assert total == 1
        assert [s.step_type for s in steps] == ["tickets"]

    def test_flow_without_steps_gets_nothing(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The deleted fallback: a sibling flow's list must not leak in."""
        popup = _make_popup(db, tenant_a)
        populated = _make_flow(
            db, tenant_a, popup, slug=f"populated-{uuid.uuid4().hex[:6]}"
        )
        empty = _make_flow(db, tenant_a, popup, slug=f"empty-{uuid.uuid4().hex[:6]}")
        _make_step(db, tenant_a, popup, step_type="tickets", sales_flow_id=populated.id)

        steps, total = ticketing_steps_crud.find_by_flow(db, empty.id)

        assert total == 0
        assert steps == []

    def test_editing_one_flow_does_not_touch_another(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The F2 guarantee, at the data layer."""
        popup = _make_popup(db, tenant_a)
        flow_a = _make_flow(db, tenant_a, popup, slug=f"edit-a-{uuid.uuid4().hex[:6]}")
        flow_b = _make_flow(db, tenant_a, popup, slug=f"edit-b-{uuid.uuid4().hex[:6]}")
        step_a = _make_step(
            db, tenant_a, popup, step_type="tickets", sales_flow_id=flow_a.id
        )
        step_b = _make_step(
            db, tenant_a, popup, step_type="tickets", sales_flow_id=flow_b.id
        )

        step_a.title = "Renamed in flow A"
        db.add(step_a)
        db.commit()
        db.refresh(step_b)

        assert step_b.title == "tickets"


class TestPortalReadPath:
    def test_portal_returns_only_enabled_steps_of_the_flow(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug=f"portal-{uuid.uuid4().hex[:6]}")
        _make_step(db, tenant_a, popup, step_type="tickets", sales_flow_id=flow.id)
        _make_step(
            db,
            tenant_a,
            popup,
            step_type="housing",
            sales_flow_id=flow.id,
            is_enabled=False,
        )

        steps = ticketing_steps_crud.find_portal_by_flow(db, flow.id)

        assert [s.step_type for s in steps] == ["tickets"]

    def test_all_steps_disabled_yields_empty_not_a_fallback(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        other = _make_flow(db, tenant_a, popup, slug=f"other-{uuid.uuid4().hex[:6]}")
        flow = _make_flow(db, tenant_a, popup, slug=f"dark-{uuid.uuid4().hex[:6]}")
        _make_step(db, tenant_a, popup, step_type="tickets", sales_flow_id=other.id)
        _make_step(
            db,
            tenant_a,
            popup,
            step_type="tickets",
            sales_flow_id=flow.id,
            is_enabled=False,
        )

        assert ticketing_steps_crud.find_portal_by_flow(db, flow.id) == []


class TestPatronGuardIsPerFlow:
    def test_second_patron_step_in_the_same_flow_is_rejected(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug=f"patron-{uuid.uuid4().hex[:6]}")
        _make_step(
            db,
            tenant_a,
            popup,
            step_type="patron",
            sales_flow_id=flow.id,
            template="patron-preset",
        )

        with pytest.raises(HTTPException) as exc:
            ticketing_steps_crud._assert_no_active_patron_preset(db, flow.id)

        assert exc.value.status_code == 422

    def test_another_flow_may_have_its_own_patron_step(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow_a = _make_flow(db, tenant_a, popup, slug=f"pat-a-{uuid.uuid4().hex[:6]}")
        flow_b = _make_flow(db, tenant_a, popup, slug=f"pat-b-{uuid.uuid4().hex[:6]}")
        _make_step(
            db,
            tenant_a,
            popup,
            step_type="patron",
            sales_flow_id=flow_a.id,
            template="patron-preset",
        )

        # Must not raise: the invariant is one patron step per FLOW.
        ticketing_steps_crud._assert_no_active_patron_preset(db, flow_b.id)
