"""Task 12.x — catalog-read enforcement (design's call-site table): the
checkout runtime's product list adopts D3 per-product exclusivity + the
flow's restriction_rule, via `services/restrictions/enforcement.filter_allowed_products`
(silent filter — never an error at a catalog read, matches every other
portal listing's shape).

TDD: RED -> GREEN.
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from tests._flow_helpers import seed_default_steps


def _make_direct_popup(db: Session, tenant: Tenants, *, slug_prefix: str) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Catalog Filter Popup {slug_prefix}",
        slug=f"{slug_prefix}-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.direct.value,
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    # A real popup ships with its steps, and the steps decide what it sells.
    seed_default_steps(db, popup, sale_type=SaleType.direct.value)
    return popup


def _make_product(
    db: Session, popup: Popups, *, name: str, category: str = "ticket"
) -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=name,
        slug=f"{name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:6]}",
        price=Decimal("0"),
        category=category,
        is_active=True,
    )
    db.add(product)
    db.flush()
    return product


class TestCheckoutRuntimeCatalogFilter:
    def test_product_no_step_offers_is_absent_from_the_runtime(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """The runtime carries what the flow's steps offer, nothing else."""
        popup = _make_direct_popup(db, tenant_a, slug_prefix="cf")

        shared_product = _make_product(db, popup, name="Shared Ticket")
        # No seeded step has product_category="sponsorship", so this flow
        # never offers it and the buyer's payload must not carry it.
        exclusive_product = _make_product(
            db, popup, name="Unoffered Ticket", category="sponsorship"
        )
        db.commit()

        response = client.get(
            f"/api/v1/checkout/{popup.slug}/checkout/runtime",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 200, response.text
        product_ids = {p["id"] for p in response.json()["products"]}
        assert str(shared_product.id) in product_ids
        assert str(exclusive_product.id) not in product_ids

    def test_restriction_rule_failing_hides_entire_catalog(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_direct_popup(db, tenant_a, slug_prefix="cf-rule")
        flow = sales_flows_crud.get_default_flow(db, popup.id)
        flow.restriction_rule = {
            "kind": "form_answer",
            "field_name": "vip_code",
            "op": "eq",
            "value": "secret",
        }
        db.add(flow)
        _make_product(db, popup, name="Any Ticket")
        db.commit()

        response = client.get(
            f"/api/v1/checkout/{popup.slug}/checkout/runtime",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 200, response.text
        assert response.json()["products"] == []

    def test_everything_the_steps_offer_is_shown(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_direct_popup(db, tenant_a, slug_prefix="cf-none")
        product = _make_product(db, popup, name="Open Ticket")
        db.commit()

        response = client.get(
            f"/api/v1/checkout/{popup.slug}/checkout/runtime",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 200, response.text
        product_ids = {p["id"] for p in response.json()["products"]}
        assert str(product.id) in product_ids
