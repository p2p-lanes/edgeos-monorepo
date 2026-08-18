"""Tests for read access to event settings.

The GET ``/event-settings/{popup_id}`` endpoint is read-only and the backoffice
UI already exposes a read-only settings view to non-admin users (VIEWER /
OPERATOR). It must therefore be readable by any authenticated tenant user, while
writes (PUT/PATCH) stay admin-only.

Regression: before the fix this GET required write permission, so VIEWER/OPERATOR
got a 403. The frontend ``useEventTimezone`` hook swallowed the 403 and fell back
to "UTC", making the events calendar show UTC for non-admin users even when the
popup timezone was configured (e.g. America/Los_Angeles).
"""

from fastapi.testclient import TestClient

from app.api.popup.models import Popups

TIMEZONE = "America/Los_Angeles"


def _set_settings_as_admin(
    client: TestClient,
    popup: Popups,
    admin_token: str,
) -> None:
    """Upsert event settings for the popup as ADMIN via the API."""
    response = client.put(
        f"/api/v1/event-settings/{popup.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"popup_id": str(popup.id), "timezone": TIMEZONE},
    )
    assert response.status_code == 200, response.text
    assert response.json()["timezone"] == TIMEZONE


def test_viewer_can_get_event_settings(
    client: TestClient,
    popup_tenant_a: Popups,
    admin_token_tenant_a: str,
    viewer_token_tenant_a: str,
) -> None:
    """VIEWER can read event settings (200) and sees the configured timezone."""
    _set_settings_as_admin(client, popup_tenant_a, admin_token_tenant_a)

    response = client.get(
        f"/api/v1/event-settings/{popup_tenant_a.id}",
        headers={"Authorization": f"Bearer {viewer_token_tenant_a}"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["timezone"] == TIMEZONE


def test_viewer_cannot_upsert_event_settings(
    client: TestClient,
    popup_tenant_a: Popups,
    viewer_token_tenant_a: str,
) -> None:
    """Writes stay admin-only: VIEWER gets 403 on PUT."""
    response = client.put(
        f"/api/v1/event-settings/{popup_tenant_a.id}",
        headers={"Authorization": f"Bearer {viewer_token_tenant_a}"},
        json={"popup_id": str(popup_tenant_a.id), "timezone": TIMEZONE},
    )
    assert response.status_code == 403, response.text


def test_viewer_cannot_patch_event_settings(
    client: TestClient,
    popup_tenant_a: Popups,
    viewer_token_tenant_a: str,
) -> None:
    """Writes stay admin-only: VIEWER gets 403 on PATCH."""
    response = client.patch(
        f"/api/v1/event-settings/{popup_tenant_a.id}",
        headers={"Authorization": f"Bearer {viewer_token_tenant_a}"},
        json={"timezone": TIMEZONE},
    )
    assert response.status_code == 403, response.text


def test_upsert_rejects_unknown_timezone(
    client: TestClient,
    popup_tenant_a: Popups,
    admin_token_tenant_a: str,
) -> None:
    """A zone this server cannot resolve is a 422, not a silent UTC.

    Readers degrade an unrecognised zone to UTC without complaining, so an
    invalid value stored here would quietly shift every event time.
    """
    response = client.put(
        f"/api/v1/event-settings/{popup_tenant_a.id}",
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        json={"popup_id": str(popup_tenant_a.id), "timezone": "Not/AZone"},
    )
    assert response.status_code == 422, response.text


def test_patch_rejects_unknown_timezone(
    client: TestClient,
    popup_tenant_a: Popups,
    admin_token_tenant_a: str,
) -> None:
    """Same guard on the partial-update path."""
    _set_settings_as_admin(client, popup_tenant_a, admin_token_tenant_a)

    response = client.patch(
        f"/api/v1/event-settings/{popup_tenant_a.id}",
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        json={"timezone": "Not/AZone"},
    )
    assert response.status_code == 422, response.text


def test_upsert_accepts_a_zone_outside_the_old_hardcoded_list(
    client: TestClient,
    popup_tenant_a: Popups,
    admin_token_tenant_a: str,
) -> None:
    """The picker now offers every IANA zone; the API has to take them."""
    for zone in ("Europe/Madrid", "Asia/Kolkata", "Africa/Nairobi"):
        response = client.put(
            f"/api/v1/event-settings/{popup_tenant_a.id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"popup_id": str(popup_tenant_a.id), "timezone": zone},
        )
        assert response.status_code == 200, response.text
        assert response.json()["timezone"] == zone
