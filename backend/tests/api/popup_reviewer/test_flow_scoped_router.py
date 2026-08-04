"""HTTP-level tests for the flow-aware `/popups/{popup_id}/reviewers`
endpoints (sdd/sales-flows slice 7, D4). CRUD-level resolution/invariant
behavior is covered by `test_flow_scoped_reviewers.py` — these tests cover
the router's own wiring: `flow_id` query/body param plumbing and the
cross-popup flow validation (`_get_flow_or_404`).
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Reviewer Router Popup {uuid.uuid4().hex[:8]}",
        slug=f"reviewer-router-popup-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_flow(db: Session, tenant: Tenants, popup: Popups, *, slug: str) -> SalesFlows:
    flow = SalesFlows(tenant_id=tenant.id, popup_id=popup.id, slug=slug, name=slug)
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _make_reviewer_candidate(db: Session, tenant: Tenants) -> Users:
    user = Users(
        email=f"router-reviewer-{uuid.uuid4().hex[:8]}@test.com",
        role=UserRole.ADMIN,
        tenant_id=tenant.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


class TestAddFlowScopedReviewerViaApi:
    def test_add_reviewer_with_flow_id_sets_override_mode(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="router-flow-a")
        user = _make_reviewer_candidate(db, tenant_a)

        resp = client.post(
            f"/api/v1/popups/{popup.id}/reviewers",
            headers=_headers(admin_token_tenant_a),
            json={"user_id": str(user.id), "flow_id": str(flow.id)},
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["flow_id"] == str(flow.id)

        db.expire_all()
        refreshed = db.get(SalesFlows, flow.id)
        assert refreshed.reviewers_mode == "override"

    def test_add_reviewer_with_flow_from_another_popup_returns_404(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_a = _make_popup(db, tenant_a)
        popup_b = _make_popup(db, tenant_a)
        foreign_flow = _make_flow(db, tenant_a, popup_b, slug="foreign-flow")
        user = _make_reviewer_candidate(db, tenant_a)

        resp = client.post(
            f"/api/v1/popups/{popup_a.id}/reviewers",
            headers=_headers(admin_token_tenant_a),
            json={"user_id": str(user.id), "flow_id": str(foreign_flow.id)},
        )

        assert resp.status_code == 404

    def test_list_reviewers_with_flow_id_resolves_and_get_without_returns_popup_shared(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="router-flow-b")
        popup_user = _make_reviewer_candidate(db, tenant_a)
        flow_user = _make_reviewer_candidate(db, tenant_a)

        client.post(
            f"/api/v1/popups/{popup.id}/reviewers",
            headers=_headers(admin_token_tenant_a),
            json={"user_id": str(popup_user.id)},
        )
        client.post(
            f"/api/v1/popups/{popup.id}/reviewers",
            headers=_headers(admin_token_tenant_a),
            json={"user_id": str(flow_user.id), "flow_id": str(flow.id)},
        )

        popup_shared = client.get(
            f"/api/v1/popups/{popup.id}/reviewers",
            headers=_headers(admin_token_tenant_a),
        )
        assert popup_shared.status_code == 200
        assert [r["user_id"] for r in popup_shared.json()["results"]] == [
            str(popup_user.id)
        ]

        resolved_for_flow = client.get(
            f"/api/v1/popups/{popup.id}/reviewers",
            headers=_headers(admin_token_tenant_a),
            params={"flow_id": str(flow.id)},
        )
        assert resolved_for_flow.status_code == 200
        assert [r["user_id"] for r in resolved_for_flow.json()["results"]] == [
            str(flow_user.id)
        ], "Override mode must resolve to ONLY the flow's own reviewers"

    def test_remove_last_flow_reviewer_via_api_resets_inherit_mode(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="router-flow-c")
        user = _make_reviewer_candidate(db, tenant_a)

        client.post(
            f"/api/v1/popups/{popup.id}/reviewers",
            headers=_headers(admin_token_tenant_a),
            json={"user_id": str(user.id), "flow_id": str(flow.id)},
        )

        resp = client.delete(
            f"/api/v1/popups/{popup.id}/reviewers/{user.id}",
            headers=_headers(admin_token_tenant_a),
            params={"flow_id": str(flow.id)},
        )
        assert resp.status_code == 204

        db.expire_all()
        refreshed = db.get(SalesFlows, flow.id)
        assert refreshed.reviewers_mode == "inherit"
