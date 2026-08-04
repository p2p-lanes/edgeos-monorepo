"""Task 9.8 — GET /ticketing-steps/portal accepts an explicit flow.

Closes the same slice-8 asymmetry documented for form_field/router.py: the
portal endpoint always resolved the popup's default flow. It now accepts an
optional `sales_flow_id` query param (must belong to the popup), matching
the BO `GET /ticketing-steps` endpoint's existing contract.

TDD: RED -> GREEN.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    slug = f"portal-step-flow-{uuid.uuid4().hex[:8]}"
    popup = Popups(tenant_id=tenant.id, name=f"Popup {slug}", slug=slug)
    db.add(popup)
    db.flush()
    sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant.id, sale_type="application"
    )
    db.flush()
    return popup


def _make_flow(db: Session, popup: Popups, *, slug: str) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id, popup_id=popup.id, slug=slug, name=f"Flow {slug}"
    )
    db.add(flow)
    db.flush()
    return flow


def _make_step(db: Session, popup: Popups, *, title: str, sales_flow_id=None):
    step = TicketingSteps(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id,
        step_type="tickets",
        title=title,
        is_enabled=True,
    )
    db.add(step)
    db.flush()
    return step


def _human_token(db: Session, tenant: Tenants) -> str:
    from app.api.human.models import Humans
    from app.core.security import create_access_token

    human = Humans(
        tenant_id=tenant.id,
        email=f"portal-step-flow-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Pat",
        last_name="Doe",
    )
    db.add(human)
    db.commit()
    return create_access_token(subject=human.id, token_type="human")


class TestPortalTicketingStepsAcceptsExplicitFlow:
    def test_explicit_sales_flow_id_resolves_that_flows_steps(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug="vip")
        _make_step(db, popup, title="Shared Step")
        _make_step(db, popup, title="VIP Step", sales_flow_id=flow.id)
        db.commit()
        token = _human_token(db, tenant_a)

        response = client.get(
            "/api/v1/ticketing-steps/portal",
            params={"popup_id": str(popup.id), "sales_flow_id": str(flow.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200, response.text
        titles = [s["title"] for s in response.json()["results"]]
        assert titles == ["VIP Step"]

    def test_flow_from_another_popup_returns_404(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup_a = _make_popup(db, tenant_a)
        popup_b = _make_popup(db, tenant_a)
        other_flow = _make_flow(db, popup_b, slug="only-on-b")
        db.commit()
        token = _human_token(db, tenant_a)

        response = client.get(
            "/api/v1/ticketing-steps/portal",
            params={"popup_id": str(popup_a.id), "sales_flow_id": str(other_flow.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 404, response.text
