"""Real PostgreSQL/API coverage: portal-only grants and atomic code consumption."""

import secrets
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlmodel import select

from app.api.human.models import Humans
from app.api.popup.models import PopupHomePages, Popups
from app.api.popup.schemas import PopupStatus
from app.api.third_party_app import crud
from app.api.third_party_sso.models import (
    PopupThirdPartyApps,
    ThirdPartyAuthorizationCodes,
)
from app.api.third_party_sso.service import code_hash, pkce_challenge
from app.core.security import create_access_token, decode_access_token

EXCHANGE = "/api/v1/auth/human/third-party/sso/exchange"


@pytest.fixture
def setup_sso(db, tenant_a):
    tag = uuid.uuid4().hex
    human = Humans(tenant_id=tenant_a.id, email=f"sso-{tag}@example.com")
    popup = Popups(
        tenant_id=tenant_a.id,
        name="SSO home",
        slug=f"sso-{tag}",
        status=PopupStatus.active,
        custom_home_enabled=True,
    )
    db.add(human)
    db.add(popup)
    db.commit()
    db.refresh(human)
    db.refresh(popup)
    app, key = crud.create(
        db,
        tenant_a.id,
        name=f"sso-{tag}",
        allowed_token_scopes=["portal:profile:read", "portal:applications:read"],
        allowed_api_key_scopes=[],
        sso_start_url="https://partner.example/start",
        sso_redirect_uri="https://partner.example/callback",
    )
    db.add(
        PopupHomePages(popup_id=popup.id, tenant_id=tenant_a.id, html="<h1>Home</h1>")
    )
    db.add(PopupThirdPartyApps(popup_id=popup.id, app_id=app.id, tenant_id=tenant_a.id))
    db.commit()
    token = create_access_token(human.id, token_type="human")
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield human, popup, app, key, token
    db.rollback()
    db.delete(popup)
    db.delete(app)
    db.delete(human)
    db.commit()


def issue(client, setup):
    _, popup, app, _, token = setup
    verifier = secrets.token_urlsafe(32)
    state = secrets.token_urlsafe(24)
    path = f"/api/v1/popups/portal/{popup.slug}/apps/{app.id}"
    response = client.post(
        path + "/authorization-codes",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "state": state,
            "code_challenge": pkce_challenge(verifier),
            "code_challenge_method": "S256",
        },
    )
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    query = parse_qs(urlsplit(response.json()["redirect_url"]).query)
    assert query["state"] == [state]
    return query["code"][0], verifier


def redeem(client, setup, code, verifier, **changes):
    body = {
        "code": code,
        "code_verifier": verifier,
        "redirect_uri": setup[2].sso_redirect_uri,
        **changes,
    }
    return client.post(EXCHANGE, headers={"X-Third-Party-Api-Key": setup[3]}, json=body)


def test_success_and_replay(client, db, setup_sso):
    human, _, app, _, _ = setup_sso
    code, verifier = issue(client, setup_sso)
    row = db.get(ThirdPartyAuthorizationCodes, code_hash(code))
    assert row and row.code_hash != code
    response = redeem(client, setup_sso, code, verifier)
    assert response.status_code == 200, response.text
    assert response.json()["expires_in"] == 900
    assert response.headers["cache-control"] == "no-store"
    payload = decode_access_token(response.json()["access_token"])
    assert payload.sub == str(human.id)
    assert payload.token_type == "human"
    assert payload.issued_via == "third_party"
    assert payload.issued_by_app_id == app.id
    assert set(payload.scopes) == set(app.allowed_token_scopes)
    assert "portal:*" not in payload.scopes
    assert redeem(client, setup_sso, code, verifier).status_code == 400


@pytest.mark.parametrize(
    "change",
    [
        "pkce",
        "callback",
        "registered_callback",
        "expiry",
        "disabled",
        "revoked",
        "home",
    ],
)
def test_invalid_exchange(client, db, setup_sso, change):
    _, popup, app, _, _ = setup_sso
    code, verifier = issue(client, setup_sso)
    extra = {}
    if change == "pkce":
        verifier = secrets.token_urlsafe(32)
    elif change == "callback":
        extra["redirect_uri"] = "https://evil.example/callback"
    elif change == "registered_callback":
        extra["redirect_uri"] = app.sso_redirect_uri
        app.sso_redirect_uri = "https://partner.example/new-callback"
        db.add(app)
    elif change == "expiry":
        row = db.get(ThirdPartyAuthorizationCodes, code_hash(code))
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.add(row)
    elif change == "disabled":
        link = db.get(PopupThirdPartyApps, (popup.id, app.id))
        link.enabled = False
        db.add(link)
    elif change == "revoked":
        app.active = False
        db.add(app)
    elif change == "home":
        popup.custom_home_enabled = False
        db.add(popup)
    db.commit()
    response = redeem(client, setup_sso, code, verifier, **extra)
    assert response.status_code == (401 if change == "revoked" else 400), response.text
    db.expire_all()
    assert db.get(ThirdPartyAuthorizationCodes, code_hash(code)).consumed_at is None


def test_invalid_pkce_does_not_burn_code(client, setup_sso):
    code, verifier = issue(client, setup_sso)
    assert redeem(client, setup_sso, code, secrets.token_urlsafe(32)).status_code == 400
    assert redeem(client, setup_sso, code, verifier).status_code == 200


def test_other_app_cannot_exchange(client, db, setup_sso, tenant_a):
    other, key = crud.create(
        db,
        tenant_a.id,
        name=f"other-{uuid.uuid4().hex}",
        allowed_token_scopes=[],
        allowed_api_key_scopes=[],
    )
    code, verifier = issue(client, setup_sso)
    response = client.post(
        EXCHANGE,
        headers={"X-Third-Party-Api-Key": key},
        json={
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": setup_sso[2].sso_redirect_uri,
        },
    )
    assert response.status_code == 400
    assert redeem(client, setup_sso, code, verifier).status_code == 200
    db.delete(other)
    db.commit()


def test_concurrent_exchange_only_one_succeeds(client, setup_sso):
    code, verifier = issue(client, setup_sso)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(lambda _: redeem(client, setup_sso, code, verifier), range(2))
        )
    assert sorted(response.status_code for response in responses) == [200, 400]


def test_scope_changes_cannot_broaden_grant(client, db, setup_sso):
    app = setup_sso[2]
    app.allowed_token_scopes = ["portal:profile:read"]
    db.add(app)
    db.commit()
    code, verifier = issue(client, setup_sso)
    app.allowed_token_scopes = ["portal:profile:read", "portal:applications:read"]
    db.add(app)
    db.commit()
    response = redeem(client, setup_sso, code, verifier)
    assert decode_access_token(response.json()["access_token"]).scopes == [
        "portal:profile:read"
    ]


def test_scope_reduction_applies_at_exchange(client, db, setup_sso):
    code, verifier = issue(client, setup_sso)
    app = setup_sso[2]
    app.allowed_token_scopes = []
    db.add(app)
    db.commit()
    response = redeem(client, setup_sso, code, verifier)
    assert response.status_code == 200
    assert decode_access_token(response.json()["access_token"]).scopes == []


@pytest.mark.parametrize("credential", ["third_party", "admin", "api_key"])
def test_only_portal_session_can_issue(client, db, setup_sso, credential):
    human, popup, app, _, _ = setup_sso
    if credential == "third_party":
        token = create_access_token(
            human.id,
            token_type="human",
            issued_via="third_party",
            scopes=["portal:profile:read"],
            issued_by_app_id=app.id,
        )
    elif credential == "admin":
        token = create_access_token(human.id, token_type="user")
    else:
        from app.api.api_key.crud import generate_raw_key, hash_key
        from app.api.api_key.models import ApiKeys

        token = generate_raw_key()
        db.add(
            ApiKeys(
                human_id=human.id,
                tenant_id=human.tenant_id,
                popup_id=popup.id,
                name="No delegation",
                key_hash=hash_key(token),
                prefix=token[:8],
                scopes=["events:read"],
            )
        )
        db.commit()
    path = f"/api/v1/popups/portal/{popup.slug}/apps/{app.id}/authorization-codes"
    response = client.post(
        path,
        headers={"Authorization": f"Bearer {token}"},
        json={
            "state": secrets.token_urlsafe(24),
            "code_challenge": pkce_challenge(secrets.token_urlsafe(32)),
            "code_challenge_method": "S256",
        },
    )
    assert response.status_code == 403, response.text


def test_same_visibility_as_home(client, db, setup_sso):
    _, popup, app, _, token = setup_sso
    path = f"/api/v1/popups/portal/{popup.slug}"
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get(path + "/home", headers=headers).status_code == 200
    assert (
        client.get(path + f"/apps/{app.id}/launch", headers=headers).status_code == 200
    )
    popup.status = PopupStatus.ended
    db.add(popup)
    db.commit()
    assert client.get(path + "/home", headers=headers).status_code == 404
    assert (
        client.get(path + f"/apps/{app.id}/launch", headers=headers).status_code == 404
    )


def test_cross_tenant_launch_denied(client, setup_sso, db, tenant_b):
    human = Humans(
        tenant_id=tenant_b.id, email=f"outsider-{uuid.uuid4().hex}@example.com"
    )
    db.add(human)
    db.commit()
    token = create_access_token(human.id, token_type="human")
    popup, app = setup_sso[1:3]
    response = client.get(
        f"/api/v1/popups/portal/{popup.slug}/apps/{app.id}/launch",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404
    db.delete(human)
    db.commit()


def test_get_launch_never_issues_code(client, db, setup_sso):
    _, popup, app, _, token = setup_sso
    before = len(db.exec(select(ThirdPartyAuthorizationCodes)).all())
    response = client.get(
        f"/api/v1/popups/portal/{popup.slug}/apps/{app.id}/launch",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert set(response.json()) == {"app_name", "start_url"}
    assert len(db.exec(select(ThirdPartyAuthorizationCodes)).all()) == before


def test_popup_app_configuration_requires_admin(
    client, setup_sso, admin_token_tenant_a
):
    _, popup, app, _, token = setup_sso
    path = f"/api/v1/popups/{popup.id}/apps"
    human_headers = {"Authorization": f"Bearer {token}"}
    assert client.get(path, headers=human_headers).status_code == 403
    assert (
        client.put(
            f"{path}/{app.id}", headers=human_headers, json={"enabled": False}
        ).status_code
        == 403
    )
    headers = {"Authorization": f"Bearer {admin_token_tenant_a}"}
    response = client.get(path, headers=headers)
    assert response.status_code == 200
    listed = next(item for item in response.json() if item["app_id"] == str(app.id))
    assert listed["enabled"] is True
    assert listed["sso_configured"] is True
    assert "key_hash" not in listed
    response = client.put(f"{path}/{app.id}", headers=headers, json={"enabled": False})
    assert response.status_code == 200
    assert response.json()["enabled"] is False


def test_admin_cannot_associate_app_from_other_tenant(
    client, db, setup_sso, tenant_b, admin_token_tenant_a
):
    other, _ = crud.create(
        db,
        tenant_b.id,
        name=f"outside-{uuid.uuid4().hex}",
        allowed_token_scopes=[],
        allowed_api_key_scopes=[],
        sso_start_url="https://partner.example/start",
        sso_redirect_uri="https://partner.example/callback",
    )
    popup = setup_sso[1]
    response = client.put(
        f"/api/v1/popups/{popup.id}/apps/{other.id}",
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        json={"enabled": True},
    )
    assert response.status_code == 404
    assert db.get(PopupThirdPartyApps, (popup.id, other.id)) is None
    db.delete(other)
    db.commit()
