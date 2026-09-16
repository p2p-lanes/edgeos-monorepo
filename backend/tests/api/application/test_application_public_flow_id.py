"""Slice 14 backlog — `ApplicationPublic` exposes `sales_flow_id`.

Lets the portal's needsFlowChoice heuristic (task 9.4) read the resolved
flow off the application response directly instead of re-deriving it.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_popup_via_api(client: TestClient, admin_token: str) -> str:
    unique = uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/popups",
        headers=_headers(admin_token),
        json={"name": f"Public Flow Id Test {unique}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


class TestApplicationPublicExposesSalesFlowId:
    def test_admin_detail_response_includes_sales_flow_id(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        superadmin_token: str,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        email = f"public-flow-id-{uuid.uuid4().hex[:8]}@test.com"

        create_resp = client.post(
            "/api/v1/applications",
            headers={**_headers(superadmin_token), "X-Tenant-Id": str(tenant_a.id)},
            json={
                "popup_id": popup_id,
                "first_name": "Pat",
                "last_name": "Doe",
                "email": email,
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        application_id = create_resp.json()["id"]

        detail_resp = client.get(
            f"/api/v1/applications/{application_id}",
            headers={**_headers(superadmin_token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert detail_resp.status_code == 200, detail_resp.text

        default_flow = db.exec(
            select(SalesFlows).where(
                SalesFlows.popup_id == uuid.UUID(popup_id),
                SalesFlows.is_default == True,  # noqa: E712
            )
        ).one()
        assert detail_resp.json()["sales_flow_id"] == str(default_flow.id)
