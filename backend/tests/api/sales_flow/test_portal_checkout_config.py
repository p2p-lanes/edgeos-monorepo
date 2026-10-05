"""The checkout reads a door's buyer-facing settings from the door.

Coupons, insurance and contribution moved onto the flow (slice 7) and the
backoffice stopped editing the popup's columns, but the portal kept reading
them off `PopupPublic`. A door with coupons off still showed the promo code
field, and the server refused every code typed into it.

The flow's settings now reach the portal on their own: inside the anonymous
checkout runtime, and through `GET /sales-flows/portal/checkout-config` for
the signed-in checkout. Both answer with the same narrow allowlist.
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

# Every key is something the confirm step shows a buyer. Asserting the exact
# set keeps a future field from leaking in by accident, the way
# `open_checkout_signing_secret` once did through the flow listing.
ALLOWED_KEYS = {
    "allows_coupons",
    "insurance_enabled",
    "insurance_percentage",
    "contribution_enabled",
    "contribution_percentage",
    "contribution_label",
    "contribution_description",
}


def _popup(db: Session, tenant: Tenants) -> Popups:
    slug = f"flowcfg-{uuid.uuid4().hex[:8]}"
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Flow Config {slug}",
        slug=slug,
        sale_type=SaleType.direct.value,
        status="active",
        # The stale popup columns say yes to everything. The door says no.
        allows_coupons=True,
        insurance_enabled=True,
        insurance_percentage=Decimal("5"),
        contribution_enabled=True,
        contribution_percentage=Decimal("3"),
    )
    db.add(popup)
    db.flush()
    flow = sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant.id, sale_type=SaleType.direct.value
    )
    flow.allows_coupons = False
    flow.insurance_enabled = False
    flow.contribution_enabled = False
    flow.open_checkout_signing_secret = "the-key-that-signs-orders"
    db.add(flow)
    db.flush()
    return popup


def _door(db: Session, popup: Popups) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=f"vip-{uuid.uuid4().hex[:6]}",
        name="VIP",
        type="direct",
        visibility="portal_listed",
        allows_coupons=True,
        contribution_enabled=True,
        contribution_percentage=Decimal("10"),
        contribution_label="Community fund",
        open_checkout_signing_secret="the-key-that-signs-orders",
    )
    db.add(flow)
    db.flush()
    return flow


def _human_token(db: Session, tenant: Tenants) -> str:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"flowcfg-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.commit()
    return create_access_token(subject=human.id, token_type="human")


class TestPortalCheckoutConfig:
    def test_the_default_door_answers_with_its_own_settings(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a)
        db.commit()

        resp = client.get(
            f"/api/v1/sales-flows/portal/checkout-config?popup_id={popup.id}",
            headers={"Authorization": f"Bearer {_human_token(db, tenant_a)}"},
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body) == ALLOWED_KEYS
        assert body["allows_coupons"] is False
        assert body["insurance_enabled"] is False
        assert body["contribution_enabled"] is False
        assert "the-key-that-signs-orders" not in resp.text

    def test_a_named_door_answers_for_itself(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a)
        door = _door(db, popup)
        db.commit()

        resp = client.get(
            "/api/v1/sales-flows/portal/checkout-config"
            f"?popup_id={popup.id}&sales_flow_id={door.id}",
            headers={"Authorization": f"Bearer {_human_token(db, tenant_a)}"},
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["allows_coupons"] is True
        assert body["contribution_enabled"] is True
        assert Decimal(str(body["contribution_percentage"])) == Decimal("10")
        assert body["contribution_label"] == "Community fund"

    def test_a_door_from_another_popup_is_not_found(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a)
        other_door = _door(db, _popup(db, tenant_a))
        db.commit()

        resp = client.get(
            "/api/v1/sales-flows/portal/checkout-config"
            f"?popup_id={popup.id}&sales_flow_id={other_door.id}",
            headers={"Authorization": f"Bearer {_human_token(db, tenant_a)}"},
        )

        assert resp.status_code == 404, resp.text

    def test_the_anonymous_runtime_carries_the_doors_settings(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a)
        door = _door(db, popup)
        default_flow = sales_flows_crud.get_default_flow(db, popup.id)
        db.commit()

        default_resp = client.get(
            f"/api/v1/checkout/{popup.slug}/{default_flow.slug}/runtime",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        door_resp = client.get(
            f"/api/v1/checkout/{popup.slug}/{door.slug}/runtime",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )

        assert default_resp.status_code == 200, default_resp.text
        assert door_resp.status_code == 200, door_resp.text
        default_config = default_resp.json()["checkout_config"]
        door_config = door_resp.json()["checkout_config"]
        assert set(default_config) == ALLOWED_KEYS
        assert default_config["allows_coupons"] is False
        assert default_config["insurance_enabled"] is False
        assert door_config["allows_coupons"] is True
        assert door_config["contribution_label"] == "Community fund"
        assert "the-key-that-signs-orders" not in door_resp.text
