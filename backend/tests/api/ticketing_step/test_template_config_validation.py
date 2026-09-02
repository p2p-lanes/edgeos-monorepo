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

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.product.models import Products


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_ticket_select_step(
    popup_id: uuid.UUID, flow_id: uuid.UUID, sections: list[dict]
) -> dict:
    return {
        "popup_id": str(popup_id),
        "sales_flow_id": str(flow_id),
        "step_type": "tickets",
        "title": f"Ticket Step {uuid.uuid4().hex[:8]}",
        "template": "ticket-select",
        "template_config": {"sections": sections},
    }


def _base_section(suffix: str = "") -> dict:
    return {
        "key": f"section-{suffix or uuid.uuid4().hex[:6]}",
        "label": f"Section {suffix}",
        "order": 0,
        "product_ids": [],
    }


def _product(db: Session, popup: Popups, category: str | None) -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"{category or 'uncategorized'} product",
        slug=f"config-product-{uuid.uuid4().hex[:8]}",
        price=10,
        category=category,
    )
    db.add(product)
    db.commit()
    return product


def _meal_config(product_id: uuid.UUID) -> dict:
    return {
        "sections": [
            {
                "key": "meals",
                "label": "Meals",
                "products": [
                    {
                        "product_id": str(product_id),
                        "coverage_start": "2026-08-24",
                        "coverage_end": "2026-08-30",
                    }
                ],
            }
        ]
    }


def _step_payload(
    popup: Popups, flow_id: uuid.UUID, template: str, config: dict
) -> dict:
    return {
        "popup_id": str(popup.id),
        "sales_flow_id": str(flow_id),
        "step_type": "products",
        "title": f"Config {uuid.uuid4().hex[:8]}",
        "template": template,
        "template_config": config,
    }


def _post_step(client, token: str, popup: Popups, flow_id, template: str, config: dict):
    return client.post(
        "/api/v1/ticketing-steps",
        headers=_admin_headers(token),
        json=_step_payload(popup, flow_id, template, config),
    )


def _patch_step(client, token: str, step_id: str, payload: dict):
    return client.patch(
        f"/api/v1/ticketing-steps/{step_id}",
        headers=_admin_headers(token),
        json=payload,
    )


@pytest.mark.parametrize("template", ["ticket-card", "ticket-select"])
def test_generic_ticket_templates_accept_every_product_category_without_inference(
    template: str,
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
    default_flow_tenant_a,
) -> None:
    products = [
        _product(db, popup_tenant_a, category)
        for category in ("ticket", "meal_plan", "merch")
    ]
    product_ids = [str(product.id) for product in products]
    config = {"sections": [{**_base_section(template), "product_ids": product_ids}]}
    response = _post_step(
        client,
        admin_token_tenant_a,
        popup_tenant_a,
        default_flow_tenant_a.id,
        template,
        config,
    )
    assert response.status_code == 201, response.text
    assert (
        response.json()["template_config"]["sections"][0]["product_ids"] == product_ids
    )
    db.expire_all()
    assert [product.category for product in products] == [
        "ticket",
        "meal_plan",
        "merch",
    ]


@pytest.mark.parametrize(
    "kind", ["meal_plan", "ticket", "merch", "null", "missing", "cross-popup"]
)
def test_meal_plan_create_validates_product_reference_non_enumeratively(
    kind: str,
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
    popup_tenant_b: Popups,
    default_flow_tenant_a,
) -> None:
    if kind == "missing":
        product_id = uuid.uuid4()
    elif kind == "cross-popup":
        product_id = _product(db, popup_tenant_b, "meal_plan").id
    else:
        product_id = _product(db, popup_tenant_a, None if kind == "null" else kind).id
    response = _post_step(
        client,
        admin_token_tenant_a,
        popup_tenant_a,
        default_flow_tenant_a.id,
        "meal-plan-select",
        _meal_config(product_id),
    )
    assert response.status_code == (201 if kind == "meal_plan" else 422), response.text
    if kind != "meal_plan":
        assert response.json()["detail"] == "One or more meal plan products are invalid"


@pytest.mark.parametrize(
    "patch_kind, category, expected_status",
    [
        ("config", "meal_plan", 200),
        ("config", "merch", 422),
        ("switch", "meal_plan", 200),
        ("switch", "ticket", 422),
    ],
)
def test_meal_plan_patch_validates_effective_template_and_config(
    patch_kind: str,
    category: str,
    expected_status: int,
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
    default_flow_tenant_a,
) -> None:
    product = _product(db, popup_tenant_a, category)
    initial_template = "meal-plan-select" if patch_kind == "config" else "ticket-card"
    initial_config = (
        {"sections": []} if patch_kind == "config" else _meal_config(product.id)
    )
    created = _post_step(
        client,
        admin_token_tenant_a,
        popup_tenant_a,
        default_flow_tenant_a.id,
        initial_template,
        initial_config,
    )
    assert created.status_code == 201, created.text
    payload = (
        {"template_config": _meal_config(product.id)}
        if patch_kind == "config"
        else {"template": "meal-plan-select"}
    )
    response = _patch_step(client, admin_token_tenant_a, created.json()["id"], payload)
    assert response.status_code == expected_status, response.text
    if expected_status == 422:
        assert response.json()["detail"] == "One or more meal plan products are invalid"


class TestTemplateConfigAttendeeCategories:
    def test_section_omits_attendee_categories_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        default_flow_tenant_a,
    ) -> None:
        """POST section without attendee_categories key → 201, GET returns null."""
        section = _base_section("no-cat")
        resp = client.post(
            "/api/v1/ticketing-steps",
            headers=_admin_headers(admin_token_tenant_a),
            json=_make_ticket_select_step(
                popup_tenant_a.id, default_flow_tenant_a.id, [section]
            ),
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
        default_flow_tenant_a,
    ) -> None:
        """POST section with valid attendee_categories (UUIDs) → 201, GET returns exact list."""
        # Fetch the main category UUID for this popup
        cats_resp = client.get(
            f"/api/v1/popups/{popup_tenant_a.id}/attendee-categories",
            headers=_admin_headers(admin_token_tenant_a),
        )
        assert cats_resp.status_code == 200, cats_resp.text
        categories = cats_resp.json().get("results", cats_resp.json())
        # popup_tenant_a may not have categories seeded (created via db.add, not API).
        # Create a non-primary category to use in the test.
        if not categories:
            create_resp = client.post(
                "/api/v1/attendee-categories",
                headers=_admin_headers(admin_token_tenant_a),
                json={
                    "popup_id": str(popup_tenant_a.id),
                    "sales_flow_id": str(default_flow_tenant_a.id),
                    "key": "vip",
                    "sort_order": 1,
                    "enabled_in_passes_flow": True,
                },
            )
            assert create_resp.status_code == 201, create_resp.text
            cat_id = create_resp.json()["id"]
        else:
            cat_id = categories[0]["id"]

        section = {**_base_section("valid"), "attendee_categories": [cat_id]}
        resp = client.post(
            "/api/v1/ticketing-steps",
            headers=_admin_headers(admin_token_tenant_a),
            json=_make_ticket_select_step(
                popup_tenant_a.id, default_flow_tenant_a.id, [section]
            ),
        )
        assert resp.status_code == 201, resp.text
        step_id = resp.json()["id"]

        get_resp = client.get(
            f"/api/v1/ticketing-steps/{step_id}",
            headers=_admin_headers(admin_token_tenant_a),
        )
        assert get_resp.status_code == 200, get_resp.text
        stored_section = get_resp.json()["template_config"]["sections"][0]
        assert stored_section["attendee_categories"] == [cat_id]

    def test_section_with_invalid_category_value(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        default_flow_tenant_a,
    ) -> None:
        """POST section with 'teen' in attendee_categories → 422 (not in backend enum)."""
        section = {**_base_section("invalid"), "attendee_categories": ["teen"]}
        resp = client.post(
            "/api/v1/ticketing-steps",
            headers=_admin_headers(admin_token_tenant_a),
            json=_make_ticket_select_step(
                popup_tenant_a.id, default_flow_tenant_a.id, [section]
            ),
        )
        assert resp.status_code == 422, resp.text

    def test_section_with_empty_attendee_categories_list(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        default_flow_tenant_a,
    ) -> None:
        """POST section with empty [] list → 201, stored and returned as []."""
        section = {**_base_section("empty"), "attendee_categories": []}
        resp = client.post(
            "/api/v1/ticketing-steps",
            headers=_admin_headers(admin_token_tenant_a),
            json=_make_ticket_select_step(
                popup_tenant_a.id, default_flow_tenant_a.id, [section]
            ),
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
        default_flow_tenant_a,
    ) -> None:
        """PATCH with template: ticket_select + invalid attendee_categories → 422."""
        # First create a valid step
        section = _base_section("patch-test")
        post_resp = client.post(
            "/api/v1/ticketing-steps",
            headers=_admin_headers(admin_token_tenant_a),
            json=_make_ticket_select_step(
                popup_tenant_a.id, default_flow_tenant_a.id, [section]
            ),
        )
        assert post_resp.status_code == 201, post_resp.text
        step_id = post_resp.json()["id"]

        # PATCH with template + invalid category value
        invalid_section = {
            **_base_section("patch-invalid"),
            "attendee_categories": ["baby"],
        }
        patch_resp = client.patch(
            f"/api/v1/ticketing-steps/{step_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "template": "ticket-select",
                "template_config": {"sections": [invalid_section]},
            },
        )
        assert patch_resp.status_code == 422, patch_resp.text

    def test_non_ticket_select_template_skips_validation(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        default_flow_tenant_a,
    ) -> None:
        """POST with non-ticket_select template + invalid attendee_categories → 201 (skipped)."""
        section = {**_base_section("other-tmpl"), "attendee_categories": ["teen"]}
        resp = client.post(
            "/api/v1/ticketing-steps",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup_tenant_a.id),
                "sales_flow_id": str(default_flow_tenant_a.id),
                "step_type": "tickets",
                "title": f"Other Template {uuid.uuid4().hex[:8]}",
                "template": "other",
                "template_config": {"sections": [section]},
            },
        )
        assert resp.status_code == 201, resp.text
