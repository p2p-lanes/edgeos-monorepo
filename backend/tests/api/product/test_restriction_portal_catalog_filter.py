"""Task 12.x — catalog-read enforcement (design's call-site table): the
portal product listing (`GET /products/portal/products`) adopts D3
per-product exclusivity when scoped to a popup, resolving that popup's
default flow (optional degrade — legacy fixture popups without one keep
their pre-slice-12 unfiltered behavior).

TDD: RED -> GREEN.
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import FlowProducts, SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import assign_to_default_flow


def _make_popup_with_default_flow(
    db: Session, tenant: Tenants, *, slug_prefix: str
) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Portal Catalog Filter Popup {slug_prefix}",
        slug=f"{slug_prefix}-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.flush()
    sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant.id, sale_type=SaleType.application.value
    )
    db.flush()
    return popup


def _make_product(
    db: Session, popup: Popups, *, name: str, assign_default: bool = True
) -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=name,
        slug=f"{name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:6]}",
        price=Decimal("0"),
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.flush()
    # Exclusive-product scenarios assign elsewhere on purpose.
    if assign_default:
        assign_to_default_flow(db, product)
    return product


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id, email=f"portal-catalog-{uuid.uuid4().hex[:8]}@test.com"
    )
    db.add(human)
    db.flush()
    return human


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


class TestPortalProductListingCatalogFilter:
    def test_flow_exclusive_product_hidden_from_scoped_listing(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup_with_default_flow(db, tenant_a, slug_prefix="pcf")
        other_flow = SalesFlows(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            slug="other",
            name="Other",
            type="application",
        )
        db.add(other_flow)
        db.flush()

        shared_product = _make_product(db, popup, name="Shared Product")
        exclusive_product = _make_product(
            db, popup, name="Exclusive Product", assign_default=False
        )
        db.add(
            FlowProducts(
                tenant_id=tenant_a.id,
                flow_id=other_flow.id,
                product_id=exclusive_product.id,
            )
        )
        human = _make_human(db, tenant_a)
        db.commit()

        response = client.get(
            "/api/v1/products/portal/products",
            params={"popup_id": str(popup.id)},
            headers={
                "X-Tenant-Id": str(tenant_a.id),
                "Authorization": f"Bearer {_human_token(human)}",
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        product_ids = {p["id"] for p in body["results"]}
        assert str(shared_product.id) in product_ids
        assert str(exclusive_product.id) not in product_ids
        # rel-001/risk-002: paging.total must reflect the filtered count
        # (1 visible product here), not the raw pre-filter count (2).
        assert body["paging"]["total"] == len(body["results"]) == 1

    def test_unassigned_products_visible_in_scoped_listing(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup_with_default_flow(db, tenant_a, slug_prefix="pcf-open")
        product = _make_product(db, popup, name="Open Product")
        human = _make_human(db, tenant_a)
        db.commit()

        response = client.get(
            "/api/v1/products/portal/products",
            params={"popup_id": str(popup.id)},
            headers={
                "X-Tenant-Id": str(tenant_a.id),
                "Authorization": f"Bearer {_human_token(human)}",
            },
        )
        assert response.status_code == 200, response.text
        product_ids = {p["id"] for p in response.json()["results"]}
        assert str(product.id) in product_ids

    def test_legacy_popup_without_default_flow_stays_unfiltered(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A legacy fixture popup with no provisioned default flow keeps its
        pre-slice-12 behavior — no enforcement possible without a flow."""
        popup = Popups(
            tenant_id=tenant_a.id,
            name="Legacy No-Flow Popup",
            slug=f"legacy-pcf-{uuid.uuid4().hex[:8]}",
            sale_type=SaleType.application.value,
            status="active",
            currency="USD",
        )
        db.add(popup)
        db.flush()
        product = _make_product(db, popup, name="Legacy Product")
        human = _make_human(db, tenant_a)
        db.commit()

        response = client.get(
            "/api/v1/products/portal/products",
            params={"popup_id": str(popup.id)},
            headers={
                "X-Tenant-Id": str(tenant_a.id),
                "Authorization": f"Bearer {_human_token(human)}",
            },
        )
        assert response.status_code == 200, response.text
        product_ids = {p["id"] for p in response.json()["results"]}
        assert str(product.id) in product_ids
