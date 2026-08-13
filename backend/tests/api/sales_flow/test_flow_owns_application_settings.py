"""Each way in decides its own application settings.

Design: sdd/sales-flows-rediseno. `allows_scholarship`, `allows_incentive`,
`requires_application_fee` and `application_fee_amount` have been flow columns
since slice 7, and `d4f1a72e9c85` gave every flow a copy of what its popup
had. The readers kept asking the popup, so the columns were written and never
consulted — and the existing suite could not see it, because a test popup is
built before its default flow, which then copies the popup's value. Both
answers agreed, so both looked right.

These cases make them disagree. Every one of them fails if a reader goes back
to the popup.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.approval_strategy.models import ApprovalStrategies
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import provision_default_flow


def _popup(db: Session, tenant: Tenants, **flags) -> Popups:
    popup = Popups(
        name=f"Flow Settings {uuid.uuid4().hex[:6]}",
        slug=f"flow-settings-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
        **flags,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    provision_default_flow(db, popup, sale_type=SaleType.application.value)
    db.commit()
    # An auto-accept strategy would resolve the application before the gates
    # under test get to speak.
    strategy = db.exec(
        select(ApprovalStrategies).where(ApprovalStrategies.popup_id == popup.id)
    ).first()
    if strategy:
        db.delete(strategy)
        db.commit()
    return popup


def _default_flow(db: Session, popup: Popups) -> SalesFlows:
    from app.api.sales_flow.crud import sales_flows_crud

    flow = sales_flows_crud.get_default_flow(db, popup.id)
    assert flow is not None
    return flow


def _second_flow(db: Session, popup: Popups, **config) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=f"second-{uuid.uuid4().hex[:8]}",
        name="Second Door",
        type=SaleType.application.value,
        **config,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _human_token(db: Session, tenant: Tenants) -> str:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"flow-settings-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Ana",
        last_name="Diaz",
    )
    db.add(human)
    db.commit()
    return create_access_token(subject=human.id, token_type="human")


def _apply(
    client: TestClient,
    token: str,
    popup: Popups,
    flow: SalesFlows,
    **body,
):
    return client.post(
        "/api/v1/applications/my",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "popup_id": str(popup.id),
            "sales_flow_id": str(flow.id),
            "first_name": "Ana",
            "last_name": "Diaz",
            "status": "in review",
            **body,
        },
    )


class TestScholarship:
    def test_the_flow_grants_what_the_event_refuses(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, allows_scholarship=False)
        flow = _default_flow(db, popup)
        flow.allows_scholarship = True
        db.add(flow)
        db.commit()

        resp = _apply(
            client,
            _human_token(db, tenant_a),
            popup,
            flow,
            scholarship_request=True,
            scholarship_details="I need support",
        )

        assert resp.status_code == 201, resp.text

    def test_the_flow_refuses_what_the_event_grants(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, allows_scholarship=True)
        flow = _default_flow(db, popup)
        flow.allows_scholarship = False
        db.add(flow)
        db.commit()

        resp = _apply(
            client,
            _human_token(db, tenant_a),
            popup,
            flow,
            scholarship_request=True,
            scholarship_details="I need support",
        )

        assert resp.status_code == 422, resp.text

    def test_two_doors_answer_differently(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """The point of the whole thing: general entry can offer scholarships
        while a partner's door does not, at the same gathering."""
        popup = _popup(db, tenant_a, allows_scholarship=True)
        open_door = _default_flow(db, popup)
        open_door.allows_scholarship = True
        db.add(open_door)
        partner = _second_flow(db, popup, allows_scholarship=False)
        db.commit()

        allowed = _apply(
            client,
            _human_token(db, tenant_a),
            popup,
            open_door,
            scholarship_request=True,
            scholarship_details="I need support",
        )
        refused = _apply(
            client,
            _human_token(db, tenant_a),
            popup,
            partner,
            scholarship_request=True,
            scholarship_details="I need support",
        )

        assert allowed.status_code == 201, allowed.text
        assert refused.status_code == 422, refused.text


class TestApplicationFee:
    def test_the_flow_charges_a_fee_the_event_does_not(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A flow that charges holds the application at PENDING_FEE, whatever
        the event says."""
        popup = _popup(db, tenant_a, requires_application_fee=False)
        flow = _default_flow(db, popup)
        flow.requires_application_fee = True
        flow.application_fee_amount = 25
        db.add(flow)
        db.commit()

        resp = _apply(client, _human_token(db, tenant_a), popup, flow)

        assert resp.status_code == 201, resp.text
        application = db.get(Applications, uuid.UUID(resp.json()["id"]))
        assert application is not None
        assert application.status == ApplicationStatus.PENDING_FEE.value

    def test_the_flow_waives_a_fee_the_event_requires(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(
            db, tenant_a, requires_application_fee=True, application_fee_amount=25
        )
        flow = _default_flow(db, popup)
        flow.requires_application_fee = False
        flow.application_fee_amount = None
        db.add(flow)
        db.commit()

        resp = _apply(client, _human_token(db, tenant_a), popup, flow)

        assert resp.status_code == 201, resp.text
        application = db.get(Applications, uuid.UUID(resp.json()["id"]))
        assert application is not None
        assert application.status != ApplicationStatus.PENDING_FEE.value
