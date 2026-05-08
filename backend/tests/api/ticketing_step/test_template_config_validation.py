"""Integration tests for TicketSelectSection attendee_categories validation.

Verifies:
1. Section without attendee_categories key → 201, stored with null.
2. Section with valid attendee_categories list → 201, round-trips unchanged.
3. Section with invalid category value (teen) → 422.
4. Section with empty attendee_categories list → 201, stored as [].
5. PATCH with template + invalid attendee_categories → 422.
6. Non-ticket_select template skips validation → 201 even with invalid values.
"""

import uuid

from fastapi.testclient import TestClient

from app.api.popup.models import Popups


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_ticket_select_step(popup_id: uuid.UUID, sections: list[dict]) -> dict:
    return {
        "popup_id": str(popup_id),
        "step_type": "tickets",
        "title": f"Ticket Step {uuid.uuid4().hex[:8]}",
        "template": "ticket_select",
        "template_config": {"sections": sections},
    }


def _base_section(suffix: str = "") -> dict:
    return {
        "key": f"section-{suffix or uuid.uuid4().hex[:6]}",
        "label": f"Section {suffix}",
        "order": 0,
        "product_ids": [],
    }


class TestTemplateConfigAttendeeCategories:
    def test_section_omits_attendee_categories_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """POST section without attendee_categories key → 201, GET returns null."""
        section = _base_section("no-cat")
        resp = client.post(
            "/api/v1/ticketing-steps",
            headers=_admin_headers(admin_token_tenant_a),
            json=_make_ticket_select_step(popup_tenant_a.id, [section]),
        )
        assert resp.status_code == 201, resp.text
        step_id = resp.json()["id"]

        get_resp = client.get(
            f"/api/v1/ticketing-steps/{step_id}",
            headers=_admin_headers(admin_token_tenant_a),
        )
        assert get_resp.status_code == 200, get_resp.text
        stored_section = get_resp.json()["template_config"]["sections"][0]
        assert stored_section["attendee_categories"] is None

    def test_section_with_valid_attendee_categories(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """POST section with valid attendee_categories → 201, GET returns exact list."""
        section = {**_base_section("valid"), "attendee_categories": ["main", "spouse"]}
        resp = client.post(
            "/api/v1/ticketing-steps",
            headers=_admin_headers(admin_token_tenant_a),
            json=_make_ticket_select_step(popup_tenant_a.id, [section]),
        )
        assert resp.status_code == 201, resp.text
        step_id = resp.json()["id"]

        get_resp = client.get(
            f"/api/v1/ticketing-steps/{step_id}",
            headers=_admin_headers(admin_token_tenant_a),
        )
        assert get_resp.status_code == 200, get_resp.text
        stored_section = get_resp.json()["template_config"]["sections"][0]
        assert stored_section["attendee_categories"] == ["main", "spouse"]

    def test_section_with_invalid_category_value(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """POST section with 'teen' in attendee_categories → 422 (not in backend enum)."""
        section = {**_base_section("invalid"), "attendee_categories": ["teen"]}
        resp = client.post(
            "/api/v1/ticketing-steps",
            headers=_admin_headers(admin_token_tenant_a),
            json=_make_ticket_select_step(popup_tenant_a.id, [section]),
        )
        assert resp.status_code == 422, resp.text

    def test_section_with_empty_attendee_categories_list(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """POST section with empty [] list → 201, stored and returned as []."""
        section = {**_base_section("empty"), "attendee_categories": []}
        resp = client.post(
            "/api/v1/ticketing-steps",
            headers=_admin_headers(admin_token_tenant_a),
            json=_make_ticket_select_step(popup_tenant_a.id, [section]),
        )
        assert resp.status_code == 201, resp.text
        step_id = resp.json()["id"]

        get_resp = client.get(
            f"/api/v1/ticketing-steps/{step_id}",
            headers=_admin_headers(admin_token_tenant_a),
        )
        assert get_resp.status_code == 200, get_resp.text
        stored_section = get_resp.json()["template_config"]["sections"][0]
        assert stored_section["attendee_categories"] == []

    def test_section_attendee_categories_on_patch(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """PATCH with template: ticket_select + invalid attendee_categories → 422."""
        # First create a valid step
        section = _base_section("patch-test")
        post_resp = client.post(
            "/api/v1/ticketing-steps",
            headers=_admin_headers(admin_token_tenant_a),
            json=_make_ticket_select_step(popup_tenant_a.id, [section]),
        )
        assert post_resp.status_code == 201, post_resp.text
        step_id = post_resp.json()["id"]

        # PATCH with template + invalid category value
        invalid_section = {**_base_section("patch-invalid"), "attendee_categories": ["baby"]}
        patch_resp = client.patch(
            f"/api/v1/ticketing-steps/{step_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "template": "ticket_select",
                "template_config": {"sections": [invalid_section]},
            },
        )
        assert patch_resp.status_code == 422, patch_resp.text

    def test_non_ticket_select_template_skips_validation(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """POST with non-ticket_select template + invalid attendee_categories → 201 (skipped)."""
        section = {**_base_section("other-tmpl"), "attendee_categories": ["teen"]}
        resp = client.post(
            "/api/v1/ticketing-steps",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup_tenant_a.id),
                "step_type": "tickets",
                "title": f"Other Template {uuid.uuid4().hex[:8]}",
                "template": "other",
                "template_config": {"sections": [section]},
            },
        )
        assert resp.status_code == 201, resp.text
