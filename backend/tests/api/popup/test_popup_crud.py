"""Integration tests for Popup CRUD after tier schema removal (spec: migration-backfill).

Scenarios:
1. PATCH popup with tier_progression_enabled: true → 422 (extra field rejected).
   (T1.7b / Spec: migration-backfill, Scenario 3 — schema rejects deprecated tier fields)
"""

from fastapi.testclient import TestClient

from app.api.popup.models import Popups


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# T1.7b — tier_progression_enabled rejected with 422 on PATCH popup
# ---------------------------------------------------------------------------


def test_patch_popup_with_tier_progression_enabled_returns_422(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """PATCH popup with tier_progression_enabled: true → 422 extra-field rejection.

    After removing tier_progression_enabled from PopupUpdate, Pydantic rejects
    extra fields because the schema no longer declares it.
    """
    resp = client.patch(
        f"/api/v1/popups/{popup_tenant_a.id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={"tier_progression_enabled": True},
    )
    # Pydantic v2 extra-field rejection returns 422 Unprocessable Entity.
    assert resp.status_code == 422, resp.text
