"""Taking a sales flow out of circulation without discarding what it did.

A flow somebody has already applied through cannot be deleted — that would
throw away their application — and until now there was nothing else to do with
it. It kept its place in the portal listing and kept taking new applicants.

`status` was reserved for this from the start: `resolve_flow` has always read
`flow.status or popup.status` and refused anything not active. What was missing
was a way to set it, and listings that agreed with it.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import SalesFlowType
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from tests._flow_helpers import provision_default_flow


def _popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Closing {uuid.uuid4().hex[:6]}",
        slug=f"closing-{uuid.uuid4().hex[:8]}",
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    provision_default_flow(db, popup, sale_type=SaleType.application.value)
    db.commit()
    return popup


def _flow(db: Session, popup: Popups, **over) -> SalesFlows:
    over.setdefault("type", SalesFlowType.application.value)
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=f"scholarship-{uuid.uuid4().hex[:8]}",
        name="Scholarship",
        **over,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _patch(client: TestClient, token: str, flow_id, body: dict):
    return client.patch(
        f"/api/v1/sales-flows/{flow_id}",
        headers={"Authorization": f"Bearer {token}"},
        json=body,
    )


class TestClosingAndReopening:
    def test_an_operator_can_close_one(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _popup(db, tenant_a)
        flow = _flow(db, popup)

        resp = _patch(client, admin_token_tenant_a, flow.id, {"status": "closed"})

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "closed"

    def test_null_reopens_it(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """NULL is not "unset", it is "follows the gathering" — which is what
        being open means."""
        popup = _popup(db, tenant_a)
        flow = _flow(db, popup, status="closed")

        resp = _patch(client, admin_token_tenant_a, flow.id, {"status": None})

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] is None

    def test_leaving_it_out_does_not_reopen_it(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """Every other save would otherwise quietly reopen a closed flow."""
        popup = _popup(db, tenant_a)
        flow = _flow(db, popup, status="closed")

        resp = _patch(client, admin_token_tenant_a, flow.id, {"name": "Renamed"})

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "closed"

    def test_a_flow_cannot_declare_itself_active(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """`resolve_flow` reads `flow.status or popup.status`, so a flow that
        named itself active would keep selling into an event that had ended."""
        popup = _popup(db, tenant_a)
        flow = _flow(db, popup)

        resp = _patch(client, admin_token_tenant_a, flow.id, {"status": "active"})

        assert resp.status_code == 422, resp.text


class TestAClosedFlowIsNotOffered:
    def test_it_leaves_the_portal_listing(self, db: Session, tenant_a: Tenants) -> None:
        """Listing it would show a buyer a way in, let them click it, and
        refuse them at the door."""
        popup = _popup(db, tenant_a)
        open_flow = _flow(db, popup)
        closed = _flow(db, popup, status="closed")

        listed = sales_flows_crud.find_portal_listed(db, popup.id)
        ids = {f.id for f in listed}

        assert open_flow.id in ids
        assert closed.id not in ids

    def test_a_closed_add_on_leaves_its_catalogue_too(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a)
        closed = _flow(db, popup, type=SalesFlowType.upsale.value, status="closed")

        listed = sales_flows_crud.find_portal_listed(
            db, popup.id, type=SalesFlowType.upsale
        )

        assert closed.id not in {f.id for f in listed}


class TestAClosedFlowTakesNothingNew:
    def test_it_refuses_a_new_application(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Dropping it from the listing is not enough: this endpoint takes the
        flow id from the client, and a kept link is enough to reach it."""
        from app.api.application.crud import applications_crud

        popup = _popup(db, tenant_a)
        closed = _flow(db, popup, status="closed")

        try:
            applications_crud.resolve_target_flow_id(db, popup.id, closed.id)
        except Exception as exc:  # noqa: BLE001
            assert getattr(exc, "status_code", None) == 403, exc
        else:
            raise AssertionError("a closed way in accepted a new application")

    def test_an_open_one_still_takes_them(self, db: Session, tenant_a: Tenants) -> None:
        from app.api.application.crud import applications_crud

        popup = _popup(db, tenant_a)
        flow = _flow(db, popup)

        assert (
            applications_crud.resolve_target_flow_id(db, popup.id, flow.id) == flow.id
        )


class TestTheDoorSaysWhichThingIsShut:
    def test_a_closed_flow_does_not_blame_the_gathering(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """It could only ever be the gathering while `flow.status` was always
        NULL. Saying "Popup is not active" about an active gathering sends
        somebody looking in the wrong place."""
        from fastapi import HTTPException

        from app.api.sales_flow.resolver import resolve_flow

        popup = _popup(db, tenant_a)
        closed = _flow(db, popup, status="closed")

        try:
            resolve_flow(db, popup, closed.slug)
        except HTTPException as exc:
            assert exc.status_code == 403
            assert exc.detail == "This way in is closed"
        else:
            raise AssertionError("a closed way in let somebody through")

    def test_an_ended_gathering_still_blames_itself(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        from fastapi import HTTPException

        from app.api.sales_flow.resolver import resolve_flow

        popup = _popup(db, tenant_a)
        flow = _flow(db, popup)
        popup.status = "ended"
        db.add(popup)
        db.commit()

        try:
            resolve_flow(db, popup, flow.slug)
        except HTTPException as exc:
            assert exc.detail == "Popup is not active"
        else:
            raise AssertionError("an ended gathering let somebody through")


class TestWhatItDidSurvives:
    def test_closing_keeps_the_applications(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """The whole reason this exists: the flow could not be deleted because
        somebody had applied, so closing must not do by the back door what
        deleting refuses to do."""
        from sqlmodel import func, select

        from app.api.application.models import Applications
        from app.api.human.models import Humans

        popup = _popup(db, tenant_a)
        flow = _flow(db, popup)
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

        assert (
            _patch(
                client, admin_token_tenant_a, flow.id, {"status": "closed"}
            ).status_code
            == 200
        )

        assert (
            db.exec(
                select(func.count()).where(Applications.sales_flow_id == flow.id)
            ).one()
            == 1
        )
