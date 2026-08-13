"""The portal is told a door's name, not how the organiser configured it.

`GET /sales-flows/portal` answered with `SalesFlowPublic`, which extends
`SalesFlowBase` and therefore carries every column a flow owns. One of them is
`open_checkout_signing_secret` — the HMAC key that signs the order payload an
external thank-you page verifies. The endpoint is readable by any
authenticated human of the tenant, so each of them was handed the key to forge
a completed order against that page.

It answers with a narrow schema now. This asserts the shape rather than the
absence of one field, because the leak was never about that field: it was
about a public response inheriting from the configuration model, which grows
every time a setting moves onto the flow. Three settings moved this week.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import provision_default_flow

# What a buyer legitimately needs to pick a way in and list them in order.
ALLOWED_KEYS = {"id", "slug", "name", "order"}


def _popup_with_flows(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Portal Listing {uuid.uuid4().hex[:8]}",
        slug=f"portal-listing-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        sale_type=SaleType.application,
        status="active",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    flow = provision_default_flow(db, popup, sale_type=SaleType.application.value)
    flow.open_checkout_signing_secret = "the-key-that-signs-orders"
    flow.contribution_percentage = 7
    db.add(flow)
    db.commit()
    return popup


def _human_token(db: Session, tenant: Tenants) -> str:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"listing-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.commit()
    return create_access_token(subject=human.id, token_type="human")


class TestPortalFlowListing:
    def test_it_returns_only_what_a_buyer_needs(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup_with_flows(db, tenant_a)

        resp = client.get(
            f"/api/v1/sales-flows/portal?popup_id={popup.id}",
            headers={"Authorization": f"Bearer {_human_token(db, tenant_a)}"},
        )

        assert resp.status_code == 200, resp.text
        results = resp.json()["results"]
        assert results, "the popup has a portal-listed flow"
        for flow in results:
            assert set(flow) == ALLOWED_KEYS, (
                f"portal listing exposes {set(flow) - ALLOWED_KEYS}"
            )

    def test_the_signing_secret_never_reaches_a_buyer(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Named on its own because of what it is: forge this and an external
        thank-you page believes an order that never happened."""
        popup = _popup_with_flows(db, tenant_a)

        resp = client.get(
            f"/api/v1/sales-flows/portal?popup_id={popup.id}",
            headers={"Authorization": f"Bearer {_human_token(db, tenant_a)}"},
        )

        assert resp.status_code == 200, resp.text
        assert "the-key-that-signs-orders" not in resp.text

    def test_the_upsale_listing_is_just_as_narrow(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup_with_flows(db, tenant_a)
        upsale = SalesFlows(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            slug=f"upsale-{uuid.uuid4().hex[:8]}",
            name="Upsale",
            type="upsale",
            open_checkout_signing_secret="the-key-that-signs-orders",
        )
        db.add(upsale)
        db.commit()

        resp = client.get(
            f"/api/v1/sales-flows/portal/upsale?popup_id={popup.id}",
            headers={"Authorization": f"Bearer {_human_token(db, tenant_a)}"},
        )

        assert resp.status_code == 200, resp.text
        assert "the-key-that-signs-orders" not in resp.text
        for flow in resp.json()["results"]:
            assert set(flow) == ALLOWED_KEYS
