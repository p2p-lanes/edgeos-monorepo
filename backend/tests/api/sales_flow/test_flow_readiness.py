"""What a flow is missing before it can sell.

Design: sdd/sales-flows-rediseno slice 8. The flow list showed
configuration, which cannot tell an operator that a flow is broken. These
scenarios pin the states an operator has to be able to see at a glance.

Scenarios:
- A flow with no enabled steps is blocked: its checkout renders nothing.
- Disabling the last step blocks the flow, the same way the buyer sees it.
- Steps that name no active product are blocked, not merely empty.
- An application flow with no form fields is blocked.
- A complete direct flow reports nothing at all.
- Unlisted visibility and a missing approval strategy are warnings, not
  blockers: both flows still sell.
- The endpoint reports every flow of the popup, and rejects a viewer,
  the same gate the flow list uses.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.readiness import (
    ACCEPTS_EVERYONE,
    NO_FORM,
    NO_STEPS,
    SELLS_NOTHING,
    UNLISTED,
    flow_readiness,
)
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps
from tests._flow_helpers import provision_default_flow


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Readiness Popup {uuid.uuid4().hex[:6]}",
        slug=f"readiness-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.direct.value,
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_flow(
    db: Session,
    popup: Popups,
    *,
    flow_type: str = "direct",
    visibility: str = "portal_listed",
) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        type=flow_type,
        visibility=visibility,
        slug=f"flow-{uuid.uuid4().hex[:8]}",
        name="Readiness Flow",
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _make_product(db: Session, popup: Popups, *, category: str = "ticket") -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"Product {uuid.uuid4().hex[:6]}",
        slug=f"prod-{uuid.uuid4().hex[:8]}",
        price=10,
        category=category,
        is_active=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_step(
    db: Session,
    popup: Popups,
    flow: SalesFlows,
    *,
    category: str | None = "ticket",
    enabled: bool = True,
) -> TicketingSteps:
    step = TicketingSteps(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        step_type="tickets",
        product_category=category,
        title="Tickets",
        order=0,
        is_enabled=enabled,
    )
    db.add(step)
    db.commit()
    db.refresh(step)
    return step


class TestBlockers:
    def test_a_flow_with_no_steps_cannot_sell(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup)

        readiness = flow_readiness(db, flow)

        assert NO_STEPS in readiness.blockers
        assert readiness.enabled_step_count == 0

    def test_disabling_the_last_step_blocks_the_flow(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """A disabled step is invisible to the buyer, so it must not count
        as a configured checkout here either."""
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup)
        _make_product(db, popup)
        step = _make_step(db, popup, flow)

        assert flow_readiness(db, flow).blockers == []

        step.is_enabled = False
        db.add(step)
        db.commit()

        assert NO_STEPS in flow_readiness(db, flow).blockers

    def test_a_step_naming_no_active_product_sells_nothing(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The state behind the empty checkout that opened this redesign:
        the step exists, so the flow looks configured, but its category
        matches no active product."""
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup)
        _make_product(db, popup, category="ticket")
        _make_step(db, popup, flow, category="meal_plan")

        readiness = flow_readiness(db, flow)

        assert SELLS_NOTHING in readiness.blockers
        assert NO_STEPS not in readiness.blockers
        assert readiness.offered_product_count == 0

    def test_an_application_flow_without_a_form_is_blocked(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, flow_type="application")
        _make_product(db, popup)
        _make_step(db, popup, flow)

        assert NO_FORM in flow_readiness(db, flow).blockers

    def test_a_direct_flow_never_needs_a_form(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup)
        _make_product(db, popup)
        _make_step(db, popup, flow)

        readiness = flow_readiness(db, flow)

        assert readiness.blockers == []
        assert readiness.warnings == []
        assert readiness.offered_product_count == 1


class TestWarnings:
    def test_unlisted_visibility_warns_but_does_not_block(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, visibility="direct_url_only")
        _make_product(db, popup)
        _make_step(db, popup, flow)

        readiness = flow_readiness(db, flow)

        assert readiness.blockers == []
        assert UNLISTED in readiness.warnings

    def test_an_application_flow_without_a_strategy_accepts_everyone(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        """No strategy means auto-accept, which sells fine and is rarely
        what an application flow is for."""
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, flow_type="application")

        readiness = flow_readiness(db, flow)

        assert ACCEPTS_EVERYONE in readiness.warnings
        assert readiness.has_approval_strategy is False


class TestReadinessEndpoint:
    def test_it_reports_every_flow_of_the_popup(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        popup = _make_popup(db, tenant_a)
        provision_default_flow(db, popup, sale_type="direct")
        broken = _make_flow(db, popup)

        resp = client.get(
            "/api/v1/sales-flows/readiness",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            params={"popup_id": str(popup.id)},
        )

        assert resp.status_code == 200, resp.text
        by_id = {row["flow_id"]: row for row in resp.json()}
        default_flow = sales_flows_crud.get_default_flow(db, popup.id)
        assert default_flow is not None
        assert str(default_flow.id) in by_id
        assert NO_STEPS in by_id[str(broken.id)]["blockers"]

    def test_readiness_is_not_read_as_a_flow_id(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        """`/readiness` is declared before `/{flow_id}`. Declared the other
        way round FastAPI would try to parse it as a UUID and answer 422."""
        popup = _make_popup(db, tenant_a)

        resp = client.get(
            "/api/v1/sales-flows/readiness",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            params={"popup_id": str(popup.id)},
        )

        assert resp.status_code == 200, resp.text

    def test_a_viewer_is_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants, viewer_token_tenant_a
    ) -> None:
        """Same gate as the flow list this sits on: operator or above."""
        popup = _make_popup(db, tenant_a)

        resp = client.get(
            "/api/v1/sales-flows/readiness",
            headers={"Authorization": f"Bearer {viewer_token_tenant_a}"},
            params={"popup_id": str(popup.id)},
        )

        assert resp.status_code == 403, resp.text
