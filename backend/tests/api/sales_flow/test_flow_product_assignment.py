"""Assigning products to a sales flow (sdd/sales-flows-rediseno slice 4b).

Since slice 4 a product sells only where it is assigned, which made
assignment the control that decides what a flow can sell. These are its
HTTP endpoints.

Scenarios:
- GET returns exactly the flow's assigned product ids.
- PUT replaces the whole set: additions and removals in one call.
- Removing a product from one flow leaves its other assignments alone.
- A product from another popup is rejected, not silently dropped.
- An empty set is legal and means the flow sells nothing.
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.models import FlowProducts, SalesFlows
from app.api.tenant.models import Tenants
from tests._flow_helpers import provision_default_flow


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Assign Popup {uuid.uuid4().hex[:6]}",
        slug=f"assign-{uuid.uuid4().hex[:8]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    provision_default_flow(db, popup)
    return popup


def _make_flow(db: Session, popup: Popups, *, slug: str) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        type="direct",
        slug=slug,
        name=slug,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _make_product(db: Session, popup: Popups, *, name: str) -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=name,
        slug=f"{name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:6]}",
        price=Decimal("10"),
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _assigned(db: Session, flow_id: uuid.UUID) -> set[uuid.UUID]:
    from sqlmodel import select

    return set(
        db.exec(
            select(FlowProducts.product_id).where(FlowProducts.flow_id == flow_id)
        ).all()
    )


class TestReadAssignments:
    def test_get_returns_the_flows_products(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug=f"read-{uuid.uuid4().hex[:6]}")
        mine = _make_product(db, popup, name="Mine")
        _make_product(db, popup, name="Not Mine")
        db.add(FlowProducts(tenant_id=tenant_a.id, flow_id=flow.id, product_id=mine.id))
        db.commit()

        resp = client.get(
            f"/api/v1/sales-flows/{flow.id}/products",
            headers=_headers(admin_token_tenant_a),
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["product_ids"] == [str(mine.id)]

    def test_unknown_flow_returns_404(
        self, client: TestClient, admin_token_tenant_a
    ) -> None:
        resp = client.get(
            f"/api/v1/sales-flows/{uuid.uuid4()}/products",
            headers=_headers(admin_token_tenant_a),
        )
        assert resp.status_code == 404, resp.text


class TestReplaceAssignments:
    def test_put_adds_and_removes_in_one_call(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug=f"put-{uuid.uuid4().hex[:6]}")
        keep = _make_product(db, popup, name="Keep")
        drop = _make_product(db, popup, name="Drop")
        add = _make_product(db, popup, name="Add")
        for product in (keep, drop):
            db.add(
                FlowProducts(
                    tenant_id=tenant_a.id, flow_id=flow.id, product_id=product.id
                )
            )
        db.commit()

        resp = client.put(
            f"/api/v1/sales-flows/{flow.id}/products",
            headers=_headers(admin_token_tenant_a),
            json={"product_ids": [str(keep.id), str(add.id)]},
        )

        assert resp.status_code == 200, resp.text
        assert _assigned(db, flow.id) == {keep.id, add.id}

    def test_empty_set_means_the_flow_sells_nothing(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug=f"empty-{uuid.uuid4().hex[:6]}")
        product = _make_product(db, popup, name="Only One")
        db.add(
            FlowProducts(tenant_id=tenant_a.id, flow_id=flow.id, product_id=product.id)
        )
        db.commit()

        resp = client.put(
            f"/api/v1/sales-flows/{flow.id}/products",
            headers=_headers(admin_token_tenant_a),
            json={"product_ids": []},
        )

        assert resp.status_code == 200, resp.text
        assert _assigned(db, flow.id) == set()

    def test_removing_here_leaves_other_flows_alone(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        """The bug the old rule created: assignment must never be global."""
        popup = _make_popup(db, tenant_a)
        flow_a = _make_flow(db, popup, slug=f"a-{uuid.uuid4().hex[:6]}")
        flow_b = _make_flow(db, popup, slug=f"b-{uuid.uuid4().hex[:6]}")
        shared = _make_product(db, popup, name="Shared")
        for flow in (flow_a, flow_b):
            db.add(
                FlowProducts(
                    tenant_id=tenant_a.id, flow_id=flow.id, product_id=shared.id
                )
            )
        db.commit()

        resp = client.put(
            f"/api/v1/sales-flows/{flow_a.id}/products",
            headers=_headers(admin_token_tenant_a),
            json={"product_ids": []},
        )

        assert resp.status_code == 200, resp.text
        assert _assigned(db, flow_a.id) == set()
        assert _assigned(db, flow_b.id) == {shared.id}

    def test_product_from_another_popup_is_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        popup = _make_popup(db, tenant_a)
        other_popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug=f"cross-{uuid.uuid4().hex[:6]}")
        foreign = _make_product(db, other_popup, name="Foreign")

        resp = client.put(
            f"/api/v1/sales-flows/{flow.id}/products",
            headers=_headers(admin_token_tenant_a),
            json={"product_ids": [str(foreign.id)]},
        )

        assert resp.status_code == 404, resp.text
        assert _assigned(db, flow.id) == set(), "a rejected call must write nothing"
