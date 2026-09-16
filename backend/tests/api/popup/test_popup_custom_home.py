"""Dedicated popup-home resource contracts and tenant boundaries."""

import uuid

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.popup.schemas import (
    CUSTOM_HOME_HTML_MAX_BYTES,
    PopupCreate,
    PopupHomeUpdate,
    PopupUpdate,
)
from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token
from app.core.tenant_db import ensure_tenant_credentials


def test_home_is_not_part_of_popup_write_schemas():
    assert "custom_home_html" not in PopupCreate.model_json_schema()["properties"]
    assert "custom_home_enabled" not in PopupCreate.model_json_schema()["properties"]
    assert "custom_home_html" not in PopupUpdate.model_json_schema()["properties"]
    assert "custom_home_enabled" not in PopupUpdate.model_json_schema()["properties"]


def test_home_html_is_bounded_by_utf8_bytes():
    # One emoji is one Python code point / two JS UTF-16 units / four UTF-8 bytes.
    exact = "😀" * (CUSTOM_HOME_HTML_MAX_BYTES // 4)
    assert PopupHomeUpdate(enabled=True, html=exact, version=0).html == exact
    with pytest.raises(ValidationError):
        PopupHomeUpdate(enabled=True, html=f"{exact}😀", version=0)
    assert PopupHomeUpdate(enabled=True, html=" \n ", version=0).html is None


def test_custom_home_round_trip_opt_out_and_conflict(client: TestClient, db: Session):
    # Public lists are capped; isolate this tenant from popups accumulated by
    # other tests in the session-scoped database.
    suffix = uuid.uuid4().hex
    tenant = Tenants(name="Home tenant", slug=f"home-{suffix}")
    db.add(tenant)
    db.commit()
    ensure_tenant_credentials(db, tenant.id)
    admin = Users(
        tenant_id=tenant.id, email=f"admin-{suffix}@test.com", role=UserRole.ADMIN
    )
    db.add(admin)
    db.commit()
    admin_headers = {
        "Authorization": f"Bearer {create_access_token(subject=admin.id, token_type='user')}"
    }
    response = client.post(
        "/api/v1/popups",
        headers=admin_headers,
        json={"name": f"Home {uuid.uuid4().hex[:8]}", "status": "active"},
    )
    assert response.status_code == 201, response.text
    popup_id = response.json()["id"]
    slug = response.json()["slug"]
    assert response.json()["custom_home_enabled"] is False
    assert "custom_home_html" not in response.json()

    human = Humans(tenant_id=tenant.id, email=f"home-{suffix}@test.com")
    db.add(human)
    db.commit()
    human_headers = {
        "Authorization": f"Bearer {create_access_token(subject=human.id, token_type='human')}"
    }
    admin_url = f"/api/v1/popups/{popup_id}/home"
    portal_url = f"/api/v1/popups/portal/{slug}/home"

    response = client.get(admin_url, headers=admin_headers)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "enabled": False,
        "html": None,
        "version": 0,
        "updated_at": None,
    }
    assert client.get(portal_url, headers=human_headers).status_code == 404

    html = "<style>h1 { color: navy; }</style><h1>{{ popup.name }}</h1>"
    response = client.patch(
        admin_url,
        headers=admin_headers,
        json={"enabled": True, "html": html, "version": 0},
    )
    assert response.status_code == 200, response.text
    assert response.json()["enabled"] is True
    assert response.json()["html"] == html
    assert response.json()["version"] == 1
    assert response.json()["updated_at"] is not None

    response = client.get(portal_url, headers=human_headers)
    assert response.status_code == 200, response.text
    assert response.json()["html"] == html
    assert response.json()["version"] == 1
    assert response.headers["etag"] == '"1"'
    not_modified = client.get(
        portal_url,
        headers={**human_headers, "If-None-Match": response.headers["etag"]},
    )
    assert not_modified.status_code == 304
    assert not_modified.content == b""

    # Popup collection and detail contracts expose only the small signal.
    public = client.get(
        "/api/v1/popups/public/list", headers={"X-Tenant-Id": str(tenant.id)}
    )
    portal = client.get("/api/v1/popups/portal/list", headers=human_headers)
    portal_detail = client.get(f"/api/v1/popups/portal/{slug}", headers=human_headers)
    detail = client.get(f"/api/v1/popups/{popup_id}", headers=admin_headers)
    assert (
        public.status_code
        == portal.status_code
        == portal_detail.status_code
        == detail.status_code
        == 200
    )
    for payload in (
        *public.json(),
        *portal.json(),
        portal_detail.json(),
        detail.json(),
    ):
        assert "custom_home_html" not in payload
    selected = next(item for item in portal.json() if item["id"] == popup_id)
    assert selected["custom_home_enabled"] is True

    # Stale editors cannot overwrite the current document.
    conflict = client.patch(
        admin_url,
        headers=admin_headers,
        json={"enabled": False, "html": "stale", "version": 0},
    )
    assert conflict.status_code == 409, conflict.text
    assert "updated elsewhere" in conflict.json()["detail"]

    # Disabling retains the draft for administrators but unpublishes it.
    response = client.patch(
        admin_url,
        headers=admin_headers,
        json={"enabled": False, "html": html, "version": 1},
    )
    assert response.status_code == 200, response.text
    assert response.json()["html"] == html
    assert response.json()["version"] == 2
    assert client.get(portal_url, headers=human_headers).status_code == 404
    assert client.get(admin_url, headers=admin_headers).json()["html"] == html

    # An unrelated popup PATCH does not own or mutate home state.
    response = client.patch(
        f"/api/v1/popups/{popup_id}",
        headers=admin_headers,
        json={"location": "Patagonia"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["custom_home_enabled"] is False
    assert "custom_home_html" not in response.json()
    assert client.get(admin_url, headers=admin_headers).json()["version"] == 2


def test_custom_home_requires_operator_in_same_tenant(
    client: TestClient,
    admin_token_tenant_a: str,
    admin_token_tenant_b: str,
    viewer_token_tenant_a: str,
):
    response = client.post(
        "/api/v1/popups",
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        json={"name": f"Private Home {uuid.uuid4().hex[:8]}"},
    )
    assert response.status_code == 201, response.text
    url = f"/api/v1/popups/{response.json()['id']}/home"
    payload = {"enabled": True, "html": "<h1>Changed</h1>", "version": 0}
    for token, expected in [(admin_token_tenant_b, 404), (viewer_token_tenant_a, 403)]:
        response = client.patch(
            url, headers={"Authorization": f"Bearer {token}"}, json=payload
        )
        assert response.status_code == expected, response.text
