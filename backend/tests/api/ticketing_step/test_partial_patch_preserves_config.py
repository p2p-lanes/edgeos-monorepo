"""A partial PATCH must leave the fields it never mentioned alone.

The backoffice ticketing-step page sends genuinely partial payloads: dragging a
step to reorder it sends ``{"order": n}``, renaming one on its card sends
``{"title": ...}``, and the enable toggle sends ``{"is_enabled": ...}``. None of
them carry ``template_config``, and each used to blank it — the whole section
layout, product assignments and menu configuration of the step — because
``TicketingStepUpdate``'s after-validator assigned to the attribute
unconditionally and ``BaseCRUD.update`` dumps with ``exclude_unset=True``.

See ``tests/api/shared/test_update_schema_fields_set.py`` for the schema-level
sweep that keeps this from returning in any other ``*Update`` schema.
"""

import uuid

from fastapi.testclient import TestClient

from app.api.popup.models import Popups


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _sections() -> list[dict]:
    return [
        {
            "key": "general",
            "label": "General admission",
            "order": 0,
            "product_ids": [],
            "description": "The cheap seats",
        }
    ]


def _create_step(
    client: TestClient, token: str, popup_id: uuid.UUID, flow_id: uuid.UUID
) -> tuple[str, dict]:
    resp = client.post(
        "/api/v1/ticketing-steps",
        headers=_admin_headers(token),
        json={
            "popup_id": str(popup_id),
            "sales_flow_id": str(flow_id),
            "step_type": "tickets",
            "title": f"Tickets {uuid.uuid4().hex[:8]}",
            "template": "ticket-select",
            "template_config": {"sections": _sections(), "layout": "grid"},
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["id"], body["template_config"]


def _get_step(client: TestClient, token: str, step_id: str) -> dict:
    resp = client.get(
        f"/api/v1/ticketing-steps/{step_id}", headers=_admin_headers(token)
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestPartialPatchPreservesTemplateConfig:
    def test_reorder_preserves_template_config(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        default_flow_tenant_a,
    ) -> None:
        step_id, created_config = _create_step(
            client, admin_token_tenant_a, popup_tenant_a.id, default_flow_tenant_a.id
        )

        patch = client.patch(
            f"/api/v1/ticketing-steps/{step_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"order": 3},
        )
        assert patch.status_code == 200, patch.text

        step = _get_step(client, admin_token_tenant_a, step_id)
        assert step["order"] == 3
        assert step["template_config"] == created_config

    def test_rename_preserves_template_config(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        default_flow_tenant_a,
    ) -> None:
        step_id, created_config = _create_step(
            client, admin_token_tenant_a, popup_tenant_a.id, default_flow_tenant_a.id
        )

        patch = client.patch(
            f"/api/v1/ticketing-steps/{step_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"title": "Renamed on the card"},
        )
        assert patch.status_code == 200, patch.text

        step = _get_step(client, admin_token_tenant_a, step_id)
        assert step["title"] == "Renamed on the card"
        assert step["template_config"] == created_config

    def test_enable_toggle_preserves_template_config(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        default_flow_tenant_a,
    ) -> None:
        step_id, created_config = _create_step(
            client, admin_token_tenant_a, popup_tenant_a.id, default_flow_tenant_a.id
        )

        patch = client.patch(
            f"/api/v1/ticketing-steps/{step_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"is_enabled": False},
        )
        assert patch.status_code == 200, patch.text

        step = _get_step(client, admin_token_tenant_a, step_id)
        assert step["is_enabled"] is False
        assert step["template_config"] == created_config

    def test_explicit_null_still_clears_template_config(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        default_flow_tenant_a,
    ) -> None:
        """The guard must not make the config impossible to clear on purpose."""
        step_id, _ = _create_step(
            client, admin_token_tenant_a, popup_tenant_a.id, default_flow_tenant_a.id
        )

        patch = client.patch(
            f"/api/v1/ticketing-steps/{step_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"template_config": None},
        )
        assert patch.status_code == 200, patch.text

        step = _get_step(client, admin_token_tenant_a, step_id)
        assert step["template_config"] is None

    def test_supplied_template_config_is_still_validated(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        default_flow_tenant_a,
    ) -> None:
        """A payload that does carry the config still goes through validation."""
        step_id, _ = _create_step(
            client, admin_token_tenant_a, popup_tenant_a.id, default_flow_tenant_a.id
        )

        patch = client.patch(
            f"/api/v1/ticketing-steps/{step_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "template": "ticket-select",
                "template_config": {"sections": "not-a-list"},
            },
        )
        assert patch.status_code == 422, patch.text
