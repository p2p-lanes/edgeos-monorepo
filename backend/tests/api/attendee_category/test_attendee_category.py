"""Tests for flow-owned attendee category CRUD, RLS, and invariants.

Spec scenarios covered:
- create-category-happy-path
- duplicate-key-rejected
- key-uniqueness-is-per-flow
- viewer-can-read-categories
- viewer-cannot-write-categories
- cross-tenant-isolation
- delete-main-rejected
- edit-main-key-rejected
- edit-main-label-allowed
- main-created-on-popup-create
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.attendee.models import Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.payment.models import PaymentRecipients, Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps
from tests._flow_helpers import default_flow_id


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


def _create_category(
    client: TestClient,
    admin_token: str,
    popup_id: uuid.UUID | str,
    flow_id: uuid.UUID | str,
    key: str,
    **values,
) -> dict:
    response = client.post(
        f"/api/v1/sales-flows/{flow_id}/attendee-categories",
        headers=_admin_headers(admin_token),
        json={
            "popup_id": str(popup_id),
            "key": key,
            "required_fields": [],
            "display_meta": {},
            **values,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------------
# T1.1a — Scenario: create-category-happy-path
# ---------------------------------------------------------------------------


def test_create_category_happy_path(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
    default_flow_tenant_a: SalesFlows,
) -> None:
    """POST on a sales flow creates a category owned by that flow."""
    unique = uuid.uuid4().hex[:8]
    data = _create_category(
        client,
        admin_token_tenant_a,
        popup_tenant_a.id,
        default_flow_tenant_a.id,
        f"sponsor_{unique}",
        display_meta={"label": "Sponsor"},
    )
    assert data["key"] == f"sponsor_{unique}"
    assert data["popup_id"] == str(popup_tenant_a.id)
    assert data["sales_flow_id"] == str(default_flow_tenant_a.id)
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


def test_get_category_exposes_its_popup_scope(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
    default_flow_tenant_a: SalesFlows,
) -> None:
    """GET /attendee-categories/{id} identifies both compatibility scopes."""
    created = _create_category(
        client,
        admin_token_tenant_a,
        popup_tenant_a.id,
        default_flow_tenant_a.id,
        f"scope_{uuid.uuid4().hex[:8]}",
    )

    response = client.get(
        f"/api/v1/attendee-categories/{created['id']}",
        headers=_admin_headers(admin_token_tenant_a),
    )

    assert response.status_code == 200, response.text
    assert response.json()["popup_id"] == str(popup_tenant_a.id)
    assert response.json()["sales_flow_id"] == str(default_flow_tenant_a.id)


# ---------------------------------------------------------------------------
# T1.1a — Scenario: duplicate-key-rejected
# ---------------------------------------------------------------------------


def test_duplicate_key_per_flow_rejected(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
    default_flow_tenant_a: SalesFlows,
) -> None:
    """Creating two active categories with the same flow key returns 409."""
    unique = uuid.uuid4().hex[:8]
    key = f"dup_{unique}"
    path = f"/api/v1/sales-flows/{default_flow_tenant_a.id}/attendee-categories"
    resp1 = client.post(
        path,
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
        path,
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
# Regression: the same key in two flows creates independent definitions
# ---------------------------------------------------------------------------


def test_same_key_in_two_flows_has_distinct_ids_and_configuration(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
    db: Session,
    tenant_a: Tenants,
    default_flow_tenant_a: SalesFlows,
) -> None:
    """A key is unique only inside one flow, never across a popup."""
    unique = uuid.uuid4().hex[:8]
    key = f"cross_{unique}"

    second_flow = SalesFlows(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        name=f"Second Flow {unique}",
        slug=f"second-flow-{unique}",
        type="application",
    )
    db.add(second_flow)
    db.flush()
    from app.api.attendee_category.crud import attendee_categories_crud

    attendee_categories_crud.seed_main_for_flow(db, second_flow)
    db.commit()
    db.refresh(second_flow)

    first = _create_category(
        client,
        admin_token_tenant_a,
        popup_tenant_a.id,
        default_flow_tenant_a.id,
        key,
        display_meta={"label": "First"},
    )
    second = _create_category(
        client,
        admin_token_tenant_a,
        popup_tenant_a.id,
        second_flow.id,
        key,
        display_meta={"label": "Second"},
    )

    assert first["id"] != second["id"]
    assert first["display_meta"] == {"label": "First"}
    assert second["display_meta"] == {"label": "Second"}

    updated = client.patch(
        f"/api/v1/attendee-categories/{first['id']}",
        headers=_admin_headers(admin_token_tenant_a),
        json={"display_meta": {"label": "Updated first"}},
    )
    assert updated.status_code == 200, updated.text
    second_after_edit = client.get(
        f"/api/v1/attendee-categories/{second['id']}",
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert second_after_edit.json()["display_meta"] == {"label": "Second"}

    deleted = client.delete(
        f"/api/v1/attendee-categories/{first['id']}",
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert deleted.status_code == 204, deleted.text
    assert [
        category["id"]
        for category in _flow_categories(
            client, admin_token_tenant_a, str(second_flow.id)
        )
        if category["key"] == key
    ] == [second["id"]]


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
    default_flow_tenant_a: SalesFlows,
) -> None:
    """VIEWER role cannot create categories (POST returns 403)."""
    resp = client.post(
        f"/api/v1/sales-flows/{default_flow_tenant_a.id}/attendee-categories",
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


def _flow_categories(client: TestClient, admin_token: str, flow_id: str) -> list[dict]:
    response = client.get(
        f"/api/v1/sales-flows/{flow_id}/attendee-categories",
        headers=_admin_headers(admin_token),
    )
    assert response.status_code == 200, response.text
    return response.json()["results"]


def test_fresh_flow_gets_its_own_main_and_copy_clones_active_definitions(
    client: TestClient,
    admin_token_tenant_a: str,
) -> None:
    popup_id = _create_popup_via_api(client, admin_token_tenant_a)
    flows_response = client.get(
        "/api/v1/sales-flows",
        params={"popup_id": popup_id},
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert flows_response.status_code == 200, flows_response.text
    default_flow = flows_response.json()["results"][0]

    created_category = _create_category(
        client,
        admin_token_tenant_a,
        popup_id,
        default_flow["id"],
        f"spouse_{uuid.uuid4().hex[:8]}",
        display_meta={"label": "Spouse"},
    )
    assert [
        category["is_primary"]
        for category in _flow_categories(
            client, admin_token_tenant_a, default_flow["id"]
        )
    ] == [True, False]

    fresh_flow = client.post(
        "/api/v1/sales-flows",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "popup_id": popup_id,
            "name": "Volunteers",
            "slug": "volunteers",
            "type": "application",
            "start_from": "fresh",
        },
    )
    assert fresh_flow.status_code == 201, fresh_flow.text
    fresh_categories = _flow_categories(
        client, admin_token_tenant_a, fresh_flow.json()["id"]
    )
    assert [category["key"] for category in fresh_categories] == ["main"]
    assert (
        fresh_categories[0]["id"]
        != _flow_categories(client, admin_token_tenant_a, default_flow["id"])[0]["id"]
    )

    copied_flow = client.post(
        "/api/v1/sales-flows",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "popup_id": popup_id,
            "name": "Attendee copy",
            "slug": "attendee-copy",
            "type": "application",
            "start_from": default_flow["id"],
        },
    )
    assert copied_flow.status_code == 201, copied_flow.text
    source_categories = _flow_categories(
        client, admin_token_tenant_a, default_flow["id"]
    )
    copied_categories = _flow_categories(
        client, admin_token_tenant_a, copied_flow.json()["id"]
    )
    assert [category["key"] for category in copied_categories] == [
        category["key"] for category in source_categories
    ]
    assert {category["id"] for category in copied_categories}.isdisjoint(
        category["id"] for category in source_categories
    )
    assert copied_categories[1]["display_meta"] == created_category["display_meta"]


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
    default_flow_tenant_a: SalesFlows,
) -> None:
    """PATCH on non-primary category updates successfully."""
    unique = uuid.uuid4().hex[:8]
    # Create a category to update
    created = _create_category(
        client,
        admin_token_tenant_a,
        popup_tenant_a.id,
        default_flow_tenant_a.id,
        f"updateable_{unique}",
        display_meta={"label": "Old Label"},
    )
    cat_id = created["id"]

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
    default_flow_tenant_a: SalesFlows,
    db: Session,
) -> None:
    """DELETE soft-deletes a referenced category and hides it from its flow."""
    unique = uuid.uuid4().hex[:8]
    created = _create_category(
        client,
        admin_token_tenant_a,
        popup_tenant_a.id,
        default_flow_tenant_a.id,
        f"deletable_{unique}",
    )
    cat_id = uuid.UUID(created["id"])
    attendee = Attendees(
        tenant_id=popup_tenant_a.tenant_id,
        popup_id=popup_tenant_a.id,
        category_id=cat_id,
        name="Historical companion",
    )
    product = Products(
        tenant_id=popup_tenant_a.tenant_id,
        popup_id=popup_tenant_a.id,
        name="Historical companion product",
        slug=f"historical-companion-{unique}",
        price=Decimal("10"),
        category="ticket",
        attendee_category_id=cat_id,
    )
    payment = Payments(
        tenant_id=popup_tenant_a.tenant_id,
        popup_id=popup_tenant_a.id,
        sales_flow_id=default_flow_tenant_a.id,
        amount=Decimal("10"),
    )
    db.add(payment)
    db.flush()
    recipient = PaymentRecipients(
        tenant_id=popup_tenant_a.tenant_id,
        payment_id=payment.id,
        recipient_key="historical-companion",
        name="Historical companion",
        category_id=cat_id,
    )
    step = TicketingSteps(
        tenant_id=popup_tenant_a.tenant_id,
        popup_id=popup_tenant_a.id,
        sales_flow_id=default_flow_tenant_a.id,
        step_type="tickets",
        title="Category cleanup regression",
        template="ticket-select",
        template_config={
            "sections": [{"attendee_categories": [str(cat_id)], "product_ids": []}]
        },
    )
    db.add_all([attendee, product, recipient, step])
    db.commit()

    del_resp = client.delete(
        f"/api/v1/attendee-categories/{cat_id}",
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert del_resp.status_code == 204, del_resp.text

    stored = db.get(AttendeeCategories, cat_id)
    assert stored is not None
    assert stored.deleted_at is not None
    assert db.get(Attendees, attendee.id).category_id == cat_id
    assert db.get(Products, product.id).attendee_category_id == cat_id
    assert db.get(PaymentRecipients, recipient.id).category_id == cat_id
    db.refresh(step)
    assert step.template_config["sections"][0]["attendee_categories"] == []
    assert cat_id not in {
        uuid.UUID(category["id"])
        for category in _flow_categories(
            client, admin_token_tenant_a, str(default_flow_tenant_a.id)
        )
    }

    restored = _create_category(
        client,
        admin_token_tenant_a,
        popup_tenant_a.id,
        default_flow_tenant_a.id,
        created["key"],
        display_meta={"label": "Restored"},
    )
    assert restored["id"] == str(cat_id)
    assert restored["display_meta"] == {"label": "Restored"}
    db.refresh(stored)
    assert stored.deleted_at is None


# ---------------------------------------------------------------------------
# T1.2a — Scenario: main-created-on-popup-create
# ---------------------------------------------------------------------------


def test_main_category_created_on_popup_create(
    client: TestClient,
    admin_token_tenant_a: str,
    db: Session,
) -> None:
    """Creating a popup provisions one main owned by its default flow."""
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
    main_cats = [
        c for c in categories if c.get("is_primary") and c.get("key") == "main"
    ]
    assert len(main_cats) == 1, f"Expected 1 main category, got {categories}"
    assert main_cats[0]["sales_flow_id"] == str(
        default_flow_id(db, uuid.UUID(popup_id))
    )
