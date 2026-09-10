"""Optional custom home settings: defaults, PATCH semantics, and tenant boundaries."""

import uuid

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.popup.schemas import (
    CUSTOM_HOME_HTML_MAX_LENGTH,
    PopupCreate,
    PopupUpdate,
)
from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token
from app.core.tenant_db import ensure_tenant_credentials


def test_custom_home_defaults_and_partial_updates():
    popup = PopupCreate(name="An unchanged gathering")
    assert popup.custom_home_enabled is False
    assert popup.custom_home_html is None
    assert "custom_home_html" not in PopupUpdate(name="Renamed").model_dump(
        exclude_unset=True
    )
    assert PopupUpdate(custom_home_html=" \n ").custom_home_html is None
    assert PopupUpdate(custom_home_html=None).model_dump(exclude_unset=True) == {
        "custom_home_html": None
    }
    with pytest.raises(ValidationError):
        PopupUpdate(custom_home_enabled=None)


@pytest.mark.parametrize("schema", [PopupCreate, PopupUpdate])
def test_custom_home_html_is_bounded(schema):
    with pytest.raises(ValidationError):
        schema(name="Home", custom_home_html="x" * (CUSTOM_HOME_HTML_MAX_LENGTH + 1))


def test_custom_home_round_trip_and_opt_out(client: TestClient, db: Session):
    # Public lists are capped; isolate this tenant from the hundreds of popups
    # accumulated by other tests in the session-scoped database.
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
    headers = {
        "Authorization": f"Bearer {create_access_token(subject=admin.id, token_type='user')}"
    }
    response = client.post(
        "/api/v1/popups",
        headers=headers,
        json={"name": f"Home {uuid.uuid4().hex[:8]}", "status": "active"},
    )
    assert response.status_code == 201, response.text
    popup_id = response.json()["id"]
    slug = response.json()["slug"]
    human = Humans(tenant_id=tenant.id, email=f"home-{suffix}@test.com")
    db.add(human)
    db.commit()
    human_headers = {
        "Authorization": f"Bearer {create_access_token(subject=human.id, token_type='human')}",
        "Accept-Language": "es",
    }
    assert response.json()["custom_home_enabled"] is False
    assert response.json()["custom_home_html"] is None
    url = f"/api/v1/popups/{popup_id}"
    html = "<style>h1 { color: navy; }</style><h1>{{ popup.name }}</h1>"

    def public_home():
        response = client.get(
            "/api/v1/popups/public/list", headers={"X-Tenant-Id": str(tenant.id)}
        )
        assert response.status_code == 200, response.text
        public = next(p for p in response.json() if p["id"] == popup_id)
        # Both authenticated endpoints (including the translation overlay) must
        # carry the same published fields as the public list.
        detail = client.get(f"/api/v1/popups/portal/{slug}", headers=human_headers)
        listing = client.get("/api/v1/popups/portal/list", headers=human_headers)
        assert detail.status_code == listing.status_code == 200
        portal = next(p for p in listing.json() if p["id"] == popup_id)
        for key in ("custom_home_enabled", "custom_home_html"):
            assert detail.json()[key] == portal[key] == public[key]
        return public

    # Saving without enabling must not publish it or change any default.
    response = client.patch(url, headers=headers, json={"custom_home_html": html})
    assert response.status_code == 200, response.text
    assert response.json()["custom_home_html"] == html
    assert public_home()["custom_home_html"] is None

    response = client.patch(url, headers=headers, json={"custom_home_enabled": True})
    assert response.status_code == 200, response.text
    assert public_home()["custom_home_html"] == html
    # An unrelated edit preserves both fields.
    response = client.patch(url, headers=headers, json={"location": "Patagonia"})
    assert response.json()["custom_home_enabled"] is True
    assert response.json()["custom_home_html"] == html

    response = client.patch(url, headers=headers, json={"custom_home_enabled": False})
    assert response.status_code == 200, response.text
    assert response.json()["custom_home_html"] == html
    assert public_home()["custom_home_enabled"] is False
    assert public_home()["custom_home_html"] is None
    assert client.get(url, headers=headers).json()["custom_home_html"] == html

    response = client.patch(url, headers=headers, json={"custom_home_html": None})
    assert response.status_code == 200, response.text
    assert response.json()["custom_home_html"] is None


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
    url = f"/api/v1/popups/{response.json()['id']}"
    payload = {"custom_home_enabled": True, "custom_home_html": "<h1>Changed</h1>"}
    for token, expected in [(admin_token_tenant_b, 404), (viewer_token_tenant_a, 403)]:
        response = client.patch(
            url, headers={"Authorization": f"Bearer {token}"}, json=payload
        )
        assert response.status_code == expected, response.text
