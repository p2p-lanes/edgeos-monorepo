"""Slice 14, task 14.2 — `ApplicationAdminCreate` gains an explicit
`sales_flow_id`, validated with the same `_get_flow_or_404`-class ownership
check as `ApplicationsCRUD.resolve_target_flow_id` (task 9.7): the flow must
belong to the request's `popup_id` and be `type=application`, otherwise 404.
Omitted keeps the pre-existing default-flow resolution (`resolve_creation_flow_id`).
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _admin_headers(superadmin_token: str, tenant: Tenants) -> dict[str, str]:
    return {**_headers(superadmin_token), "X-Tenant-Id": str(tenant.id)}


def _create_popup_via_api(client: TestClient, admin_token: str) -> str:
    unique = uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/popups",
        headers=_headers(admin_token),
        json={"name": f"Admin Explicit Flow Test {unique}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _create_extra_flow(
    db: Session,
    tenant: Tenants,
    popup_id: str,
    *,
    flow_type: str = "application",
) -> str:
    flow = SalesFlows(
        tenant_id=tenant.id,
        popup_id=uuid.UUID(popup_id),
        slug=f"extra-{uuid.uuid4().hex[:8]}",
        name="Extra Flow",
        type=flow_type,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return str(flow.id)


class TestAdminCreateExplicitFlow:
    def test_explicit_flow_id_is_persisted(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        superadmin_token: str,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        flow_id = _create_extra_flow(db, tenant_a, popup_id)
        email = f"admin-explicit-flow-{uuid.uuid4().hex[:8]}@test.com"

        resp = client.post(
            "/api/v1/applications",
            headers=_admin_headers(superadmin_token, tenant_a),
            json={
                "popup_id": popup_id,
                "first_name": "Pat",
                "last_name": "Doe",
                "email": email,
                "sales_flow_id": flow_id,
            },
        )
        assert resp.status_code == 201, resp.text

        application_id = uuid.UUID(resp.json()["id"])
        application = db.get(Applications, application_id)
        assert application is not None
        assert str(application.sales_flow_id) == flow_id

    def test_omitted_flow_id_falls_back_to_default_flow(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        superadmin_token: str,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        email = f"admin-default-flow-{uuid.uuid4().hex[:8]}@test.com"

        resp = client.post(
            "/api/v1/applications",
            headers=_admin_headers(superadmin_token, tenant_a),
            json={
                "popup_id": popup_id,
                "first_name": "Pat",
                "last_name": "Doe",
                "email": email,
            },
        )
        assert resp.status_code == 201, resp.text

        default_flow = db.exec(
            select(SalesFlows).where(
                SalesFlows.popup_id == uuid.UUID(popup_id),
                SalesFlows.is_default == True,  # noqa: E712
            )
        ).one()
        application = db.get(Applications, uuid.UUID(resp.json()["id"]))
        assert application is not None
        assert application.sales_flow_id == default_flow.id

    def test_flow_from_a_different_popup_is_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        superadmin_token: str,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        other_popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        foreign_flow_id = _create_extra_flow(db, tenant_a, other_popup_id)
        email = f"admin-cross-popup-flow-{uuid.uuid4().hex[:8]}@test.com"

        resp = client.post(
            "/api/v1/applications",
            headers=_admin_headers(superadmin_token, tenant_a),
            json={
                "popup_id": popup_id,
                "first_name": "Pat",
                "last_name": "Doe",
                "email": email,
                "sales_flow_id": foreign_flow_id,
            },
        )
        assert resp.status_code == 404

    def test_non_application_type_flow_is_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        superadmin_token: str,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        direct_flow_id = _create_extra_flow(db, tenant_a, popup_id, flow_type="direct")
        email = f"admin-wrong-type-flow-{uuid.uuid4().hex[:8]}@test.com"

        resp = client.post(
            "/api/v1/applications",
            headers=_admin_headers(superadmin_token, tenant_a),
            json={
                "popup_id": popup_id,
                "first_name": "Pat",
                "last_name": "Doe",
                "email": email,
                "sales_flow_id": direct_flow_id,
            },
        )
        assert resp.status_code == 404

    def test_explicit_flow_duplicate_check_is_flow_scoped(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        superadmin_token: str,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """The `get_by_human_flow` duplicate check is per-flow, not
        per-popup: same explicit flow twice is a duplicate (400), a
        different explicit flow for the same human/popup succeeds."""
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        flow_a = _create_extra_flow(db, tenant_a, popup_id)
        flow_b = _create_extra_flow(db, tenant_a, popup_id)
        email = f"admin-flow-scope-{uuid.uuid4().hex[:8]}@test.com"
        headers = _admin_headers(superadmin_token, tenant_a)

        def _apply(flow_id: str) -> object:
            return client.post(
                "/api/v1/applications",
                headers=headers,
                json={
                    "popup_id": popup_id,
                    "first_name": "Pat",
                    "last_name": "Doe",
                    "email": email,
                    "sales_flow_id": flow_id,
                },
            )

        resp1 = _apply(flow_a)
        assert resp1.status_code == 201, resp1.text

        dup = _apply(flow_a)
        assert dup.status_code == 400

        resp2 = _apply(flow_b)
        assert resp2.status_code == 201, resp2.text
        assert resp1.json()["id"] != resp2.json()["id"]
