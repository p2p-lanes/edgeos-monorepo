import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users


def _create_payload(popup_id: uuid.UUID, **overrides: object) -> dict:
    payload = {
        "popup_id": str(popup_id),
        "slug": f"flow-{uuid.uuid4().hex[:8]}",
        "name": "Test Flow",
    }
    payload.update(overrides)
    return payload


def _create_popup(client: TestClient, admin_token: str) -> str:
    """Create a fresh popup via the API — isolates tests that mutate
    popup-scoped unique state (e.g. uq_sales_flows_default_per_popup) from
    the shared session-scoped `popup_tenant_a` fixture."""
    unique = uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/popups",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": f"Sales Flow Test Popup {unique}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


class TestSalesFlowCreate:
    @pytest.mark.parametrize(
        ("flow_type", "expected_visibility"),
        [
            ("application", "portal_listed"),
            ("direct", "direct_url_only"),
            ("upsale", "portal_listed"),
        ],
    )
    def test_omitted_visibility_uses_type_recommendation(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        flow_type: str,
        expected_visibility: str,
    ) -> None:
        response = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id, type=flow_type),
        )

        assert response.status_code == 201, response.text
        assert response.json()["visibility"] == expected_visibility

    @pytest.mark.parametrize(
        ("flow_type", "visibility"),
        [
            ("application", "direct_url_only"),
            ("direct", "portal_listed"),
            ("upsale", "direct_url_only"),
        ],
    )
    def test_explicit_visibility_overrides_type_recommendation(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        flow_type: str,
        visibility: str,
    ) -> None:
        response = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(
                popup_tenant_a.id,
                type=flow_type,
                visibility=visibility,
            ),
        )

        assert response.status_code == 201, response.text
        assert response.json()["visibility"] == visibility

    def test_create_sales_flow_success(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """A well-formed create request returns 201 with Class B columns NULL (D1)."""
        response = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id, name="Standard Flow"),
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Standard Flow"
        assert data["popup_id"] == str(popup_tenant_a.id)
        assert data["is_default"] is False
        assert data["type"] == "application"
        assert data["visibility"] == "portal_listed"
        assert data["reviewers_mode"] == "inherit"
        # Channel configuration is copied from the popup at creation
        # (slice 7): a flow owns it rather than reading through.
        assert data["application_layout"] is not None

    def test_create_sales_flow_reserved_slug_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """'thank-you' collides with the static Next.js portal route segment."""
        response = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id, slug="thank-you"),
        )
        assert response.status_code == 422

    def test_create_sales_flow_reserved_slug_success_variant(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """'success' is also reserved — second reserved value (triangulation)."""
        response = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id, slug="success"),
        )
        assert response.status_code == 422

    def test_create_sales_flow_duplicate_slug_in_popup_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """uq_sales_flows_popup_slug — same (popup, slug) pair rejected with 409."""
        slug = f"dup-{uuid.uuid4().hex[:8]}"
        first = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id, slug=slug),
        )
        assert first.status_code == 201

        second = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id, slug=slug),
        )
        assert second.status_code == 409

    def test_create_second_default_flow_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """uq_sales_flows_default_per_popup — at most one is_default=true per
        popup. Popup creation now auto-provisions a default flow (task 5.0),
        so the FIRST is_default=true attempt on a fresh popup is already the
        SECOND default flow — this is the case under test."""
        popup_id = _create_popup(client, admin_token_tenant_a)

        second = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_id, is_default=True),
        )
        assert second.status_code == 409

    def test_create_sales_flow_for_unknown_popup_404(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        response = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(uuid.uuid4()),
        )
        assert response.status_code == 404

    def test_tenant_b_cannot_create_flow_for_tenant_a_popup(
        self,
        client: TestClient,
        admin_token_tenant_b: str,
        popup_tenant_a: Popups,
    ) -> None:
        """RLS scoping: tenant B's session cannot see tenant A's popup, so 404."""
        response = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_b}"},
            json=_create_payload(popup_tenant_a.id),
        )
        assert response.status_code == 404


class TestSalesFlowUpdate:
    def test_update_sales_flow_reserved_slug_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        create = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id),
        )
        assert create.status_code == 201
        flow_id = create.json()["id"]

        response = client.patch(
            f"/api/v1/sales-flows/{flow_id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"slug": "thank-you"},
        )
        assert response.status_code == 422

    def test_update_sales_flow_name(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        create = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id, name="Old Name"),
        )
        flow_id = create.json()["id"]

        response = client.patch(
            f"/api/v1/sales-flows/{flow_id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"name": "New Name"},
        )
        assert response.status_code == 200
        assert response.json()["name"] == "New Name"


class TestSalesFlowReadDelete:
    def test_list_sales_flows_by_popup(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        created = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id, name="Listed Flow"),
        )
        flow_id = created.json()["id"]

        response = client.get(
            "/api/v1/sales-flows",
            params={"popup_id": str(popup_tenant_a.id)},
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code == 200
        ids = [f["id"] for f in response.json()["results"]]
        assert flow_id in ids

    def test_get_sales_flow_not_found(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        response = client.get(
            f"/api/v1/sales-flows/{uuid.uuid4()}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code == 404

    def test_delete_default_flow_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Popup creation now auto-provisions the default flow (task 5.0);
        fetch it via the list endpoint instead of creating a second one."""
        popup_id = _create_popup(client, admin_token_tenant_a)

        listed = client.get(
            "/api/v1/sales-flows",
            params={"popup_id": popup_id},
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert listed.status_code == 200
        default_flow = next(
            f for f in listed.json()["results"] if f["is_default"] is True
        )

        response = client.delete(
            f"/api/v1/sales-flows/{default_flow['id']}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code == 400

    def test_delete_non_default_flow_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        created = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id),
        )
        flow_id = created.json()["id"]

        response = client.delete(
            f"/api/v1/sales-flows/{flow_id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code == 204


def _make_reviewer_candidate(db: Session, tenant: Tenants) -> Users:
    user = Users(
        email=f"flow-mode-guard-{uuid.uuid4().hex[:8]}@test.com",
        role=UserRole.ADMIN,
        tenant_id=tenant.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _add_flow_reviewer(
    client: TestClient, admin_token: str, popup_id: str, flow_id: str, user_id
) -> None:
    resp = client.post(
        f"/api/v1/popups/{popup_id}/reviewers",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"user_id": str(user_id), "sales_flow_id": flow_id},
    )
    assert resp.status_code == 201, resp.text


class TestSalesFlowReviewersModeGuard:
    def test_patch_override_with_zero_flow_reviewers_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        created = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id),
        )
        flow_id = created.json()["id"]

        response = client.patch(
            f"/api/v1/sales-flows/{flow_id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"reviewers_mode": "override"},
        )
        assert response.status_code == 400

    def test_patch_inherit_with_flow_reviewers_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        created = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id),
        )
        flow_id = created.json()["id"]
        reviewer = _make_reviewer_candidate(db, tenant_a)
        _add_flow_reviewer(
            client, admin_token_tenant_a, str(popup_tenant_a.id), flow_id, reviewer.id
        )

        response = client.patch(
            f"/api/v1/sales-flows/{flow_id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"reviewers_mode": "inherit"},
        )
        assert response.status_code == 400

    def test_delete_flow_with_attached_reviewer_takes_the_assignment_with_it(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        created = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id),
        )
        """A reviewer assigned to a flow used to refuse the delete, along with
        every other row that pointed at it — the same rule that refused because
        of the checkout steps we had seeded ourselves.

        The assignment is configuration, not history: it says this person
        reviews this flow, and once the flow is gone it says nothing. The
        person is a user of the gathering and is untouched. Making an operator
        detach reviewers one at a time before deleting bought nothing.
        """
        flow_id = created.json()["id"]
        reviewer = _make_reviewer_candidate(db, tenant_a)
        _add_flow_reviewer(
            client, admin_token_tenant_a, str(popup_tenant_a.id), flow_id, reviewer.id
        )

        response = client.delete(
            f"/api/v1/sales-flows/{flow_id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code == 204, response.text
