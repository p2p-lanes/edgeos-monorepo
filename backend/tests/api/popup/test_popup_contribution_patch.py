"""Integration tests for contribution fields in PopupUpdate PATCH (TDD — RED first).

SCN-09: PopupUpdate schema accepts contribution fields without 422.
Also exercises the extra="forbid" regression guard.

Scenarios:
  - PATCH with all 4 contribution fields + enabled=true → 200
  - PATCH with contribution_enabled=true + null percentage → 422
  - PATCH with contribution_enabled=false + null percentage → 200 (disabled is ok)
  - PATCH with only contribution_label (no enabled flag) → 200 (partial update)
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_popup(client: TestClient, token: str) -> dict:
    response = client.post(
        "/api/v1/popups",
        headers=_admin_headers(token),
        json={"name": f"Contribution Test Popup {uuid.uuid4().hex[:8]}"},
    )
    assert response.status_code == 201
    return response.json()


class TestPopupContributionPatch:
    def test_patch_all_contribution_fields_enabled_returns_200(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """SCN-09: PATCH with all 4 contribution fields and enabled=true → 200."""
        popup = _create_popup(client, admin_token_tenant_a)
        popup_id = popup["id"]

        response = client.patch(
            f"/api/v1/popups/{popup_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "contribution_enabled": True,
                "contribution_percentage": "5.00",
                "contribution_label": "Climate fund",
                "contribution_description": "Supports the event sustainability",
            },
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["contribution_enabled"] is True
        assert Decimal(data["contribution_percentage"]) == Decimal("5.00")
        assert data["contribution_label"] == "Climate fund"
        assert data["contribution_description"] == "Supports the event sustainability"

    def test_patch_enabled_true_null_percentage_returns_422(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """contribution_enabled=True + null percentage → 422 (validator rejects)."""
        popup = _create_popup(client, admin_token_tenant_a)
        popup_id = popup["id"]

        response = client.patch(
            f"/api/v1/popups/{popup_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "contribution_enabled": True,
                "contribution_percentage": None,
            },
        )
        assert response.status_code == 422
        assert "contribution_percentage" in response.text

    def test_patch_enabled_false_null_percentage_returns_200(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """contribution_enabled=False with null percentage → 200 (disabled is fine)."""
        popup = _create_popup(client, admin_token_tenant_a)
        popup_id = popup["id"]

        response = client.patch(
            f"/api/v1/popups/{popup_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "contribution_enabled": False,
                "contribution_percentage": None,
            },
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["contribution_enabled"] is False

    def test_patch_contribution_label_only_returns_200(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Partial update with only contribution_label → 200 (extra=forbid guard)."""
        popup = _create_popup(client, admin_token_tenant_a)
        popup_id = popup["id"]

        response = client.patch(
            f"/api/v1/popups/{popup_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"contribution_label": "New label"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["contribution_label"] == "New label"
