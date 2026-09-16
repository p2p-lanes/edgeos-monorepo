"""Deleting a sales flow, and what should stop it.

The check used to be "does anything at all point at this row", which in
practice meant the checkout steps the product seeded into the flow seconds
after creating it. A flow nobody had ever sold through could not be deleted,
and the reason given — "this sales flow has configuration attached" — named
our own doing as the obstacle.

What must stop a delete is a record of something somebody did.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, func, select

from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import SalesFlowType
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.api.ticketing_step.constants import seed_ticketing_steps_for_popup
from app.api.ticketing_step.models import TicketingSteps
from tests._flow_helpers import provision_default_flow


def _popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Deleting {uuid.uuid4().hex[:6]}",
        slug=f"deleting-{uuid.uuid4().hex[:8]}",
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    provision_default_flow(db, popup, sale_type=SaleType.application.value)
    db.commit()
    return popup


def _flow_with_steps(db: Session, popup: Popups, flow_type: str) -> SalesFlows:
    """A flow exactly as creation leaves it: with the steps we seeded."""
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=f"workshops-{uuid.uuid4().hex[:8]}",
        name="Workshops",
        type=flow_type,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    seed_ticketing_steps_for_popup(
        db,
        popup_id=popup.id,
        tenant_id=popup.tenant_id,
        sales_flow_id=flow.id,
        flow_type=flow_type,
    )
    db.commit()
    return flow


def _count(db: Session, model, flow_id: uuid.UUID) -> int:
    """A scalar count, so a row the API deleted in its own session is not
    answered from this one's identity map."""
    return db.exec(select(func.count()).where(model.sales_flow_id == flow_id)).one()


def _flow_exists(db: Session, flow_id: uuid.UUID) -> bool:
    return db.exec(select(func.count()).where(SalesFlows.id == flow_id)).one() > 0


def _delete(client: TestClient, token: str, flow: SalesFlows):
    return client.delete(
        f"/api/v1/sales-flows/{flow.id}",
        headers={"Authorization": f"Bearer {token}"},
    )


class TestOurOwnConfigurationDoesNotBlock:
    def test_a_flow_with_the_steps_we_seeded_can_be_deleted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """The reported bug. Every flow is created with steps, so this refused
        essentially every delete."""
        popup = _popup(db, tenant_a)
        flow = _flow_with_steps(db, popup, SalesFlowType.upsale.value)
        flow_id = flow.id
        assert _count(db, TicketingSteps, flow_id) > 0

        resp = _delete(client, admin_token_tenant_a, flow)

        assert resp.status_code == 204, resp.text
        assert not _flow_exists(db, flow_id)

    def test_its_steps_go_with_it(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """A step has nowhere to live once its flow is gone, so leaving the
        rows behind would trade a refusal for an orphan."""
        popup = _popup(db, tenant_a)
        flow = _flow_with_steps(db, popup, SalesFlowType.upsale.value)
        flow_id = flow.id

        assert _delete(client, admin_token_tenant_a, flow).status_code == 204

        assert _count(db, TicketingSteps, flow_id) == 0

    def test_another_flow_keeps_its_own_steps(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """The delete is scoped to the flow, not to the gathering."""
        popup = _popup(db, tenant_a)
        doomed = _flow_with_steps(db, popup, SalesFlowType.upsale.value)
        survivor = _flow_with_steps(db, popup, SaleType.direct.value)
        survivor_id = survivor.id

        assert _delete(client, admin_token_tenant_a, doomed).status_code == 204

        assert _count(db, TicketingSteps, survivor_id) > 0


class TestWhatPeopleDidDoesBlock:
    def test_a_flow_somebody_applied_through_is_refused(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        from app.api.application.models import Applications
        from app.api.human.models import Humans

        popup = _popup(db, tenant_a)
        flow = _flow_with_steps(db, popup, SaleType.application.value)
        human = Humans(
            id=uuid.uuid4(),
            tenant_id=tenant_a.id,
            email=f"applicant-{uuid.uuid4().hex[:8]}@test.com",
        )
        db.add(human)
        db.commit()
        db.add(
            Applications(
                id=uuid.uuid4(),
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                human_id=human.id,
                sales_flow_id=flow.id,
                status="in review",
            )
        )
        db.commit()

        resp = _delete(client, admin_token_tenant_a, flow)

        assert resp.status_code == 400, resp.text
        assert _flow_exists(db, flow.id)

    def test_it_says_what_is_in_the_way(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """ "Cannot be deleted" tells an operator nothing about what to do."""
        from app.api.application.models import Applications
        from app.api.human.models import Humans

        popup = _popup(db, tenant_a)
        flow = _flow_with_steps(db, popup, SaleType.application.value)
        human = Humans(
            id=uuid.uuid4(),
            tenant_id=tenant_a.id,
            email=f"applicant-{uuid.uuid4().hex[:8]}@test.com",
        )
        db.add(human)
        db.commit()
        db.add(
            Applications(
                id=uuid.uuid4(),
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                human_id=human.id,
                sales_flow_id=flow.id,
                status="in review",
            )
        )
        db.commit()

        detail = _delete(client, admin_token_tenant_a, flow).json()["detail"]

        assert "1 application" in detail
        assert "configuration" not in detail


class TestDefaultFlowsFollowTheSameRules:
    def test_an_unused_default_and_its_configuration_can_be_deleted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        from app.api.sales_flow.crud import sales_flows_crud

        popup = _popup(db, tenant_a)
        default = sales_flows_crud.get_default_flow(db, popup.id)
        assert default is not None
        seed_ticketing_steps_for_popup(
            db,
            popup_id=popup.id,
            tenant_id=popup.tenant_id,
            sales_flow_id=default.id,
            flow_type=default.type,
        )
        db.commit()
        default_id = default.id
        assert _count(db, TicketingSteps, default_id) > 0

        resp = _delete(client, admin_token_tenant_a, default)

        assert resp.status_code == 204, resp.text
        assert not _flow_exists(db, default_id)
        assert _count(db, TicketingSteps, default_id) == 0

    def test_a_used_default_is_blocked_by_its_history(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        from app.api.application.models import Applications
        from app.api.human.models import Humans
        from app.api.sales_flow.crud import sales_flows_crud

        popup = _popup(db, tenant_a)
        default = sales_flows_crud.get_default_flow(db, popup.id)
        assert default is not None
        human = Humans(
            id=uuid.uuid4(),
            tenant_id=tenant_a.id,
            email=f"default-applicant-{uuid.uuid4().hex[:8]}@test.com",
        )
        db.add(human)
        db.commit()
        db.add(
            Applications(
                id=uuid.uuid4(),
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                human_id=human.id,
                sales_flow_id=default.id,
                status="in review",
            )
        )
        db.commit()

        resp = _delete(client, admin_token_tenant_a, default)

        assert resp.status_code == 400, resp.text
        assert resp.json()["detail"] == (
            "This sales flow cannot be deleted because people have used it: "
            "1 application."
        )
        assert _flow_exists(db, default.id)
