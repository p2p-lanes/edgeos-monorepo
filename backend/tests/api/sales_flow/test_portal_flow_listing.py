"""Task 9.4 — GET /sales-flows/portal (portal-facing flow listing).

Design: sdd/sales-flows G0 (Portal flow listing) + Threat Matrix. Lists a
popup's `portal_listed`, `type=application` sales flows, ordered by `order`
then `created_at` — backs the portal FlowPicker (shown only when >1 exists).
`direct_url_only` flows are reachable by URL (see checkout runtime tests)
but never appear here.

TDD: RED -> GREEN.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    slug = f"portal-listing-{uuid.uuid4().hex[:8]}"
    popup = Popups(tenant_id=tenant.id, name=f"Popup {slug}", slug=slug)
    db.add(popup)
    db.flush()
    sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant.id, sale_type="application"
    )
    db.flush()
    return popup


def _make_flow(
    db: Session,
    popup: Popups,
    *,
    slug: str,
    visibility: str = "portal_listed",
    type: str = "application",  # noqa: A002
    order: int = 0,
    status: str | None = None,
) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=slug,
        name=f"Flow {slug}",
        visibility=visibility,
        type=type,
        order=order,
        status=status,
    )
    db.add(flow)
    db.flush()
    return flow


def _human_token(db: Session, tenant: Tenants) -> str:
    from app.api.human.models import Humans
    from app.core.security import create_access_token

    human = Humans(
        tenant_id=tenant.id,
        email=f"portal-listing-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Pat",
        last_name="Doe",
    )
    db.add(human)
    db.commit()
    return create_access_token(subject=human.id, token_type="human")


class TestPortalFlowListing:
    def test_lists_portal_listed_application_flows_ordered(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_flow(db, popup, slug="second", order=2)
        _make_flow(db, popup, slug="first", order=1)
        db.commit()
        token = _human_token(db, tenant_a)

        response = client.get(
            "/api/v1/sales-flows/portal",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200, response.text
        slugs = [f["slug"] for f in response.json()["results"]]
        # The default flow (order=0, provisioned by _make_popup) sorts first.
        assert slugs[-2:] == ["first", "second"]

    def test_direct_url_only_flow_excluded(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Threat matrix: direct_url_only never appears in the listing, but
        is still reachable by direct URL (see checkout runtime tests)."""
        popup = _make_popup(db, tenant_a)
        _make_flow(db, popup, slug="hidden", visibility="direct_url_only")
        db.commit()
        token = _human_token(db, tenant_a)

        response = client.get(
            "/api/v1/sales-flows/portal",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200, response.text
        slugs = [f["slug"] for f in response.json()["results"]]
        assert "hidden" not in slugs

    def test_non_application_flow_excluded(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_flow(db, popup, slug="direct-flow", type="direct")
        db.commit()
        token = _human_token(db, tenant_a)

        response = client.get(
            "/api/v1/sales-flows/portal",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200, response.text
        slugs = [f["slug"] for f in response.json()["results"]]
        assert "direct-flow" not in slugs

    def test_cross_tenant_popup_returns_empty(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Threat matrix: tenant isolation on the portal listing."""
        from app.api.tenant.models import Tenants as TenantsModel

        tenant_b = TenantsModel(
            name=f"Portal Listing Tenant B {uuid.uuid4().hex[:6]}",
            slug=f"portal-listing-b-{uuid.uuid4().hex[:6]}",
        )
        db.add(tenant_b)
        db.commit()
        popup_b = _make_popup(db, tenant_b)
        db.commit()
        token = _human_token(db, tenant_a)

        response = client.get(
            "/api/v1/sales-flows/portal",
            params={"popup_id": str(popup_b.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["results"] == []


class TestPortalDirectFlowListing:
    def test_lists_only_open_portal_listed_direct_flows_ordered(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_flow(db, popup, slug="second", type="direct", order=2)
        _make_flow(db, popup, slug="first", type="direct", order=1)
        _make_flow(
            db,
            popup,
            slug="hidden",
            type="direct",
            visibility="direct_url_only",
        )
        _make_flow(db, popup, slug="application", type="application")
        _make_flow(db, popup, slug="upsale", type="upsale")
        _make_flow(db, popup, slug="closed", type="direct", status="closed")
        db.commit()
        token = _human_token(db, tenant_a)

        response = client.get(
            "/api/v1/sales-flows/portal/direct",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200, response.text
        assert [flow["slug"] for flow in response.json()["results"]] == [
            "first",
            "second",
        ]

    def test_anonymous_caller_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        db.commit()

        response = client.get(
            "/api/v1/sales-flows/portal/direct",
            params={"popup_id": str(popup.id)},
        )

        assert response.status_code in (401, 403), response.text

    def test_cross_tenant_popup_returns_empty(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        tenant_b = Tenants(
            name=f"Direct Listing Tenant B {uuid.uuid4().hex[:6]}",
            slug=f"direct-listing-b-{uuid.uuid4().hex[:6]}",
        )
        db.add(tenant_b)
        db.commit()
        popup_b = _make_popup(db, tenant_b)
        _make_flow(db, popup_b, slug="other-tenant", type="direct")
        db.commit()
        token = _human_token(db, tenant_a)

        response = client.get(
            "/api/v1/sales-flows/portal/direct",
            params={"popup_id": str(popup_b.id)},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200, response.text
        assert response.json()["results"] == []
