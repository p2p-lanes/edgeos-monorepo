"""Product slugs are visible and editable after creation.

Explicit slugs are admin-chosen identifiers: they are normalized, never
silently suffixed on edit, and stay stable when the product is renamed.
"""

import uuid

from fastapi.testclient import TestClient

from app.api.popup.models import Popups


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create(
    client: TestClient, token: str, popup_id: uuid.UUID, **extra: object
) -> dict:
    response = client.post(
        "/api/v1/products",
        headers=_headers(token),
        json={
            "popup_id": str(popup_id),
            "name": f"Slug Product {uuid.uuid4().hex[:8]}",
            "price": "10.00",
            "category": "merch",
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _patch(client: TestClient, token: str, product_id: str, body: dict):
    return client.patch(
        f"/api/v1/products/{product_id}", headers=_headers(token), json=body
    )


def test_create_normalizes_explicit_slug(
    client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
) -> None:
    suffix = uuid.uuid4().hex[:6]
    product = _create(
        client, admin_token_tenant_a, popup_tenant_a.id, slug=f"Size L Red {suffix}"
    )
    assert product["slug"] == f"size-l-red-{suffix}"


def test_patch_sets_normalized_slug(
    client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
) -> None:
    product = _create(client, admin_token_tenant_a, popup_tenant_a.id)
    suffix = uuid.uuid4().hex[:6]
    response = _patch(
        client, admin_token_tenant_a, product["id"], {"slug": f" Tee Blue L {suffix} "}
    )
    assert response.status_code == 200, response.text
    assert response.json()["slug"] == f"tee-blue-l-{suffix}"


def test_patch_rejects_slug_used_by_another_product(
    client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
) -> None:
    first = _create(client, admin_token_tenant_a, popup_tenant_a.id)
    second = _create(client, admin_token_tenant_a, popup_tenant_a.id)
    response = _patch(
        client, admin_token_tenant_a, second["id"], {"slug": first["slug"]}
    )
    assert response.status_code == 409, response.text
    # Not silently suffixed: the second product keeps its slug.
    unchanged = client.get(
        f"/api/v1/products/{second['id']}", headers=_headers(admin_token_tenant_a)
    )
    assert unchanged.json()["slug"] == second["slug"]


def test_patch_rejects_blank_slug(
    client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
) -> None:
    product = _create(client, admin_token_tenant_a, popup_tenant_a.id)
    response = _patch(client, admin_token_tenant_a, product["id"], {"slug": "!!!"})
    assert response.status_code == 422, response.text


def test_rename_with_current_slug_keeps_slug(
    client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
) -> None:
    product = _create(client, admin_token_tenant_a, popup_tenant_a.id)
    response = _patch(
        client,
        admin_token_tenant_a,
        product["id"],
        {"name": "Completely new name", "slug": product["slug"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["slug"] == product["slug"]


def test_list_search_matches_slug(
    client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
) -> None:
    marker = f"zz-slugsearch-{uuid.uuid4().hex[:6]}"
    product = _create(client, admin_token_tenant_a, popup_tenant_a.id, slug=marker)
    response = client.get(
        "/api/v1/products",
        headers=_headers(admin_token_tenant_a),
        params={"popup_id": str(popup_tenant_a.id), "search": marker},
    )
    assert response.status_code == 200, response.text
    assert [p["id"] for p in response.json()["results"]] == [product["id"]]


def test_patch_rejects_slug_longer_than_column(
    client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
) -> None:
    product = _create(client, admin_token_tenant_a, popup_tenant_a.id)
    response = _patch(client, admin_token_tenant_a, product["id"], {"slug": "a" * 300})
    assert response.status_code == 422, response.text


def test_create_rejects_name_longer_than_column(
    client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
) -> None:
    response = client.post(
        "/api/v1/products",
        headers=_headers(admin_token_tenant_a),
        json={
            "popup_id": str(popup_tenant_a.id),
            "name": "n" * 300,
            "price": "10.00",
            "category": "merch",
        },
    )
    assert response.status_code == 422, response.text


def test_suffixed_slug_stays_within_column(
    client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
) -> None:
    # Slugs derived from the name are still suffixed on a clash.
    long_name = f"{uuid.uuid4().hex}{'x' * 223}"
    assert len(long_name) == 255
    first = _create(client, admin_token_tenant_a, popup_tenant_a.id, name=long_name)
    second = _create(client, admin_token_tenant_a, popup_tenant_a.id, name=long_name)
    assert first["slug"] == long_name
    assert second["slug"] != long_name
    assert second["slug"].endswith("-1")
    assert len(second["slug"]) <= 255


def test_create_rejects_explicit_slug_used_by_another_product(
    client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
) -> None:
    first = _create(client, admin_token_tenant_a, popup_tenant_a.id)
    response = client.post(
        "/api/v1/products",
        headers=_headers(admin_token_tenant_a),
        json={
            "popup_id": str(popup_tenant_a.id),
            "name": f"Other Product {uuid.uuid4().hex[:8]}",
            "price": "10.00",
            "category": "merch",
            # Different casing and spacing still normalize to the same slug.
            "slug": f"  {first['slug'].upper()} ",
        },
    )
    assert response.status_code == 409, response.text
    assert first["slug"] in response.json()["detail"]


def test_create_rejects_blank_explicit_slug(
    client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
) -> None:
    response = client.post(
        "/api/v1/products",
        headers=_headers(admin_token_tenant_a),
        json={
            "popup_id": str(popup_tenant_a.id),
            "name": f"Blank Slug {uuid.uuid4().hex[:8]}",
            "price": "10.00",
            "category": "merch",
            "slug": "!!!",
        },
    )
    assert response.status_code == 422, response.text


def test_create_without_slug_suffixes_name_clash(
    client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
) -> None:
    name = f"Same Name {uuid.uuid4().hex[:8]}"
    first = _create(client, admin_token_tenant_a, popup_tenant_a.id, name=name)
    second = _create(client, admin_token_tenant_a, popup_tenant_a.id, name=name)
    assert second["slug"] == f"{first['slug']}-1"


def test_slug_of_deleted_product_can_be_reused(
    client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
) -> None:
    first = _create(client, admin_token_tenant_a, popup_tenant_a.id)
    deleted = client.delete(
        f"/api/v1/products/{first['id']}", headers=_headers(admin_token_tenant_a)
    )
    assert deleted.status_code in (200, 204), deleted.text
    second = _create(
        client, admin_token_tenant_a, popup_tenant_a.id, slug=first["slug"]
    )
    assert second["slug"] == first["slug"]
