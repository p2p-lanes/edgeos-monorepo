"""RED tests for PR2 audit tightening (REQ-6).

Covers every route in the audit table that needs to be re-gated from
CurrentUser to a more restrictive dep (CurrentAdmin, CurrentWriter,
or CurrentSuperadmin). Each class groups tests by router file.

TDD cycle: these tests FAIL until the corresponding GREEN commit
swaps the dep in the router.

Helper convention: use assert_forbidden / assert_authorized from
_role_assertions.py (established in PR1).

Roles used:
  - viewer_token_tenant_a     → VIEWER
  - check_in_controller_token_tenant_a → CHECK_IN_CONTROLLER
  - admin_token_tenant_a      → ADMIN (sanity — route still works after re-gating)
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from tests._role_assertions import assert_authorized, assert_forbidden


# ---------------------------------------------------------------------------
# application/router.py
# GET /applications         → CurrentAdmin
# GET /applications/{id}    → CurrentAdmin
# ---------------------------------------------------------------------------


class TestApplicationRoutesTightening:
    """application/router.py: both GET routes rise from CurrentUser → CurrentAdmin."""

    def test_viewer_cannot_list_applications(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on GET /applications (re-gated to CurrentAdmin)."""
        assert_forbidden(client, "GET", "/api/v1/applications", viewer_token_tenant_a)

    def test_check_in_controller_cannot_list_applications(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on GET /applications (not in CurrentAdmin allow-list)."""
        assert_forbidden(
            client, "GET", "/api/v1/applications", check_in_controller_token_tenant_a
        )

    def test_admin_can_list_applications(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN still gets 200 on GET /applications after re-gating (sanity)."""
        assert_authorized(client, "GET", "/api/v1/applications", admin_token_tenant_a)

    def test_viewer_cannot_get_application(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on GET /applications/{id} (re-gated to CurrentAdmin)."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/applications/{uuid.uuid4()}",
            viewer_token_tenant_a,
        )

    def test_check_in_controller_cannot_get_application(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on GET /applications/{id}."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/applications/{uuid.uuid4()}",
            check_in_controller_token_tenant_a,
        )

    def test_admin_can_get_application(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN gets 200 or 404 on GET /applications/{id} after re-gating (sanity)."""
        response = client.get(
            f"/api/v1/applications/{uuid.uuid4()}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        # 404 is acceptable — the UUID doesn't exist; what matters is NOT 403
        assert response.status_code != 403, (
            f"ADMIN must not get 403 on GET /applications/{{id}}, "
            f"got {response.status_code}: {response.text}"
        )


# ---------------------------------------------------------------------------
# human/router.py
# GET /humans       → CurrentAdmin
# POST /humans      → CurrentSuperadmin
# GET /humans/{id}  → CurrentAdmin
# ---------------------------------------------------------------------------


class TestHumanRoutesTightening:
    """human/router.py: GET routes → CurrentAdmin, POST → CurrentSuperadmin."""

    def test_viewer_cannot_list_humans(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on GET /humans (re-gated to CurrentAdmin)."""
        assert_forbidden(client, "GET", "/api/v1/humans", viewer_token_tenant_a)

    def test_check_in_controller_cannot_list_humans(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on GET /humans."""
        assert_forbidden(
            client, "GET", "/api/v1/humans", check_in_controller_token_tenant_a
        )

    def test_admin_can_list_humans(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN gets 200 on GET /humans after re-gating (sanity)."""
        assert_authorized(client, "GET", "/api/v1/humans", admin_token_tenant_a)

    def test_viewer_cannot_create_human(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on POST /humans (re-gated to CurrentSuperadmin)."""
        assert_forbidden(
            client,
            "POST",
            "/api/v1/humans",
            viewer_token_tenant_a,
            json={"email": f"test-{uuid.uuid4().hex[:6]}@test.com"},
        )

    def test_check_in_controller_cannot_create_human(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on POST /humans."""
        assert_forbidden(
            client,
            "POST",
            "/api/v1/humans",
            check_in_controller_token_tenant_a,
            json={"email": f"test-{uuid.uuid4().hex[:6]}@test.com"},
        )

    def test_admin_cannot_create_human(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN gets 403 on POST /humans (CurrentSuperadmin excludes ADMIN)."""
        assert_forbidden(
            client,
            "POST",
            "/api/v1/humans",
            admin_token_tenant_a,
            json={"email": f"test-{uuid.uuid4().hex[:6]}@test.com"},
        )

    def test_viewer_cannot_get_human(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on GET /humans/{id} (re-gated to CurrentAdmin)."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/humans/{uuid.uuid4()}",
            viewer_token_tenant_a,
        )

    def test_check_in_controller_cannot_get_human(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on GET /humans/{id}."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/humans/{uuid.uuid4()}",
            check_in_controller_token_tenant_a,
        )

    def test_admin_can_get_human(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN gets 200 or 404 on GET /humans/{id} after re-gating (sanity)."""
        response = client.get(
            f"/api/v1/humans/{uuid.uuid4()}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code != 403, (
            f"ADMIN must not get 403 on GET /humans/{{id}}, "
            f"got {response.status_code}: {response.text}"
        )


# ---------------------------------------------------------------------------
# dashboard/router.py
# GET /dashboard/stats     → CurrentAdmin
# GET /dashboard/enriched  → CurrentAdmin
# ---------------------------------------------------------------------------


class TestDashboardRoutesTightening:
    """dashboard/router.py: both routes rise from CurrentUser → CurrentAdmin."""

    def test_viewer_cannot_get_dashboard_stats(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on GET /dashboard/stats (re-gated to CurrentAdmin)."""
        assert_forbidden(
            client,
            "GET",
            "/api/v1/dashboard/stats?popup_id=" + str(uuid.uuid4()),
            viewer_token_tenant_a,
        )

    def test_check_in_controller_cannot_get_dashboard_stats(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on GET /dashboard/stats."""
        assert_forbidden(
            client,
            "GET",
            "/api/v1/dashboard/stats?popup_id=" + str(uuid.uuid4()),
            check_in_controller_token_tenant_a,
        )

    def test_admin_can_get_dashboard_stats(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN gets 200 on GET /dashboard/stats after re-gating (sanity)."""
        response = client.get(
            "/api/v1/dashboard/stats?popup_id=" + str(uuid.uuid4()),
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code != 403, (
            f"ADMIN must not get 403 on GET /dashboard/stats, "
            f"got {response.status_code}: {response.text}"
        )

    def test_viewer_cannot_get_dashboard_enriched(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on GET /dashboard/enriched (re-gated to CurrentAdmin)."""
        assert_forbidden(
            client,
            "GET",
            "/api/v1/dashboard/enriched?popup_id=" + str(uuid.uuid4()),
            viewer_token_tenant_a,
        )

    def test_check_in_controller_cannot_get_dashboard_enriched(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on GET /dashboard/enriched."""
        assert_forbidden(
            client,
            "GET",
            "/api/v1/dashboard/enriched?popup_id=" + str(uuid.uuid4()),
            check_in_controller_token_tenant_a,
        )

    def test_admin_can_get_dashboard_enriched(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN gets 200 on GET /dashboard/enriched after re-gating (sanity)."""
        response = client.get(
            "/api/v1/dashboard/enriched?popup_id=" + str(uuid.uuid4()),
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code != 403, (
            f"ADMIN must not get 403 on GET /dashboard/enriched, "
            f"got {response.status_code}: {response.text}"
        )


# ---------------------------------------------------------------------------
# event/router.py
# GET /events                       → CurrentAdmin
# GET /events/{id}                  → CurrentAdmin
# POST /events/check-availability   → CurrentAdmin
# GET /events/{id}/invitations      → CurrentAdmin
# POST /events/{id}/invitations     → CurrentWriter
# GET /events/{id}/ics              → CurrentAdmin
# ---------------------------------------------------------------------------


class TestEventRoutesTightening:
    """event/router.py: six routes re-gated from CurrentUser."""

    def test_viewer_cannot_list_events(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on GET /events (re-gated to CurrentAdmin)."""
        assert_forbidden(client, "GET", "/api/v1/events", viewer_token_tenant_a)

    def test_check_in_controller_cannot_list_events(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on GET /events."""
        assert_forbidden(
            client, "GET", "/api/v1/events", check_in_controller_token_tenant_a
        )

    def test_admin_can_list_events(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN gets 200 on GET /events after re-gating (sanity)."""
        assert_authorized(client, "GET", "/api/v1/events", admin_token_tenant_a)

    def test_viewer_cannot_get_event(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on GET /events/{id} (re-gated to CurrentAdmin)."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/events/{uuid.uuid4()}",
            viewer_token_tenant_a,
        )

    def test_check_in_controller_cannot_get_event(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on GET /events/{id}."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/events/{uuid.uuid4()}",
            check_in_controller_token_tenant_a,
        )

    def test_admin_can_get_event(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN gets 200 or 404 on GET /events/{id} (sanity)."""
        response = client.get(
            f"/api/v1/events/{uuid.uuid4()}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code != 403, (
            f"ADMIN must not get 403 on GET /events/{{id}}, "
            f"got {response.status_code}: {response.text}"
        )

    def test_viewer_cannot_check_availability(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on POST /events/check-availability (re-gated to CurrentAdmin)."""
        assert_forbidden(
            client,
            "POST",
            "/api/v1/events/check-availability",
            viewer_token_tenant_a,
            json={
                "venue_id": str(uuid.uuid4()),
                "start_at": "2025-01-01T10:00:00Z",
                "end_at": "2025-01-01T12:00:00Z",
            },
        )

    def test_check_in_controller_cannot_check_availability(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on POST /events/check-availability."""
        assert_forbidden(
            client,
            "POST",
            "/api/v1/events/check-availability",
            check_in_controller_token_tenant_a,
            json={
                "venue_id": str(uuid.uuid4()),
                "start_at": "2025-01-01T10:00:00Z",
                "end_at": "2025-01-01T12:00:00Z",
            },
        )

    def test_viewer_cannot_list_invitations(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on GET /events/{id}/invitations (re-gated to CurrentAdmin)."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/events/{uuid.uuid4()}/invitations",
            viewer_token_tenant_a,
        )

    def test_check_in_controller_cannot_list_invitations(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on GET /events/{id}/invitations."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/events/{uuid.uuid4()}/invitations",
            check_in_controller_token_tenant_a,
        )

    def test_admin_can_list_invitations(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN gets 200 or 404 on GET /events/{id}/invitations (sanity)."""
        response = client.get(
            f"/api/v1/events/{uuid.uuid4()}/invitations",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code != 403, (
            f"ADMIN must not get 403 on GET /events/{{id}}/invitations, "
            f"got {response.status_code}: {response.text}"
        )

    def test_viewer_cannot_bulk_invite(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on POST /events/{id}/invitations (re-gated to CurrentWriter)."""
        assert_forbidden(
            client,
            "POST",
            f"/api/v1/events/{uuid.uuid4()}/invitations",
            viewer_token_tenant_a,
            json={"emails": ["test@test.com"]},
        )

    def test_check_in_controller_cannot_bulk_invite(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on POST /events/{id}/invitations (not in CurrentWriter)."""
        assert_forbidden(
            client,
            "POST",
            f"/api/v1/events/{uuid.uuid4()}/invitations",
            check_in_controller_token_tenant_a,
            json={"emails": ["test@test.com"]},
        )

    def test_viewer_cannot_export_ics(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on GET /events/{id}/ics (re-gated to CurrentAdmin)."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/events/{uuid.uuid4()}/ics",
            viewer_token_tenant_a,
        )

    def test_check_in_controller_cannot_export_ics(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on GET /events/{id}/ics."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/events/{uuid.uuid4()}/ics",
            check_in_controller_token_tenant_a,
        )

    def test_admin_can_export_ics(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN gets 200 or 404 on GET /events/{id}/ics (sanity)."""
        response = client.get(
            f"/api/v1/events/{uuid.uuid4()}/ics",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code != 403, (
            f"ADMIN must not get 403 on GET /events/{{id}}/ics, "
            f"got {response.status_code}: {response.text}"
        )


# ---------------------------------------------------------------------------
# application_review/router.py
# GET /applications/{id}/reviews         → CurrentAdmin
# GET /applications/{id}/reviews/summary → CurrentAdmin
# ---------------------------------------------------------------------------


class TestApplicationReviewRoutesTightening:
    """application_review/router.py: both GET routes rise to CurrentAdmin."""

    def test_viewer_cannot_list_reviews(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on GET /applications/{id}/reviews (re-gated to CurrentAdmin)."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/applications/{uuid.uuid4()}/reviews",
            viewer_token_tenant_a,
        )

    def test_check_in_controller_cannot_list_reviews(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on GET /applications/{id}/reviews."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/applications/{uuid.uuid4()}/reviews",
            check_in_controller_token_tenant_a,
        )

    def test_admin_can_list_reviews(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN gets 200 or 404 on GET /applications/{id}/reviews (sanity)."""
        response = client.get(
            f"/api/v1/applications/{uuid.uuid4()}/reviews",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code != 403, (
            f"ADMIN must not get 403 on GET /applications/{{id}}/reviews, "
            f"got {response.status_code}: {response.text}"
        )

    def test_viewer_cannot_get_review_summary(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on GET /applications/{id}/reviews/summary (re-gated to CurrentAdmin)."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/applications/{uuid.uuid4()}/reviews/summary",
            viewer_token_tenant_a,
        )

    def test_check_in_controller_cannot_get_review_summary(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on GET /applications/{id}/reviews/summary."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/applications/{uuid.uuid4()}/reviews/summary",
            check_in_controller_token_tenant_a,
        )

    def test_admin_can_get_review_summary(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN gets 200 or 404 on GET /applications/{id}/reviews/summary (sanity)."""
        response = client.get(
            f"/api/v1/applications/{uuid.uuid4()}/reviews/summary",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code != 403, (
            f"ADMIN must not get 403 on GET /applications/{{id}}/reviews/summary, "
            f"got {response.status_code}: {response.text}"
        )


# ---------------------------------------------------------------------------
# popup_reviewer/router.py
# GET /popups/{id}/reviewers → CurrentAdmin
# ---------------------------------------------------------------------------


class TestPopupReviewerRoutesTightening:
    """popup_reviewer/router.py: GET /popups/{id}/reviewers rises to CurrentAdmin."""

    def test_viewer_cannot_list_popup_reviewers(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """VIEWER gets 403 on GET /popups/{id}/reviewers (re-gated to CurrentAdmin)."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/popups/{uuid.uuid4()}/reviewers",
            viewer_token_tenant_a,
        )

    def test_check_in_controller_cannot_list_popup_reviewers(
        self,
        client: TestClient,
        check_in_controller_token_tenant_a: str,
    ) -> None:
        """CHECK_IN_CONTROLLER gets 403 on GET /popups/{id}/reviewers."""
        assert_forbidden(
            client,
            "GET",
            f"/api/v1/popups/{uuid.uuid4()}/reviewers",
            check_in_controller_token_tenant_a,
        )

    def test_admin_can_list_popup_reviewers(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """ADMIN gets 200 or 404 on GET /popups/{id}/reviewers (sanity)."""
        response = client.get(
            f"/api/v1/popups/{uuid.uuid4()}/reviewers",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code != 403, (
            f"ADMIN must not get 403 on GET /popups/{{id}}/reviewers, "
            f"got {response.status_code}: {response.text}"
        )
