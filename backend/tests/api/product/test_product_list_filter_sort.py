"""Tests for the backoffice products list: category filter + sorting.

The category filter and ``sort_by``/``sort_order`` already exist on the
endpoint; this locks two behaviours the backoffice UI relies on:

- ``?category=`` narrows the list to a single category.
- ``?sort_by=category`` actually orders by the ``category`` column. (The
  CRUD ``SORT_FIELDS`` allowlist previously listed a non-existent
  ``attendee_category`` field, so category sorts silently fell back to
  ``created_at``.)
"""

import uuid

from fastapi.testclient import TestClient

from app.api.popup.models import Popups


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_product(
    client: TestClient,
    token: str,
    popup_id: uuid.UUID,
    *,
    name: str,
    category: str,
) -> str:
    resp = client.post(
        "/api/v1/products",
        headers=_admin_headers(token),
        json={
            "popup_id": str(popup_id),
            "name": name,
            "price": "50.00",
            "category": category,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_category_filter_returns_only_that_category(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    suffix = uuid.uuid4().hex[:8]
    house = _create_product(
        client,
        admin_token_tenant_a,
        popup_tenant_a.id,
        name=f"House {suffix}",
        category="housing",
    )
    _create_product(
        client,
        admin_token_tenant_a,
        popup_tenant_a.id,
        name=f"Ticket {suffix}",
        category="ticket",
    )

    resp = client.get(
        "/api/v1/products",
        params={"popup_id": str(popup_tenant_a.id), "category": "housing"},
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 200, resp.text
    results = resp.json()["results"]
    assert [p["id"] for p in results] == [house]
    assert all(p["category"] == "housing" for p in results)


def test_sort_by_category_orders_by_category_column(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
) -> None:
    suffix = uuid.uuid4().hex[:8]
    # Create in non-alphabetical category order so a created_at fallback would
    # produce a different ordering than a real category sort.
    ticket = _create_product(
        client,
        admin_token_tenant_a,
        popup_tenant_a.id,
        name=f"T {suffix}",
        category="ticket",
    )
    housing = _create_product(
        client,
        admin_token_tenant_a,
        popup_tenant_a.id,
        name=f"H {suffix}",
        category="housing",
    )

    resp = client.get(
        "/api/v1/products",
        params={
            "popup_id": str(popup_tenant_a.id),
            "sort_by": "category",
            "sort_order": "asc",
        },
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 200, resp.text
    ordered = [
        (p["id"], p["category"])
        for p in resp.json()["results"]
        if p["id"] in {ticket, housing}
    ]
    # "housing" < "ticket" alphabetically → housing first under asc category sort.
    assert ordered == [(housing, "housing"), (ticket, "ticket")]
