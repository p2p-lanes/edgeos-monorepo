"""SSO configuration is JWT-only, including the app-registration surface."""

import uuid
from unittest.mock import patch

import pytest

from app.api.api_key.models import ApiKeys
from app.api.third_party_app import crud
from app.api.third_party_sso.models import PopupThirdPartyApps
from app.core.security import ADMIN_API_KEY_SCOPES

BASE = "/api/v1/third-party-apps"


@pytest.fixture
def configured_app(db, tenant_a, popup_tenant_a):
    app, _ = crud.create(
        db,
        tenant_a.id,
        name=f"sso-admin-auth-{uuid.uuid4().hex}",
        allowed_token_scopes=["portal:profile:read"],
        allowed_api_key_scopes=[],
        sso_start_url="https://partner.example/start",
        sso_redirect_uri="https://partner.example/callback",
    )
    db.add(
        PopupThirdPartyApps(
            popup_id=popup_tenant_a.id,
            app_id=app.id,
            tenant_id=tenant_a.id,
            enabled=False,
        )
    )
    db.commit()
    yield app
    db.rollback()
    db.delete(app)
    db.commit()


@pytest.fixture
def admin_key_headers(
    request, client, db, admin_token_tenant_a, superadmin_token, tenant_a, tenant_b
):
    owner, scopes = request.param
    mint_headers = {
        "Authorization": f"Bearer {admin_token_tenant_a if owner == 'admin' else superadmin_token}"
    }
    if owner != "admin":
        mint_headers["X-Tenant-Id"] = str(
            tenant_b.id if owner == "superadmin_other_tenant" else tenant_a.id
        )
    response = client.post(
        "/api/v1/backoffice/api-keys",
        headers=mint_headers,
        json={"name": f"sso-denied-{uuid.uuid4().hex}", "scopes": scopes},
    )
    assert response.status_code == 201, response.text
    key = response.json()
    headers = {"Authorization": f"Bearer {key['raw_key']}"}
    if owner != "admin":
        # A key bound to B must not gain access to A through this header.
        headers["X-Tenant-Id"] = str(tenant_a.id)
    if owner == "superadmin_no_header":
        headers.pop("X-Tenant-Id")
    elif owner == "superadmin_invalid_header":
        headers["X-Tenant-Id"] = "not-a-uuid"
    yield headers
    db.rollback()
    db.delete(db.get(ApiKeys, uuid.UUID(key["id"])))
    db.commit()


@pytest.mark.parametrize(
    "admin_key_headers",
    [
        (owner, scopes)
        for owner in (
            "admin",
            "superadmin",
            "superadmin_other_tenant",
            "superadmin_no_header",
            "superadmin_invalid_header",
        )
        for scopes in (["events:read"], sorted(ADMIN_API_KEY_SCOPES))
    ],
    indirect=True,
)
def test_api_keys_cannot_read_or_change_sso_configuration(
    client, db, configured_app, popup_tenant_a, admin_key_headers
):
    app = configured_app
    popup_apps = f"/api/v1/popups/{popup_tenant_a.id}/apps"
    requests = [
        ("GET", popup_apps, None),
        ("PUT", f"{popup_apps}/{app.id}", {"enabled": True}),
        ("PUT", f"{popup_apps}/{app.id}", {"enabled": False}),
        ("GET", f"{BASE}/available-scopes", None),
        ("GET", BASE, None),
        ("GET", f"{BASE}/{app.id}", None),
        (
            "POST",
            BASE,
            {
                "name": f"unauthorized-{uuid.uuid4().hex}",
                "sso_start_url": "https://other.example/start",
                "sso_redirect_uri": "https://other.example/callback",
            },
        ),
        (
            "PATCH",
            f"{BASE}/{app.id}",
            {
                "sso_start_url": "https://other.example/start",
                "sso_redirect_uri": "https://other.example/callback",
            },
        ),
        ("POST", f"{BASE}/{app.id}/rotate", None),
        ("DELETE", f"{BASE}/{app.id}", None),
    ]
    # Denial must precede tenant selection, not just database reads/writes.
    with patch(
        "app.core.tenant_db.tenant_connection_manager.get_credential",
        side_effect=AssertionError("API keys must be denied before tenant resolution"),
    ):
        for method, path, body in requests:
            response = client.request(
                method, path, headers=admin_key_headers, json=body
            )
            assert response.status_code == 403, (method, path, response.text)
            assert "JWT session" in response.json()["detail"]
    db.refresh(app)
    assert app.sso_start_url == "https://partner.example/start"
    assert app.sso_redirect_uri == "https://partner.example/callback"
    assert app.active is True
    assert app.revoked_at is None
    link = db.get(PopupThirdPartyApps, (popup_tenant_a.id, app.id))
    db.refresh(link)
    assert link.enabled is False


@pytest.mark.parametrize("credential", ["admin", "superadmin"])
def test_admin_jwts_can_manage_popup_sso(
    client,
    configured_app,
    popup_tenant_a,
    tenant_a,
    admin_token_tenant_a,
    superadmin_token,
    credential,
):
    token = admin_token_tenant_a if credential == "admin" else superadmin_token
    headers = {"Authorization": f"Bearer {token}", "X-Tenant-Id": str(tenant_a.id)}
    path = f"/api/v1/popups/{popup_tenant_a.id}/apps"
    assert client.get(path, headers=headers).status_code == 200
    assert client.get(f"{BASE}/{configured_app.id}", headers=headers).status_code == 200
    for enabled in (True, False):
        response = client.put(
            f"{path}/{configured_app.id}", headers=headers, json={"enabled": enabled}
        )
        assert response.status_code == 200, response.text
        assert response.json()["enabled"] is enabled


@pytest.mark.parametrize(
    "token_fixture", ["viewer_token_tenant_a", "operator_token_tenant_a"]
)
def test_non_admin_jwts_cannot_manage_sso(
    request, client, configured_app, popup_tenant_a, token_fixture
):
    headers = {"Authorization": f"Bearer {request.getfixturevalue(token_fixture)}"}
    path = f"/api/v1/popups/{popup_tenant_a.id}/apps"
    assert client.get(path, headers=headers).status_code == 403
    assert (
        client.put(
            f"{path}/{configured_app.id}", headers=headers, json={"enabled": True}
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"{BASE}/{configured_app.id}",
            headers=headers,
            json={"sso_redirect_uri": "https://other.example/callback"},
        ).status_code
        == 403
    )
