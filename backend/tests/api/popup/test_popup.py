"""Tests for popup create/update 409 error path — Phase 5 (T-5.1).

TDD: RED → GREEN.

Scenarios:
1. test_create_popup_409_on_same_tenant_slug_conflict — same-tenant duplicate slug → 409
2. test_create_popup_201_on_cross_tenant_slug — cross-tenant same slug → 201
3. test_create_popup_race_condition_returns_409_not_500 — IntegrityError injected → 409
4. test_update_popup_409_on_same_tenant_slug_conflict — update to existing same-tenant slug → 409
5. test_update_popup_race_condition_returns_409_not_500 — IntegrityError on update → 409
"""

import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api.shared.enums import SaleType


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_popup_payload(name: str) -> dict:
    """PopupCreate always generates slug from name via slugify(name). Pass a unique name."""
    return {
        "name": name,
        "sale_type": SaleType.direct.value,
    }


# ---------------------------------------------------------------------------
# Phase 5 — Popup 409 tests (T-5.1)
# ---------------------------------------------------------------------------


def test_create_popup_409_on_same_tenant_slug_conflict(
    client: TestClient,
    admin_token_tenant_a: str,
) -> None:
    """Create popup with same name (→ same slug) in same tenant twice → 409."""
    # slugify("Summer Slug Test A") → "summer-slug-test-a" (unique enough for test)
    unique_suffix = uuid.uuid4().hex[:6]
    name = f"Slug Conflict {unique_suffix}"

    response1 = client.post(
        "/api/v1/popups",
        headers=_admin_headers(admin_token_tenant_a),
        json=_create_popup_payload(name),
    )
    assert response1.status_code == 201, response1.text

    response2 = client.post(
        "/api/v1/popups",
        headers=_admin_headers(admin_token_tenant_a),
        json=_create_popup_payload(name),
    )

    assert response2.status_code == 409, response2.text
    body = response2.json()
    assert "slug" in body["detail"].lower()


def test_create_popup_201_on_cross_tenant_slug(
    client: TestClient,
    admin_token_tenant_a: str,
    admin_token_tenant_b: str,
) -> None:
    """Tenant A and tenant B both create popup with same name (→ same slug) → both 201."""
    unique_suffix = uuid.uuid4().hex[:6]
    shared_name = f"Cross Tenant Popup {unique_suffix}"

    response_a = client.post(
        "/api/v1/popups",
        headers=_admin_headers(admin_token_tenant_a),
        json=_create_popup_payload(shared_name),
    )
    assert response_a.status_code == 201, response_a.text

    response_b = client.post(
        "/api/v1/popups",
        headers=_admin_headers(admin_token_tenant_b),
        json=_create_popup_payload(shared_name),
    )
    assert response_b.status_code == 201, response_b.text


def test_create_popup_race_condition_returns_409_not_500(
    client: TestClient,
    admin_token_tenant_a: str,
) -> None:
    """IntegrityError from crud.create is translated to 409, not 500."""
    from sqlalchemy.exc import IntegrityError

    from app.api.popup import crud as popup_crud

    unique_suffix = uuid.uuid4().hex[:6]
    integrity_error = IntegrityError(
        statement="INSERT INTO popups",
        params={},
        orig=Exception('duplicate key value violates unique constraint "uq_popups_tenant_slug"'),
    )

    with patch.object(popup_crud, "create", side_effect=integrity_error):
        response = client.post(
            "/api/v1/popups",
            headers=_admin_headers(admin_token_tenant_a),
            json=_create_popup_payload(f"Race Condition Popup {unique_suffix}"),
        )

    assert response.status_code == 409, response.text
    body = response.json()
    assert "slug" in body["detail"].lower()


def test_update_popup_409_on_same_tenant_slug_conflict(
    client: TestClient,
    admin_token_tenant_a: str,
) -> None:
    """Update popup slug to the slug of another existing popup in same tenant → 409."""
    unique_suffix = uuid.uuid4().hex[:6]

    # Create popup A — slug will be "existing-popup-<suffix>"
    response1 = client.post(
        "/api/v1/popups",
        headers=_admin_headers(admin_token_tenant_a),
        json=_create_popup_payload(f"Existing Popup {unique_suffix}"),
    )
    assert response1.status_code == 201, response1.text
    slug_a = response1.json()["slug"]  # the actual generated slug

    # Create popup B — slug will be different
    response2 = client.post(
        "/api/v1/popups",
        headers=_admin_headers(admin_token_tenant_a),
        json=_create_popup_payload(f"Target Popup {unique_suffix}"),
    )
    assert response2.status_code == 201, response2.text
    popup_b_id = response2.json()["id"]

    # Try to PATCH popup B's slug to popup A's slug → should 409
    response3 = client.patch(
        f"/api/v1/popups/{popup_b_id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={"slug": slug_a},
    )

    assert response3.status_code == 409, response3.text
    body = response3.json()
    assert "slug" in body["detail"].lower()


def test_update_popup_race_condition_returns_409_not_500(
    client: TestClient,
    admin_token_tenant_a: str,
) -> None:
    """IntegrityError from crud.update is translated to 409, not 500."""
    from sqlalchemy.exc import IntegrityError

    from app.api.popup import crud as popup_crud

    unique_suffix = uuid.uuid4().hex[:6]

    response1 = client.post(
        "/api/v1/popups",
        headers=_admin_headers(admin_token_tenant_a),
        json=_create_popup_payload(f"Update Race Popup {unique_suffix}"),
    )
    assert response1.status_code == 201, response1.text
    popup_id = response1.json()["id"]

    integrity_error = IntegrityError(
        statement="UPDATE popups",
        params={},
        orig=Exception('duplicate key value violates unique constraint "uq_popups_tenant_slug"'),
    )

    with patch.object(popup_crud, "update", side_effect=integrity_error):
        response2 = client.patch(
            f"/api/v1/popups/{popup_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"slug": f"new-race-slug-{unique_suffix}"},
        )

    assert response2.status_code == 409, response2.text
    body = response2.json()
    assert "slug" in body["detail"].lower()
