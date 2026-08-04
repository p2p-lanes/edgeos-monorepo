"""Task 9.7 — explicit target flow on application creation + flow-aware
duplicate messaging.

Design: sdd/sales-flows D6 URL scheme, task 9.7 (carried forward from
slice 5's risk note). `POST /applications/my` now accepts an optional
`sales_flow_id` (validated: must belong to the popup and be
`type=application`, mirrors every other `_get_flow_or_404` in this SDD
change). Omitted keeps the pre-existing default-flow resolution. The
duplicate-application message stays substring-compatible with
`useCheckoutState.ts:199` ("already have an application") in both cases —
the portal side needs no change (verified in the portal test suite,
task 9.7 note).

TDD: RED -> GREEN.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from app.core.security import create_access_token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_popup_via_api(client: TestClient, admin_token: str) -> str:
    unique = uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/popups",
        headers=_headers(admin_token),
        json={"name": f"Flow Target Test {unique}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _make_human_token(db: Session, tenant: Tenants) -> str:
    human = Humans(
        tenant_id=tenant.id,
        email=f"flow-target-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Pat",
        last_name="Doe",
    )
    db.add(human)
    db.commit()
    return create_access_token(subject=human.id, token_type="human")


class TestExplicitTargetFlow:
    def test_explicit_non_default_flow_is_stamped_on_creation(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        flow = SalesFlows(
            tenant_id=tenant_a.id,
            popup_id=uuid.UUID(popup_id),
            slug="vip-track",
            name="VIP Track",
            type="application",
        )
        db.add(flow)
        db.commit()
        token = _make_human_token(db, tenant_a)

        resp = client.post(
            "/api/v1/applications/my",
            headers=_headers(token),
            json={
                "popup_id": popup_id,
                "first_name": "Pat",
                "last_name": "Doe",
                "sales_flow_id": str(flow.id),
            },
        )
        assert resp.status_code == 201, resp.text
        from app.api.application.models import Applications

        application = db.get(Applications, uuid.UUID(resp.json()["id"]))
        assert application is not None
        assert application.sales_flow_id == flow.id

    def test_explicit_flow_from_another_popup_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        other_popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        other_flow = SalesFlows(
            tenant_id=tenant_a.id,
            popup_id=uuid.UUID(other_popup_id),
            slug="only-on-other",
            name="Only On Other",
            type="application",
        )
        db.add(other_flow)
        db.commit()
        token = _make_human_token(db, tenant_a)

        resp = client.post(
            "/api/v1/applications/my",
            headers=_headers(token),
            json={
                "popup_id": popup_id,
                "first_name": "Pat",
                "last_name": "Doe",
                "sales_flow_id": str(other_flow.id),
            },
        )
        assert resp.status_code == 404, resp.text

    def test_duplicate_for_explicit_flow_still_matches_portal_substring(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        flow = SalesFlows(
            tenant_id=tenant_a.id,
            popup_id=uuid.UUID(popup_id),
            slug="vip-track-2",
            name="VIP Track 2",
            type="application",
        )
        db.add(flow)
        db.commit()
        token = _make_human_token(db, tenant_a)
        payload = {
            "popup_id": popup_id,
            "first_name": "Pat",
            "last_name": "Doe",
            "sales_flow_id": str(flow.id),
        }

        first = client.post(
            "/api/v1/applications/my", headers=_headers(token), json=payload
        )
        assert first.status_code == 201, first.text

        second = client.post(
            "/api/v1/applications/my", headers=_headers(token), json=payload
        )
        assert second.status_code == 400
        assert "already have an application" in second.json()["detail"]

    def test_explicit_flow_does_not_collide_with_default_flow_application(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """A human can hold one application per flow — applying to the
        default flow, then to an explicit non-default flow, is not a
        duplicate (design D-slice-5 G2)."""
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        flow = SalesFlows(
            tenant_id=tenant_a.id,
            popup_id=uuid.UUID(popup_id),
            slug="vip-track-3",
            name="VIP Track 3",
            type="application",
        )
        db.add(flow)
        db.commit()
        token = _make_human_token(db, tenant_a)

        default_resp = client.post(
            "/api/v1/applications/my",
            headers=_headers(token),
            json={"popup_id": popup_id, "first_name": "Pat", "last_name": "Doe"},
        )
        assert default_resp.status_code == 201, default_resp.text

        explicit_resp = client.post(
            "/api/v1/applications/my",
            headers=_headers(token),
            json={
                "popup_id": popup_id,
                "first_name": "Pat",
                "last_name": "Doe",
                "sales_flow_id": str(flow.id),
            },
        )
        assert explicit_resp.status_code == 201, explicit_resp.text
        assert explicit_resp.json()["id"] != default_resp.json()["id"]


class TestMyApplicationSurfaceWithMultiFlowApplications:
    """Task 9.7: verify GET /applications/my/{popup_id} and
    /my/participation/{popup_id} behave SANELY (deterministic, never a 500)
    for a human holding 2+ applications across different flows of the same
    popup — and disclose the remaining precision gap: both endpoints are
    single-result surfaces, so only the higher-priority application
    (accepted first, then most recent submission — `get_by_human_popup`'s
    ordering, unchanged since slice 5) is ever returned. No portal surface
    lets a human pick between flow-scoped applications within one popup;
    not addressed here (see apply-progress for the full disclosure)."""

    def test_get_my_application_returns_deterministic_result_not_500(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        flow = SalesFlows(
            tenant_id=tenant_a.id,
            popup_id=uuid.UUID(popup_id),
            slug="second-flow",
            name="Second Flow",
            type="application",
        )
        db.add(flow)
        db.commit()
        token = _make_human_token(db, tenant_a)

        default_resp = client.post(
            "/api/v1/applications/my",
            headers=_headers(token),
            json={"popup_id": popup_id, "first_name": "Pat", "last_name": "Doe"},
        )
        assert default_resp.status_code == 201, default_resp.text

        explicit_resp = client.post(
            "/api/v1/applications/my",
            headers=_headers(token),
            json={
                "popup_id": popup_id,
                "first_name": "Pat",
                "last_name": "Doe",
                "sales_flow_id": str(flow.id),
            },
        )
        assert explicit_resp.status_code == 201, explicit_resp.text

        get_resp = client.get(
            f"/api/v1/applications/my/{popup_id}", headers=_headers(token)
        )
        assert get_resp.status_code == 200, get_resp.text
        # Deterministic: same-status, same-submitted_at siblings resolve by
        # id (desc) — both applications are equally "recent", so the result
        # is stable across calls rather than crashing or flapping.
        first_id = get_resp.json()["id"]
        again = client.get(
            f"/api/v1/applications/my/{popup_id}", headers=_headers(token)
        )
        assert again.json()["id"] == first_id

        participation_resp = client.get(
            f"/api/v1/applications/my/participation/{popup_id}",
            headers=_headers(token),
        )
        assert participation_resp.status_code == 200, participation_resp.text
        assert participation_resp.json()["type"] == "applicant"
