"""Tests for the optional short_label on custom form fields."""

import uuid

from fastapi.testclient import TestClient

from app.api.popup.models import Popups


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_field(
    client: TestClient,
    token: str,
    popup_id: str,
    *,
    short_label: str | None = None,
) -> dict:
    payload: dict = {
        "popup_id": popup_id,
        "label": f"Long question label {uuid.uuid4().hex[:6]}",
        "field_type": "text",
    }
    if short_label is not None:
        payload["short_label"] = short_label

    resp = client.post(
        "/api/v1/form-fields",
        headers=_admin_headers(token),
        json=payload,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _get_schema_entry(
    client: TestClient, token: str, popup_id: str, field_name: str
) -> dict:
    resp = client.get(
        f"/api/v1/form-fields/schema/{popup_id}",
        headers=_admin_headers(token),
    )
    assert resp.status_code == 200, resp.text
    schema = resp.json()
    assert field_name in schema["custom_fields"], schema["custom_fields"].keys()
    return schema["custom_fields"][field_name]


class TestShortLabel:
    def test_create_with_short_label_persists_and_appears_in_schema(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        data = _create_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            short_label="Builder",
        )
        assert data["short_label"] == "Builder"

        entry = _get_schema_entry(
            client, admin_token_tenant_a, str(popup_tenant_a.id), data["name"]
        )
        assert entry["short_label"] == "Builder"

    def test_update_sets_short_label(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        data = _create_field(client, admin_token_tenant_a, str(popup_tenant_a.id))
        assert data["short_label"] is None

        resp = client.patch(
            f"/api/v1/form-fields/{data['id']}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"short_label": "Column"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["short_label"] == "Column"

    def test_update_explicit_null_clears_short_label(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        data = _create_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            short_label="Column",
        )

        resp = client.patch(
            f"/api/v1/form-fields/{data['id']}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"short_label": None},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["short_label"] is None

    def test_update_without_key_leaves_short_label_untouched(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        data = _create_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            short_label="Column",
        )

        resp = client.patch(
            f"/api/v1/form-fields/{data['id']}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"required": True},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["short_label"] == "Column"

    def test_schema_omits_short_label_when_unset(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        data = _create_field(client, admin_token_tenant_a, str(popup_tenant_a.id))

        entry = _get_schema_entry(
            client, admin_token_tenant_a, str(popup_tenant_a.id), data["name"]
        )
        assert "short_label" not in entry
