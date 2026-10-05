"""Scanner popup projections and JWT-only administrative configuration."""

import uuid
from datetime import UTC, datetime

import pytest

from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupCheckInPublic
from app.core.security import ADMIN_API_KEY_SCOPES, create_access_token

SCANNER_FIELDS = {
    "id",
    "name",
    "tagline",
    "location",
    "slug",
    "status",
    "start_date",
    "end_date",
    "image_url",
    "self_check_in_enabled",
}


@pytest.fixture
def configured_popup(db, tenant_a):
    popup = Popups(
        tenant_id=tenant_a.id,
        name="Private payment configuration",
        tagline="Scanner-visible headline",
        location="Mock event venue",
        slug=f"scanner-privacy-{uuid.uuid4().hex}",
        start_date=datetime(2030, 1, 1, tzinfo=UTC),
        image_url="https://example.com/gathering.png",
        self_check_in_enabled=True,
        simplefi_api_key="dummy-simplefi-secret",
        open_checkout_signing_secret="dummy-checkout-secret",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize(
    "role",
    ["check_in_controller_token_tenant_a", "viewer_token_tenant_a"],
)
def test_non_administrative_users_cannot_read_admin_popup_configuration(
    client, configured_popup, request, role
):
    auth = headers(request.getfixturevalue(role))
    for path in ["/api/v1/popups", f"/api/v1/popups/{configured_popup.id}"]:
        response = client.get(path, headers=auth)
        assert response.status_code == 403, response.text


@pytest.mark.parametrize(
    "role",
    [
        "check_in_controller_token_tenant_a",
        "admin_token_tenant_a",
        "operator_token_tenant_a",
    ],
)
def test_operational_popup_list_and_detail_are_allowlisted(
    client, db, configured_popup, request, role
):
    auth = headers(request.getfixturevalue(role))
    response = client.get(
        "/api/v1/popups/check-in/list",
        headers=auth,
        params={"search": configured_popup.name},
    )
    assert response.status_code == 200, response.text
    row = next(
        r for r in response.json()["results"] if r["id"] == str(configured_popup.id)
    )
    assert set(row) == SCANNER_FIELDS
    response = client.get(
        f"/api/v1/popups/check-in/{configured_popup.id}", headers=auth
    )
    assert response.status_code == 200, response.text
    assert response.json() == row
    assert row["self_check_in_enabled"] is True
    assert row["image_url"] == configured_popup.image_url
    assert row["tagline"] == configured_popup.tagline
    assert row["location"] == configured_popup.location
    db.refresh(configured_popup)
    assert configured_popup.simplefi_api_key == "dummy-simplefi-secret"
    assert configured_popup.open_checkout_signing_secret == "dummy-checkout-secret"


@pytest.mark.parametrize(
    "role", ["admin_token_tenant_a", "operator_token_tenant_a", "superadmin_token"]
)
def test_admin_jwt_retains_configuration(
    client, configured_popup, tenant_a, request, role
):
    auth = {**headers(request.getfixturevalue(role)), "X-Tenant-Id": str(tenant_a.id)}
    response = client.get(f"/api/v1/popups/{configured_popup.id}", headers=auth)
    assert response.status_code == 200, response.text
    assert response.json()["simplefi_api_key"] == "dummy-simplefi-secret"
    assert response.json()["open_checkout_signing_secret"] == "dummy-checkout-secret"
    response = client.get(
        "/api/v1/popups", headers=auth, params={"search": configured_popup.name}
    )
    assert response.status_code == 200, response.text
    row = next(
        r for r in response.json()["results"] if r["id"] == str(configured_popup.id)
    )
    assert row["simplefi_api_key"] == "dummy-simplefi-secret"
    assert row["open_checkout_signing_secret"] == "dummy-checkout-secret"


@pytest.mark.parametrize(
    "scopes",
    [["events:read"], ["humans:read", "payments:read"], sorted(ADMIN_API_KEY_SCOPES)],
)
def test_admin_api_keys_cannot_read_or_modify_popup_configuration(
    client, db, configured_popup, admin_api_key_factory, scopes
):
    _, key = admin_api_key_factory(scopes)
    auth = headers(key)
    for path in [
        "/api/v1/popups",
        f"/api/v1/popups/{configured_popup.id}",
        "/api/v1/popups/check-in/list",
        f"/api/v1/popups/check-in/{configured_popup.id}",
    ]:
        response = client.get(path, headers=auth)
        assert response.status_code == 403, response.text
    # PATCH also returns PopupAdmin: it must not be a backdoor to the same secrets.
    response = client.patch(
        f"/api/v1/popups/{configured_popup.id}",
        headers=auth,
        json={"name": "Injected"},
    )
    assert response.status_code == 403, response.text
    response = client.post(
        "/api/v1/popups", headers=auth, json={"name": "Injected", "slug": "injected"}
    )
    assert response.status_code == 403, response.text
    db.refresh(configured_popup)
    assert configured_popup.name == "Private payment configuration"


def test_scanner_popup_reads_are_tenant_scoped(
    client, configured_popup, popup_tenant_b, check_in_controller_token_tenant_a
):
    auth = headers(check_in_controller_token_tenant_a)
    response = client.get(f"/api/v1/popups/check-in/{popup_tenant_b.id}", headers=auth)
    assert response.status_code == 404, response.text
    response = client.get("/api/v1/popups/check-in/list", headers=auth)
    assert response.status_code == 200, response.text
    ids = {r["id"] for r in response.json()["results"]}
    assert str(configured_popup.id) in ids
    assert str(popup_tenant_b.id) not in ids


def test_public_and_human_sessions_cannot_use_backoffice_popup_routes(
    client, db, tenant_a, configured_popup
):
    human = Humans(
        tenant_id=tenant_a.id, email=f"scanner-{uuid.uuid4().hex}@example.com"
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    token = create_access_token(subject=human.id, token_type="human")
    for path in [
        "/api/v1/popups",
        f"/api/v1/popups/{configured_popup.id}",
        "/api/v1/popups/check-in/list",
        f"/api/v1/popups/check-in/{configured_popup.id}",
    ]:
        assert client.get(path).status_code == 401
        assert client.get(path, headers=headers(token)).status_code == 403


def test_viewer_cannot_use_scanner_routes(
    client, configured_popup, viewer_token_tenant_a
):
    auth = headers(viewer_token_tenant_a)
    for path in [
        "/api/v1/popups/check-in/list",
        f"/api/v1/popups/check-in/{configured_popup.id}",
    ]:
        response = client.get(path, headers=auth)
        assert response.status_code == 403, response.text


def test_scanner_schema_does_not_inherit_administrative_fields():
    assert set(PopupCheckInPublic.model_fields) == SCANNER_FIELDS
