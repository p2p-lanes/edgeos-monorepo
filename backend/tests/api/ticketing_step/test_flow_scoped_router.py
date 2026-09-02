"""HTTP-level tests for flow-aware ticketing-step endpoints
(sdd/sales-flows slice 8).
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps
from app.core.security import create_access_token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Ticketing Step Router Popup {uuid.uuid4().hex[:8]}",
        slug=f"ticketing-step-router-popup-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_flow(db: Session, tenant: Tenants, popup: Popups, *, slug: str) -> SalesFlows:
    flow = SalesFlows(tenant_id=tenant.id, popup_id=popup.id, slug=slug, name=slug)
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
) -> TicketingSteps:
    step = TicketingSteps(
        tenant_id=tenant.id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id,
        step_type=step_type,
        title=step_type,
        is_enabled=is_enabled,
    )
    db.add(step)
    db.commit()
    db.refresh(step)
    return step


class TestListTicketingStepsFlowAware:
    def test_without_sales_flow_id_resolves_the_default_flow(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """Omitting the flow means "the default one", never a shared tier."""
        popup = _make_popup(db, tenant_a)
        default_flow = sales_flows_crud.provision_default_flow(
            db, popup_id=popup.id, tenant_id=tenant_a.id, sale_type="application"
        )
        db.commit()
        other = _make_flow(db, tenant_a, popup, slug="router-flow-a")
        _make_step(
            db, tenant_a, popup, step_type="tickets", sales_flow_id=default_flow.id
        )
        _make_step(db, tenant_a, popup, step_type="buyer", sales_flow_id=other.id)

        resp = client.get(
            "/api/v1/ticketing-steps",
            headers=_headers(admin_token_tenant_a),
            params={"popup_id": str(popup.id)},
        )

        assert resp.status_code == 200, resp.text
        step_types = [s["step_type"] for s in resp.json()["results"]]
        assert step_types == ["tickets"]

    def test_with_sales_flow_id_resolves_flow_owned_steps(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        default_flow = sales_flows_crud.provision_default_flow(
            db, popup_id=popup.id, tenant_id=tenant_a.id, sale_type="application"
        )
        db.commit()
        flow = _make_flow(db, tenant_a, popup, slug="router-flow-b")
        _make_step(
            db, tenant_a, popup, step_type="tickets", sales_flow_id=default_flow.id
        )
        _make_step(db, tenant_a, popup, step_type="buyer", sales_flow_id=flow.id)

        resp = client.get(
            "/api/v1/ticketing-steps",
            headers=_headers(admin_token_tenant_a),
            params={"popup_id": str(popup.id), "sales_flow_id": str(flow.id)},
        )

        assert resp.status_code == 200, resp.text
        step_types = [s["step_type"] for s in resp.json()["results"]]
        assert step_types == ["buyer"]


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"ticketing-step-portal-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Test",
        last_name="Human",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


class TestListPortalTicketingStepsResolvesDefaultFlow:
    def test_portal_endpoint_resolves_default_flow_ownership(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        default_flow = sales_flows_crud.provision_default_flow(
            db, popup_id=popup.id, tenant_id=tenant_a.id, sale_type="application"
        )
        db.commit()
        other = _make_flow(db, tenant_a, popup, slug="router-flow-portal-other")
        _make_step(db, tenant_a, popup, step_type="tickets", sales_flow_id=other.id)
        _make_step(
            db, tenant_a, popup, step_type="buyer", sales_flow_id=default_flow.id
        )
        human = _make_human(db, tenant_a)
        human_token = create_access_token(subject=human.id, token_type="human")

        resp = client.get(
            "/api/v1/ticketing-steps/portal",
            headers=_headers(human_token),
            params={"popup_id": str(popup.id)},
        )

        assert resp.status_code == 200, resp.text
        step_types = [s["step_type"] for s in resp.json()["results"]]
        assert step_types == ["buyer"], (
            "The portal resolves the popup's default flow and returns exactly "
            "its steps — a sibling flow's list must never leak in"
        )


class TestCreateTicketingStepRejectsCrossPopupFlow:
    def test_sales_flow_id_from_another_popup_returns_404(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_a = _make_popup(db, tenant_a)
        popup_b = _make_popup(db, tenant_a)
        flow_b = _make_flow(db, tenant_a, popup_b, slug="router-flow-cross-popup")

        resp = client.post(
            "/api/v1/ticketing-steps",
            headers=_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup_a.id),
                "sales_flow_id": str(flow_b.id),
                "step_type": "tickets",
                "title": "Tickets",
                "is_enabled": True,
            },
        )

        assert resp.status_code == 404, resp.text
        persisted = db.exec(
            select(TicketingSteps).where(TicketingSteps.popup_id == popup_a.id)
        ).all()
        assert persisted == []


class TestCreateTicketingStepPatronGuardPerFlow:
    """One enabled patron step per FLOW — not per popup (slice 2)."""

    def _patron_body(self, popup_id, flow_id) -> dict:
        return {
            "popup_id": str(popup_id),
            "sales_flow_id": str(flow_id),
            "step_type": "patron",
            "title": "Patron",
            "template": "patron-preset",
            "is_enabled": True,
        }

    def test_each_flow_may_have_its_own_patron_step(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow_a = _make_flow(db, tenant_a, popup, slug="router-flow-patron-a")
        flow_b = _make_flow(db, tenant_a, popup, slug="router-flow-patron-b")

        first = client.post(
            "/api/v1/ticketing-steps",
            headers=_headers(admin_token_tenant_a),
            json=self._patron_body(popup.id, flow_a.id),
        )
        assert first.status_code == 201, first.text

        second = client.post(
            "/api/v1/ticketing-steps",
            headers=_headers(admin_token_tenant_a),
            json=self._patron_body(popup.id, flow_b.id),
        )
        assert second.status_code == 201, second.text

    def test_second_patron_step_in_the_same_flow_is_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="router-flow-patron-dup")

        first = client.post(
            "/api/v1/ticketing-steps",
            headers=_headers(admin_token_tenant_a),
            json=self._patron_body(popup.id, flow.id),
        )
        assert first.status_code == 201, first.text

        duplicate = client.post(
            "/api/v1/ticketing-steps",
            headers=_headers(admin_token_tenant_a),
            json=self._patron_body(popup.id, flow.id),
        )
        assert duplicate.status_code == 422, duplicate.text
