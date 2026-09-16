"""Each door charges its own fees.

Design: sdd/sales-flows-rediseno, `docs/sales-flows-que-mover.md` slice 2.
Insurance and contribution are added at a checkout, and a checkout belongs to
a flow, so a door selling to volunteers should not add a contribution to their
order because the general one does. Both lived only on `popups`.

`f1c7a4b90d63` gave every flow a copy of what its popup charged, so nothing
moved for any buyer on the day it ran. These cases are what stops it moving
back: they set the popup one way and the flow the other, and assert the money
follows the flow. The suite could not tell the difference before — a test
popup is built with its fees, then its default flow copies them, so both
answers agreed.

Amounts, not flags: a fee that resolves from the wrong place is a wrong charge.
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import application_flow_id


def _popup(db: Session, tenant: Tenants, **fees) -> Popups:
    popup = Popups(
        name=f"Flow Fees {uuid.uuid4().hex[:8]}",
        slug=f"flow-fees-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        sale_type=SaleType.application,
        **fees,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _product(db: Session, tenant: Tenants, popup: Popups, *, price: str) -> Products:
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Product {uuid.uuid4().hex[:6]}",
        slug=f"product-{uuid.uuid4().hex[:8]}",
        price=Decimal(price),
        category="ticket",
        is_active=True,
        insurance_eligible=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"flow-fees-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Ana",
        last_name="Diaz",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    flow_id: uuid.UUID | None = None,
) -> Applications:
    application = Applications(
        sales_flow_id=flow_id or application_flow_id(db, popup.id),
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def _attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    application: Applications,
    human: Humans,
) -> Attendees:
    attendee = Attendees(
        tenant_id=tenant.id,
        popup_id=popup.id,
        application_id=application.id,
        human_id=human.id,
        name="Ana Diaz",
        email=human.email,
        category="main",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _default_flow(db: Session, popup: Popups) -> SalesFlows:
    """The popup's default flow, provisioned if the test has not built an
    application yet (which is what usually creates it)."""
    application_flow_id(db, popup.id)
    flow = sales_flows_crud.get_default_flow(db, popup.id)
    assert flow is not None
    return flow


def _set_flow_fees(db: Session, flow: SalesFlows, **fees) -> SalesFlows:
    for name, value in fees.items():
        setattr(flow, name, value)
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _preview(client: TestClient, human: Humans, application, product, attendee):
    token = create_access_token(subject=human.id, token_type="human")
    return client.post(
        "/api/v1/payments/my/preview",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "application_id": str(application.id),
            "products": [
                {
                    "product_id": str(product.id),
                    "attendee_id": str(attendee.id),
                    "quantity": 1,
                }
            ],
        },
    )


class TestContribution:
    def test_the_flow_charges_what_the_event_does_not(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, contribution_enabled=False)
        product = _product(db, tenant_a, popup, price="100.00")
        human = _human(db, tenant_a)
        application = _application(db, tenant_a, popup, human)
        attendee = _attendee(db, tenant_a, popup, application, human)
        _set_flow_fees(
            db,
            _default_flow(db, popup),
            contribution_enabled=True,
            contribution_percentage=Decimal("5.00"),
        )

        resp = _preview(client, human, application, product, attendee)

        assert resp.status_code == 200, resp.text
        assert Decimal(resp.json()["contribution_amount"]) == Decimal("5.00")

    def test_the_flow_waives_what_the_event_charges(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(
            db,
            tenant_a,
            contribution_enabled=True,
            contribution_percentage=Decimal("5.00"),
        )
        product = _product(db, tenant_a, popup, price="100.00")
        human = _human(db, tenant_a)
        application = _application(db, tenant_a, popup, human)
        attendee = _attendee(db, tenant_a, popup, application, human)
        _set_flow_fees(
            db,
            _default_flow(db, popup),
            contribution_enabled=False,
            contribution_percentage=None,
        )

        resp = _preview(client, human, application, product, attendee)

        assert resp.status_code == 200, resp.text
        assert Decimal(resp.json()["contribution_amount"]) == Decimal("0")

    def test_two_doors_of_one_gathering_charge_different_rates(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """The reason the columns moved: same event, same product, two rates."""
        popup = _popup(db, tenant_a, contribution_enabled=False)
        product = _product(db, tenant_a, popup, price="100.00")

        general = _set_flow_fees(
            db,
            _default_flow(db, popup),
            contribution_enabled=True,
            contribution_percentage=Decimal("10.00"),
        )
        partner = SalesFlows(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            slug=f"partner-{uuid.uuid4().hex[:8]}",
            name="Partner",
            type=SaleType.application.value,
            contribution_enabled=True,
            contribution_percentage=Decimal("2.00"),
        )
        db.add(partner)
        db.commit()
        db.refresh(partner)

        buyer_a = _human(db, tenant_a)
        app_a = _application(db, tenant_a, popup, buyer_a, flow_id=general.id)
        attendee_a = _attendee(db, tenant_a, popup, app_a, buyer_a)

        buyer_b = _human(db, tenant_a)
        app_b = _application(db, tenant_a, popup, buyer_b, flow_id=partner.id)
        attendee_b = _attendee(db, tenant_a, popup, app_b, buyer_b)

        through_general = _preview(client, buyer_a, app_a, product, attendee_a)
        through_partner = _preview(client, buyer_b, app_b, product, attendee_b)

        assert through_general.status_code == 200, through_general.text
        assert through_partner.status_code == 200, through_partner.text
        assert Decimal(through_general.json()["contribution_amount"]) == Decimal(
            "10.00"
        )
        assert Decimal(through_partner.json()["contribution_amount"]) == Decimal("2.00")


class TestInsurance:
    def test_the_flow_offers_insurance_the_event_does_not(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, insurance_enabled=False)
        product = _product(db, tenant_a, popup, price="200.00")
        human = _human(db, tenant_a)
        application = _application(db, tenant_a, popup, human)
        attendee = _attendee(db, tenant_a, popup, application, human)
        _set_flow_fees(
            db,
            _default_flow(db, popup),
            insurance_enabled=True,
            insurance_percentage=Decimal("5.00"),
        )

        token = create_access_token(subject=human.id, token_type="human")
        resp = client.post(
            "/api/v1/payments/my/preview",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "application_id": str(application.id),
                "insurance": True,
                "products": [
                    {
                        "product_id": str(product.id),
                        "attendee_id": str(attendee.id),
                        "quantity": 1,
                    }
                ],
            },
        )

        assert resp.status_code == 200, resp.text
        assert Decimal(resp.json()["insurance_amount"]) == Decimal("10.00")
