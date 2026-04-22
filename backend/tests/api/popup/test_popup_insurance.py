"""Tests for popup insurance configuration: validator (unit) and auto-sync (integration).

Phase 1 — RED first:
  - validate_popup_insurance_config: enabled+null → ValueError, enabled+0 → ValueError,
    enabled+valid → pass, disabled+any → pass.

Phase 3 — Integration:
  - create popup with insurance_enabled=true → insurance_checkout.is_enabled flips true
  - update to false → flips false
  - idempotent call → no error
  - no step row → no error
"""
import uuid
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.api.popup.schemas import validate_popup_insurance_config

# ---------------------------------------------------------------------------
# Unit tests: validate_popup_insurance_config (Phase 1)
# ---------------------------------------------------------------------------


class TestValidatePopupInsuranceConfig:
    """Pure unit tests — no DB needed."""

    def test_enabled_with_null_percentage_raises(self) -> None:
        """POPUP-1: enabled=True + pct=None → ValueError."""
        with pytest.raises(ValueError, match="insurance_percentage"):
            validate_popup_insurance_config(enabled=True, pct=None)

    def test_enabled_with_zero_percentage_raises(self) -> None:
        """POPUP-1: enabled=True + pct=0 → ValueError."""
        with pytest.raises(ValueError, match="insurance_percentage"):
            validate_popup_insurance_config(enabled=True, pct=Decimal("0"))

    def test_enabled_with_valid_percentage_passes(self) -> None:
        """POPUP-1: enabled=True + pct=5.00 → no error."""
        # Should not raise — returns None
        result = validate_popup_insurance_config(enabled=True, pct=Decimal("5.00"))
        assert result is None

    def test_disabled_with_null_percentage_passes(self) -> None:
        """POPUP-1: disabled + null → no error."""
        result = validate_popup_insurance_config(enabled=False, pct=None)
        assert result is None

    def test_disabled_with_any_value_passes(self) -> None:
        """POPUP-1: disabled + any pct → no error (pct ignored when disabled)."""
        result = validate_popup_insurance_config(enabled=False, pct=Decimal("99.99"))
        assert result is None

    def test_enabled_with_percentage_over_100_raises(self) -> None:
        """POPUP-1: enabled=True + pct>100 → ValueError (percentage can't exceed 100)."""
        with pytest.raises(ValueError, match="100"):
            validate_popup_insurance_config(enabled=True, pct=Decimal("100.01"))

    def test_enabled_with_percentage_exactly_100_passes(self) -> None:
        """POPUP-1: enabled=True + pct=100 → no error (boundary inclusive)."""
        result = validate_popup_insurance_config(enabled=True, pct=Decimal("100"))
        assert result is None


# ---------------------------------------------------------------------------
# API-level tests for insurance fields on create/update (Phase 1)
# ---------------------------------------------------------------------------


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class TestPopupInsuranceApi:
    def test_create_popup_with_insurance_enabled_and_valid_pct(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """POPUP-1 Scenario: create with insurance_enabled=true, pct=5.00 → 201."""
        response = client.post(
            "/api/v1/popups",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "name": f"Insurance Popup {uuid.uuid4().hex[:8]}",
                "insurance_enabled": True,
                "insurance_percentage": "5.00",
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["insurance_enabled"] is True
        assert Decimal(data["insurance_percentage"]) == Decimal("5.00")

    def test_create_popup_with_insurance_enabled_and_null_pct_returns_422(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """POPUP-1 Scenario: enabled=true, pct=null → 422."""
        response = client.post(
            "/api/v1/popups",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "name": f"Insurance No Pct {uuid.uuid4().hex[:8]}",
                "insurance_enabled": True,
                "insurance_percentage": None,
            },
        )
        assert response.status_code == 422
        assert "insurance_percentage" in response.text

    def test_create_popup_with_insurance_enabled_and_zero_pct_returns_422(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """POPUP-1 Scenario: enabled=true, pct=0 → 422."""
        response = client.post(
            "/api/v1/popups",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "name": f"Insurance Zero Pct {uuid.uuid4().hex[:8]}",
                "insurance_enabled": True,
                "insurance_percentage": "0",
            },
        )
        assert response.status_code == 422
        assert "insurance_percentage" in response.text

    def test_create_popup_with_percentage_over_100_returns_422(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """POPUP-1 Scenario: enabled=true, pct>100 → 422."""
        response = client.post(
            "/api/v1/popups",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "name": f"Insurance Over100 {uuid.uuid4().hex[:8]}",
                "insurance_enabled": True,
                "insurance_percentage": "150",
            },
        )
        assert response.status_code == 422
        assert "100" in response.text

    def test_update_popup_to_disable_insurance(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """POPUP-1 Scenario: update existing popup to disabled → 200, flag stored."""
        # First create with insurance enabled
        create_resp = client.post(
            "/api/v1/popups",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "name": f"Insurance Disable {uuid.uuid4().hex[:8]}",
                "insurance_enabled": True,
                "insurance_percentage": "7.50",
            },
        )
        assert create_resp.status_code == 201
        popup_id = create_resp.json()["id"]

        # Update to disabled
        update_resp = client.patch(
            f"/api/v1/popups/{popup_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"insurance_enabled": False},
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["insurance_enabled"] is False


