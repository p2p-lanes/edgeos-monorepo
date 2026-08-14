"""A gathering that takes applications can still sell through one door.

Design: sdd/sales-flows-rediseno, `docs/sales-flows-que-mover.md` slice 6.

This is the whole premise of flows — one event, several ways in, each with its
own structure — and a popup-level `sale_type` was quietly denying it. The open
checkout asked the popup whether it sells directly and turned the request away
with a 403 before the flow was ever resolved. A sponsor's door on an
application event was unreachable, and nothing said why: the flow existed, was
configured, had products on sale, and answered 403.

The door answers for itself now.
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.api.ticketing_step.constants import seed_ticketing_steps_for_popup
from tests._flow_helpers import provision_default_flow


def _application_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Mixed {uuid.uuid4().hex[:6]}",
        slug=f"mixed-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
        simplefi_api_key="sf_test_key",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    provision_default_flow(db, popup, sale_type=SaleType.application.value)
    db.commit()
    return popup


def _direct_door(db: Session, popup: Popups, **config) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=f"sponsors-{uuid.uuid4().hex[:8]}",
        name="Sponsors",
        type=SaleType.direct.value,
        **config,
    )
    db.add(flow)
    db.flush()
    seed_ticketing_steps_for_popup(
        db,
        popup_id=popup.id,
        tenant_id=popup.tenant_id,
        sales_flow_id=flow.id,
        flow_type=flow.type,
    )
    db.commit()
    db.refresh(flow)
    return flow


def _product(db: Session, popup: Popups, *, price: str) -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name="VIP",
        slug=f"vip-{uuid.uuid4().hex[:8]}",
        price=Decimal(price),
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _preview(client: TestClient, tenant: Tenants, popup: Popups, product, flow=None):
    query = f"?flow_slug={flow.slug}" if flow is not None else ""
    return client.post(
        f"/api/v1/checkout/{popup.slug}/preview{query}",
        json={"products": [{"product_id": str(product.id), "quantity": 1}]},
        headers={"X-Tenant-Id": str(tenant.id)},
    )


class TestOpenCheckoutThroughADirectDoor:
    def test_the_door_sells_even_though_the_event_takes_applications(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _application_popup(db, tenant_a)
        door = _direct_door(db, popup)
        product = _product(db, popup, price="599.00")

        resp = _preview(client, tenant_a, popup, product, door)

        assert resp.status_code == 200, resp.text
        assert Decimal(resp.json()["total"]) == Decimal("599.00")

    def test_the_door_charges_its_own_fee(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """The quote a buyer is shown comes from the door, all the way down."""
        popup = _application_popup(db, tenant_a)
        door = _direct_door(
            db,
            popup,
            contribution_enabled=True,
            contribution_percentage=Decimal("5.00"),
        )
        product = _product(db, popup, price="599.00")

        resp = _preview(client, tenant_a, popup, product, door)

        assert resp.status_code == 200, resp.text
        assert Decimal(resp.json()["contribution_amount"]) == Decimal("29.95")

    def test_a_door_that_takes_applications_still_refuses(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Naming no door falls to the default one, which here takes
        applications: there is nothing for an anonymous buyer to do."""
        popup = _application_popup(db, tenant_a)
        _direct_door(db, popup)
        product = _product(db, popup, price="599.00")

        resp = _preview(client, tenant_a, popup, product)

        assert resp.status_code == 403, resp.text

    def test_the_share_card_exists_because_one_door_sells(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """The link is worth previewing when any way in can be bought through,
        which used to be answered by the popup and hid this case."""
        popup = _application_popup(db, tenant_a)
        _direct_door(db, popup)

        resp = client.get(
            f"/api/v1/checkout/{popup.slug}/share",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )

        assert resp.status_code == 200, resp.text
