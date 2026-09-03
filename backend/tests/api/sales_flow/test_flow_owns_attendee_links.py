"""Each door decides whether the people who came through it may share it.

Design: sdd/sales-flows-rediseno, `docs/sales-flows-que-mover.md` slice 5.

This was blocked until dev's `a3f8c1d94e27` landed. A referral used to be its
own table with no flow, so `referrals_enabled` had nothing to hang on. Now a
referral IS an invite, told apart by `is_portal_created`, and an invite has
named its flow since the re-key.

The ceiling travels with the switch: a door that shares differently shares at
its own rate.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import provision_default_flow


def _popup(db: Session, tenant: Tenants, **flags) -> Popups:
    popup = Popups(
        name=f"Links {uuid.uuid4().hex[:6]}",
        slug=f"links-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        sale_type=SaleType.application,
        status="active",
        **flags,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    provision_default_flow(db, popup, sale_type=SaleType.application.value)
    db.commit()
    return popup


def _default_flow(db: Session, popup: Popups) -> SalesFlows:
    flow = sales_flows_crud.get_default_flow(db, popup.id)
    assert flow is not None
    return flow


def _set(db: Session, flow: SalesFlows, **values) -> SalesFlows:
    for name, value in values.items():
        setattr(flow, name, value)
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _ticket_holder(db: Session, popup: Popups, flow: SalesFlows) -> str:
    """Someone accepted through `flow` who actually holds a ticket — the only
    people allowed to create a link of their own."""
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        email=f"sharer-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Ana",
    )
    db.add(human)
    db.commit()
    db.refresh(human)

    application = Applications(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        sales_flow_id=flow.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.commit()

    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name="Ticket",
        slug=f"ticket-{uuid.uuid4().hex[:8]}",
        price=100,
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.commit()
    attendee = Attendees(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        application_id=application.id,
        human_id=human.id,
        name="Ana",
        email=human.email,
        category="main",
    )
    db.add(attendee)
    db.commit()
    db.add(
        AttendeeProducts(
            tenant_id=popup.tenant_id,
            attendee_id=attendee.id,
            product_id=product.id,
            check_in_code=uuid.uuid4().hex[:10].upper(),
        )
    )
    db.commit()
    return create_access_token(subject=human.id, token_type="human")


def _share(client: TestClient, token: str, popup: Popups, **body):
    return client.post(
        "/api/v1/portal/invites",
        json={"popup_id": str(popup.id), **body},
        headers={"Authorization": f"Bearer {token}"},
    )


class TestSharingGate:
    def test_the_flow_lets_them_share_when_the_event_does_not(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, referrals_enabled=False)
        flow = _set(db, _default_flow(db, popup), referrals_enabled=True)
        token = _ticket_holder(db, popup, flow)

        resp = _share(client, token, popup)

        assert resp.status_code in (200, 201), resp.text

    def test_the_flow_refuses_when_the_event_allows(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, referrals_enabled=True)
        flow = _set(db, _default_flow(db, popup), referrals_enabled=False)
        token = _ticket_holder(db, popup, flow)

        resp = _share(client, token, popup)

        assert resp.status_code == 403, resp.text

    def test_two_doors_of_one_gathering_answer_differently(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, referrals_enabled=False)
        open_door = _set(db, _default_flow(db, popup), referrals_enabled=True)
        quiet_door = SalesFlows(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            slug=f"quiet-{uuid.uuid4().hex[:8]}",
            name="Quiet",
            type=SaleType.application.value,
            referrals_enabled=False,
        )
        db.add(quiet_door)
        db.commit()
        db.refresh(quiet_door)

        sharer = _ticket_holder(db, popup, open_door)
        hushed = _ticket_holder(db, popup, quiet_door)

        assert _share(client, sharer, popup).status_code in (200, 201)
        assert _share(client, hushed, popup).status_code == 403


class TestSharingCeiling:
    def test_the_ceiling_comes_from_the_flow_not_the_event(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, referrals_enabled=True)
        popup.max_referrals_per_attendee = 50
        db.add(popup)
        db.commit()
        flow = _set(
            db,
            _default_flow(db, popup),
            referrals_enabled=True,
            max_referrals_per_attendee=3,
        )
        token = _ticket_holder(db, popup, flow)

        resp = _share(client, token, popup, max_uses=100)

        assert resp.status_code in (200, 201), resp.text
        assert resp.json()["max_uses"] == 3
