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

from app.api.application.models import Applications
from app.api.human.models import Humans
from app.api.popup.models import Popups
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


class TestFlowScopedPortalUpdate:
    @staticmethod
    def _create_application(
        client: TestClient,
        token: str,
        popup_id: str,
        sales_flow_id: uuid.UUID | None = None,
    ) -> dict:
        payload = {
            "popup_id": popup_id,
            "first_name": "Pat",
            "last_name": "Doe",
            "status": "draft",
        }
        if sales_flow_id is not None:
            payload["sales_flow_id"] = str(sales_flow_id)
        response = client.post(
            "/api/v1/applications/my", headers=_headers(token), json=payload
        )
        assert response.status_code == 201, response.text
        return response.json()

    @staticmethod
    def _make_flow(db: Session, tenant: Tenants, popup_id: str) -> SalesFlows:
        flow = SalesFlows(
            tenant_id=tenant.id,
            popup_id=uuid.UUID(popup_id),
            slug=f"update-{uuid.uuid4().hex[:8]}",
            name="Update target",
            type="application",
        )
        db.add(flow)
        db.commit()
        db.refresh(flow)
        return flow

    def test_selected_flow_updates_only_its_application(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        secondary_flow = self._make_flow(db, tenant_a, popup_id)
        token = _make_human_token(db, tenant_a)
        default_application = self._create_application(client, token, popup_id)
        secondary_application = self._create_application(
            client, token, popup_id, secondary_flow.id
        )

        response = client.patch(
            f"/api/v1/applications/my/{popup_id}",
            headers=_headers(token),
            params={"sales_flow_id": str(secondary_flow.id)},
            json={"referral": "secondary-only"},
        )

        assert response.status_code == 200, response.text
        assert response.json()["id"] == secondary_application["id"]
        db.expire_all()
        default_row = db.get(Applications, uuid.UUID(default_application["id"]))
        secondary_row = db.get(Applications, uuid.UUID(secondary_application["id"]))
        assert default_row is not None
        assert secondary_row is not None
        assert default_row.referral is None
        assert secondary_row.referral == "secondary-only"

    def test_missing_sales_flow_id_is_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        token = _make_human_token(db, tenant_a)
        application = self._create_application(client, token, popup_id)

        response = client.patch(
            f"/api/v1/applications/my/{popup_id}",
            headers=_headers(token),
            json={"referral": "must-not-change"},
        )

        assert response.status_code == 422, response.text
        db.expire_all()
        row = db.get(Applications, uuid.UUID(application["id"]))
        assert row is not None
        assert row.referral is None

    def test_unknown_sales_flow_id_does_not_update_an_application(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        token = _make_human_token(db, tenant_a)
        application = self._create_application(client, token, popup_id)

        response = client.patch(
            f"/api/v1/applications/my/{popup_id}",
            headers=_headers(token),
            params={"sales_flow_id": str(uuid.uuid4())},
            json={"referral": "must-not-change"},
        )

        assert response.status_code == 404, response.text
        db.expire_all()
        row = db.get(Applications, uuid.UUID(application["id"]))
        assert row is not None
        assert row.referral is None

    def test_flow_from_another_popup_cannot_redirect_the_update(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        other_popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        token = _make_human_token(db, tenant_a)
        target = self._create_application(client, token, popup_id)
        other = self._create_application(client, token, other_popup_id)

        response = client.patch(
            f"/api/v1/applications/my/{popup_id}",
            headers=_headers(token),
            params={"sales_flow_id": other["sales_flow_id"]},
            json={"referral": "must-not-change"},
        )

        assert response.status_code == 404, response.text
        db.expire_all()
        target_row = db.get(Applications, uuid.UUID(target["id"]))
        other_row = db.get(Applications, uuid.UUID(other["id"]))
        assert target_row is not None
        assert other_row is not None
        assert target_row.referral is None
        assert other_row.referral is None

    def test_another_human_cannot_update_the_selected_application(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        owner_token = _make_human_token(db, tenant_a)
        attacker_token = _make_human_token(db, tenant_a)
        application = self._create_application(client, owner_token, popup_id)

        response = client.patch(
            f"/api/v1/applications/my/{popup_id}",
            headers=_headers(attacker_token),
            params={"sales_flow_id": application["sales_flow_id"]},
            json={"referral": "must-not-change"},
        )

        assert response.status_code == 404, response.text
        db.expire_all()
        row = db.get(Applications, uuid.UUID(application["id"]))
        assert row is not None
        assert row.referral is None

    def test_flow_from_another_tenant_is_not_visible(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_b: Popups,
        default_flow_tenant_b: SalesFlows,
        admin_token_tenant_a: str,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        token = _make_human_token(db, tenant_a)
        application = self._create_application(client, token, popup_id)

        response = client.patch(
            f"/api/v1/applications/my/{popup_tenant_b.id}",
            headers=_headers(token),
            params={"sales_flow_id": str(default_flow_tenant_b.id)},
            json={"referral": "must-not-change"},
        )

        assert response.status_code == 404, response.text
        db.expire_all()
        row = db.get(Applications, uuid.UUID(application["id"]))
        assert row is not None
        assert row.referral is None
