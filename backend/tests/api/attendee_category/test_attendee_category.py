"""Tests for attendee_category CRUD, RLS, and invariants.

Spec scenarios covered:
- create-category-happy-path
- duplicate-key-rejected
- key-uniqueness-is-per-popup
- viewer-can-read-categories
- viewer-cannot-write-categories
- cross-tenant-isolation
- delete-main-rejected
- edit-main-key-rejected
- edit-main-label-allowed
- main-created-on-popup-create
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _viewer_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _superadmin_headers(token: str, tenant_id: uuid.UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "X-Tenant-Id": str(tenant_id)}


# ---------------------------------------------------------------------------
# Helpers to create fresh popups inside tests
# ---------------------------------------------------------------------------


def _create_popup(client: TestClient, admin_token: str, tenant_id: uuid.UUID) -> dict:
    unique = uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/popups",
        headers=_superadmin_headers(admin_token, tenant_id)
        if False
        else _admin_headers(admin_token),
        json={"name": f"Cat Test Popup {unique}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# T1.1a — Scenario: create-category-happy-path
# ---------------------------------------------------------------------------


def test_create_category_happy_path(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """POST /attendee-categories creates a new category and returns 201."""
    unique = uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/attendee-categories",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "popup_id": str(popup_tenant_a.id),
            "key": f"sponsor_{unique}",
            "display_meta": {"label": "Sponsor"},
            "required_fields": [],
        },
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["key"] == f"sponsor_{unique}"
    assert data["popup_id"] == str(popup_tenant_a.id)
    assert data["id"] is not None


# ---------------------------------------------------------------------------
# T1.1a — Scenario: list categories
# ---------------------------------------------------------------------------


def test_list_categories_by_popup(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """GET /popups/{popup_id}/attendee-categories returns the list."""
    resp = client.get(
        f"/api/v1/popups/{popup_tenant_a.id}/attendee-categories",
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "results" in data
    assert isinstance(data["results"], list)


# ---------------------------------------------------------------------------
# T1.1a — Scenario: duplicate-key-rejected
# ---------------------------------------------------------------------------


def test_duplicate_key_per_popup_rejected(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """Creating two categories with the same key in the same popup returns 409."""
    unique = uuid.uuid4().hex[:8]
    key = f"dup_{unique}"
    resp1 = client.post(
        "/api/v1/attendee-categories",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "popup_id": str(popup_tenant_a.id),
            "key": key,
            "display_meta": {},
            "required_fields": [],
        },
    )
    assert resp1.status_code == 201, resp1.text

    resp2 = client.post(
        "/api/v1/attendee-categories",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "popup_id": str(popup_tenant_a.id),
            "key": key,
            "display_meta": {},
            "required_fields": [],
        },
    )
    assert resp2.status_code in (400, 409), resp2.text


# ---------------------------------------------------------------------------
# T1.1a — Scenario: key-uniqueness-is-per-popup (same key different popup = ok)
# ---------------------------------------------------------------------------


def test_same_key_different_popup_allowed(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
    db: Session,
    tenant_a: Tenants,
) -> None:
    """Same key on a different popup (same tenant) is allowed."""
    unique = uuid.uuid4().hex[:8]
    key = f"cross_{unique}"

    # Create a second popup for tenant_a
    popup2 = Popups(
        name=f"Second Popup {unique}",
        slug=f"second-popup-{unique}",
        tenant_id=tenant_a.id,
    )
    db.add(popup2)
    db.commit()
    db.refresh(popup2)

    resp1 = client.post(
        "/api/v1/attendee-categories",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "popup_id": str(popup_tenant_a.id),
            "key": key,
            "display_meta": {},
            "required_fields": [],
        },
    )
    assert resp1.status_code == 201, resp1.text

    resp2 = client.post(
        "/api/v1/attendee-categories",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "popup_id": str(popup2.id),
            "key": key,
            "display_meta": {},
            "required_fields": [],
        },
    )
    assert resp2.status_code == 201, resp2.text


# ---------------------------------------------------------------------------
# T1.1a — Scenario: viewer-can-read-categories
# ---------------------------------------------------------------------------


def test_viewer_can_read_categories(
    client: TestClient,
    viewer_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """VIEWER role can read categories (GET returns 200)."""
    resp = client.get(
        f"/api/v1/popups/{popup_tenant_a.id}/attendee-categories",
        headers=_viewer_headers(viewer_token_tenant_a),
    )
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# T1.1a — Scenario: viewer-cannot-write-categories
# ---------------------------------------------------------------------------


def test_viewer_cannot_create_category(
    client: TestClient,
    viewer_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """VIEWER role cannot create categories (POST returns 403)."""
    resp = client.post(
        "/api/v1/attendee-categories",
        headers=_viewer_headers(viewer_token_tenant_a),
        json={
            "popup_id": str(popup_tenant_a.id),
            "key": "should_fail",
            "display_meta": {},
            "required_fields": [],
        },
    )
    assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# T1.1a — Scenario: cross-tenant-isolation
# ---------------------------------------------------------------------------


def test_cross_tenant_isolation(
    client: TestClient,
    admin_token_tenant_b: str,
    popup_tenant_a: Popups,
) -> None:
    """Tenant B admin cannot list categories for Tenant A's popup."""
    resp = client.get(
        f"/api/v1/popups/{popup_tenant_a.id}/attendee-categories",
        headers=_admin_headers(admin_token_tenant_b),
    )
    # RLS isolates — should be 403 or empty results
    # We accept either 403/404 from the app layer OR 200 with empty list
    # because the popup itself may be inaccessible first.
    # In practice the popup FK will resolve but the category RLS will filter.
    # The critical assertion: tenant B must not see tenant A's categories.
    if resp.status_code == 200:
        # Empty list is acceptable (RLS filtered everything)
        data = resp.json()
        assert data["results"] == [], "Tenant B should not see Tenant A categories"
    else:
        assert resp.status_code in (403, 404), resp.text


# ---------------------------------------------------------------------------
# Helper: create popup via API (so main category is auto-seeded)
# ---------------------------------------------------------------------------


def _create_popup_via_api(client: TestClient, admin_token: str) -> str:
    """Create a popup via the API (triggers main category auto-seed). Returns popup_id."""
    unique = uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/popups",
        headers=_admin_headers(admin_token),
        json={"name": f"Main Cat Test {unique}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# ---------------------------------------------------------------------------
# T1.1a — Scenario: delete-main-rejected
# ---------------------------------------------------------------------------


def test_delete_main_category_rejected(
    client: TestClient,
    admin_token_tenant_a: str,
) -> None:
    """Deleting the primary (main) category returns 400."""
    popup_id = _create_popup_via_api(client, admin_token_tenant_a)

    # Get categories and find the main one
    resp = client.get(
        f"/api/v1/popups/{popup_id}/attendee-categories",
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 200, resp.text
    categories = resp.json()["results"]
    main_cats = [c for c in categories if c.get("is_primary")]
    assert len(main_cats) >= 1, "Should have a primary category"

    main_id = main_cats[0]["id"]
    del_resp = client.delete(
        f"/api/v1/attendee-categories/{main_id}",
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert del_resp.status_code in (400, 422), del_resp.text


# ---------------------------------------------------------------------------
# T1.1a — Scenario: edit-main-key-rejected
# ---------------------------------------------------------------------------


def test_edit_main_key_rejected(
    client: TestClient,
    admin_token_tenant_a: str,
) -> None:
    """PATCH on main category with key change returns 400."""
    popup_id = _create_popup_via_api(client, admin_token_tenant_a)

    resp = client.get(
        f"/api/v1/popups/{popup_id}/attendee-categories",
        headers=_admin_headers(admin_token_tenant_a),
    )
    categories = resp.json()["results"]
    main_cats = [c for c in categories if c.get("is_primary")]
    assert main_cats, "No primary category found"
    main_id = main_cats[0]["id"]

    patch_resp = client.patch(
        f"/api/v1/attendee-categories/{main_id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={"key": "participant"},
    )
    assert patch_resp.status_code in (400, 422), patch_resp.text


# ---------------------------------------------------------------------------
# T1.1a — Scenario: edit-main-label-allowed
# ---------------------------------------------------------------------------


def test_edit_main_display_meta_allowed(
    client: TestClient,
    admin_token_tenant_a: str,
) -> None:
    """PATCH on main category with display_meta update is allowed."""
    popup_id = _create_popup_via_api(client, admin_token_tenant_a)

    resp = client.get(
        f"/api/v1/popups/{popup_id}/attendee-categories",
        headers=_admin_headers(admin_token_tenant_a),
    )
    categories = resp.json()["results"]
    main_cats = [c for c in categories if c.get("is_primary")]
    assert main_cats, "No primary category found"
    main_id = main_cats[0]["id"]

    patch_resp = client.patch(
        f"/api/v1/attendee-categories/{main_id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={"display_meta": {"label": "Participant"}},
    )
    assert patch_resp.status_code == 200, patch_resp.text
    assert patch_resp.json()["display_meta"]["label"] == "Participant"


# ---------------------------------------------------------------------------
# T1.1a — Scenario: update non-primary category
# ---------------------------------------------------------------------------


def test_update_non_primary_category(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """PATCH on non-primary category updates successfully."""
    unique = uuid.uuid4().hex[:8]
    # Create a category to update
    create_resp = client.post(
        "/api/v1/attendee-categories",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "popup_id": str(popup_tenant_a.id),
            "key": f"updateable_{unique}",
            "display_meta": {"label": "Old Label"},
            "required_fields": [],
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    cat_id = create_resp.json()["id"]

    patch_resp = client.patch(
        f"/api/v1/attendee-categories/{cat_id}",
        headers=_admin_headers(admin_token_tenant_a),
        json={"display_meta": {"label": "New Label"}, "sort_order": 5},
    )
    assert patch_resp.status_code == 200, patch_resp.text
    data = patch_resp.json()
    assert data["display_meta"]["label"] == "New Label"
    assert data["sort_order"] == 5


# ---------------------------------------------------------------------------
# T1.1a — Scenario: delete non-primary category
# ---------------------------------------------------------------------------


def test_delete_non_primary_category(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    """DELETE on non-primary category returns 204."""
    unique = uuid.uuid4().hex[:8]
    create_resp = client.post(
        "/api/v1/attendee-categories",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "popup_id": str(popup_tenant_a.id),
            "key": f"deletable_{unique}",
            "display_meta": {},
            "required_fields": [],
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    cat_id = create_resp.json()["id"]

    del_resp = client.delete(
        f"/api/v1/attendee-categories/{cat_id}",
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert del_resp.status_code == 204, del_resp.text


# ---------------------------------------------------------------------------
# T1.2a — Scenario: main-created-on-popup-create
# ---------------------------------------------------------------------------


def test_main_category_created_on_popup_create(
    client: TestClient,
    admin_token_tenant_a: str,
) -> None:
    """Creating a Popup auto-creates the main category in the same transaction."""
    unique = uuid.uuid4().hex[:8]
    popup_resp = client.post(
        "/api/v1/popups",
        headers=_admin_headers(admin_token_tenant_a),
        json={"name": f"Auto Main Test {unique}"},
    )
    assert popup_resp.status_code == 201, popup_resp.text
    popup_id = popup_resp.json()["id"]

    cat_resp = client.get(
        f"/api/v1/popups/{popup_id}/attendee-categories",
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert cat_resp.status_code == 200, cat_resp.text
    categories = cat_resp.json()["results"]
    main_cats = [c for c in categories if c.get("is_primary") and c.get("key") == "main"]
    assert len(main_cats) == 1, f"Expected 1 main category, got {categories}"
