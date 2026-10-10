"""Real PostgreSQL coverage of shared OTP/SSO rotation and online revocation."""

import secrets
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from sqlmodel import Session, select

from app.api.human.models import Humans
from app.api.shared.enums import HumanRating
from app.api.third_party_app import crud
from app.api.third_party_auth.models import ThirdPartyGrants, ThirdPartyRefreshTokens
from app.api.third_party_auth.service import refresh_hash, rotate_pair
from app.api.third_party_sso.models import PopupThirdPartyApps
from app.core.security import create_access_token, decode_access_token
from tests.api.auth.test_third_party_login_per_app import _do_login_and_capture_code
from tests.api.auth.test_third_party_sso import issue, redeem

BASE = "/api/v1/auth/human/third-party"


@pytest.fixture(params=["otp", "sso"])
def pair(request, client, setup_sso):
    human, _, _, key, _ = setup_sso
    with patch("app.api.auth.crud.is_redis_available", return_value=False):
        if request.param == "sso":
            code, verifier = issue(client, setup_sso)
            response = redeem(client, setup_sso, code, verifier)
        else:
            code = _do_login_and_capture_code(client, key, human.email)
            response = client.post(
                BASE + "/authenticate",
                headers=headers(key),
                json={"email": human.email, "code": code},
            )
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    return response.json()


def headers(key):
    return {"X-Third-Party-Api-Key": key}


def refresh(client, setup, pair):
    return client.post(
        BASE + "/refresh",
        headers=headers(setup[3]),
        json={"refresh_token": pair["refresh_token"]},
    )


def profile(client, pair):
    return client.get(
        "/api/v1/humans/me", headers={"Authorization": "Bearer " + pair["access_token"]}
    )


def test_shared_policy_and_rotation(client, db, setup_sso, pair):
    payload = decode_access_token(pair["access_token"])
    assert 899 <= pair["expires_in"] <= 900
    assert pair["refresh_expires_in"] == 8 * 86400
    assert payload.third_party_grant_id == uuid.UUID(pair["grant_id"])
    assert payload.issued_by_app_id == setup_sso[2].id
    assert profile(client, pair).status_code == 200
    row = db.get(ThirdPartyRefreshTokens, refresh_hash(pair["refresh_token"]))
    assert row and row.token_hash != pair["refresh_token"]
    assert row.consumed_at is None
    response = refresh(client, setup_sso, pair)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    newer = response.json()
    assert newer["refresh_token"] != pair["refresh_token"]
    assert newer["grant_id"] == pair["grant_id"]
    assert newer["grant_expires_at"] == pair["grant_expires_at"]
    db.refresh(row)
    assert row.consumed_at is not None
    assert profile(client, newer).status_code == 200
    assert refresh(client, setup_sso, newer).status_code == 200


def test_refresh_does_not_require_live_access_token(client, setup_sso, pair):
    expired = create_access_token(
        setup_sso[0].id,
        token_type="human",
        expires_delta=timedelta(seconds=-1),
        issued_via="third_party",
        issued_by_app_id=setup_sso[2].id,
        third_party_grant_id=uuid.UUID(pair["grant_id"]),
        scopes=["portal:profile:read"],
    )
    assert profile(client, {"access_token": expired}).status_code == 401
    assert refresh(client, setup_sso, pair).status_code == 200


def test_ancestor_replay_revokes_entire_family_and_live_jwts(client, setup_sso, pair):
    newer = refresh(client, setup_sso, pair).json()
    newest = refresh(client, setup_sso, newer).json()
    assert refresh(client, setup_sso, pair).status_code == 401
    assert refresh(client, setup_sso, newest).status_code == 401
    assert profile(client, pair).status_code == 401
    assert profile(client, newest).status_code == 401
    # Self-discovery has its own auth path: it must not bypass revocation.
    assert (
        client.get(
            "/api/v1/third-party-apps/whoami",
            headers={"Authorization": "Bearer " + newest["access_token"]},
        ).status_code
        == 401
    )


@pytest.mark.parametrize("same_tenant", [False, True])
def test_wrong_app_cannot_rotate_or_revoke(
    client, db, tenant_b, setup_sso, pair, same_tenant
):
    other_app, key = crud.create(
        db,
        setup_sso[0].tenant_id if same_tenant else tenant_b.id,
        name="other-" + uuid.uuid4().hex,
        allowed_token_scopes=["portal:profile:read"],
        allowed_api_key_scopes=[],
    )
    try:
        body = {"refresh_token": pair["refresh_token"]}
        assert (
            client.post(BASE + "/refresh", headers=headers(key), json=body).status_code
            == 401
        )
        assert (
            client.post(BASE + "/revoke", headers=headers(key), json=body).status_code
            == 204
        )
        assert profile(client, pair).status_code == 200
        assert refresh(client, setup_sso, pair).status_code == 200
    finally:
        db.delete(other_app)
        db.commit()


def test_revoke_is_idempotent_and_accepts_consumed_ancestor(client, setup_sso, pair):
    newer = refresh(client, setup_sso, pair).json()
    for raw in (
        "eos_rt_" + secrets.token_urlsafe(32),
        pair["refresh_token"],
        pair["refresh_token"],
    ):
        response = client.post(
            BASE + "/revoke", headers=headers(setup_sso[3]), json={"refresh_token": raw}
        )
        assert response.status_code == 204
        assert response.headers["cache-control"] == "no-store"
    assert profile(client, newer).status_code == 401
    assert refresh(client, setup_sso, newer).status_code == 401


@pytest.mark.parametrize("same_tenant", [False, True])
def test_portal_can_disconnect_only_own_grants(
    client, db, tenant_b, setup_sso, pair, same_tenant
):
    bearer = {"Authorization": "Bearer " + setup_sso[4]}
    response = client.get(BASE + "/grants", headers=bearer)
    assert response.status_code == 200
    assert [g["id"] for g in response.json()] == [pair["grant_id"]]
    assert "token_hash" not in response.text and "refresh_token" not in response.text
    other = Humans(
        tenant_id=setup_sso[0].tenant_id if same_tenant else tenant_b.id,
        email=uuid.uuid4().hex + "@example.com",
    )
    db.add(other)
    db.commit()
    try:
        other_bearer = {
            "Authorization": "Bearer "
            + create_access_token(other.id, token_type="human")
        }
        assert client.get(BASE + "/grants", headers=other_bearer).json() == []
        assert (
            client.delete(
                BASE + "/grants/" + pair["grant_id"], headers=other_bearer
            ).status_code
            == 404
        )
        assert (
            client.delete(
                BASE + "/grants/" + pair["grant_id"],
                headers={"Authorization": "Bearer " + pair["access_token"]},
            ).status_code
            == 403
        )
        assert (
            client.delete(
                BASE + "/grants/" + pair["grant_id"], headers=bearer
            ).status_code
            == 204
        )
        assert (
            client.delete(
                BASE + "/grants/" + pair["grant_id"], headers=bearer
            ).status_code
            == 204
        )
        assert profile(client, pair).status_code == 401
        assert refresh(client, setup_sso, pair).status_code == 401
    finally:
        db.delete(other)
        db.commit()


def test_scope_reductions_apply_immediately_and_never_reexpand(
    client, db, setup_sso, pair
):
    app = setup_sso[2]
    original = list(app.allowed_token_scopes)
    app.allowed_token_scopes = ["portal:applications:read"]
    db.add(app)
    db.commit()
    assert profile(client, pair).status_code == 403
    newer = refresh(client, setup_sso, pair).json()
    assert decode_access_token(newer["access_token"]).scopes == [
        "portal:applications:read"
    ]
    app.allowed_token_scopes = original + ["portal:directory:read"]
    db.add(app)
    db.commit()
    newest = refresh(client, setup_sso, newer).json()
    assert decode_access_token(newest["access_token"]).scopes == [
        "portal:applications:read"
    ]
    assert profile(client, pair).status_code == 403


@pytest.mark.parametrize("expiry", ["refresh", "grant"])
def test_idle_and_absolute_expiry(client, db, setup_sso, pair, expiry):
    if expiry == "refresh":
        row = db.get(ThirdPartyRefreshTokens, refresh_hash(pair["refresh_token"]))
    else:
        row = db.get(ThirdPartyGrants, uuid.UUID(pair["grant_id"]))
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.add(row)
    db.commit()
    assert refresh(client, setup_sso, pair).status_code == 401
    if expiry == "grant":
        assert profile(client, pair).status_code == 401


def test_refresh_and_access_lifetime_capped_by_absolute_expiry(
    client, db, setup_sso, pair
):
    grant = db.get(ThirdPartyGrants, uuid.UUID(pair["grant_id"]))
    grant.expires_at = datetime.now(UTC) + timedelta(seconds=90)
    db.add(grant)
    db.commit()
    response = refresh(client, setup_sso, pair)
    assert response.status_code == 200
    assert 0 < response.json()["expires_in"] <= 90
    assert 0 < response.json()["refresh_expires_in"] <= 90


@pytest.mark.parametrize(
    "change", ["inactive", "revoked", "human_blocked", "tenant_deleted"]
)
def test_resource_revalidation(client, db, setup_sso, pair, change):
    human, _, app, _, _ = setup_sso
    tenant = app.tenant
    if change == "inactive":
        app.active = False
    elif change == "revoked":
        app.revoked_at = datetime.now(UTC)
    elif change == "human_blocked":
        human.rating = HumanRating.RED_FLAG
    else:
        tenant.deleted = True
    db.add(app)
    db.add(human)
    db.add(tenant)
    db.commit()
    try:
        assert refresh(client, setup_sso, pair).status_code == 401
        assert profile(client, pair).status_code == 401
    finally:
        tenant.deleted = False
        db.add(tenant)
        db.commit()


def test_app_key_rotation_requires_new_key_but_preserves_grant(
    client, db, setup_sso, pair
):
    _, new_key = crud.rotate_key(db, setup_sso[2])
    assert refresh(client, setup_sso, pair).status_code == 401
    response = client.post(
        BASE + "/refresh",
        headers=headers(new_key),
        json={"refresh_token": pair["refresh_token"]},
    )
    assert response.status_code == 200


@pytest.mark.parametrize("change", ["association", "callback", "home"])
def test_sso_binding_revalidated(client, db, setup_sso, change):
    _, popup, app, _, _ = setup_sso
    code, verifier = issue(client, setup_sso)
    pair = redeem(client, setup_sso, code, verifier).json()
    if change == "association":
        row = db.get(PopupThirdPartyApps, (popup.id, app.id))
        row.enabled = False
    elif change == "callback":
        row = app
        row.sso_redirect_uri = "https://partner.example/other"
    else:
        row = popup
        row.custom_home_enabled = False
    db.add(row)
    db.commit()
    assert refresh(client, setup_sso, pair).status_code == 401
    assert profile(client, pair).status_code == 401


def test_concurrent_rotation_serializes_and_replay_revokes_winner(
    db, test_engine, setup_sso, pair
):
    app_id = setup_sso[2].id

    def rotate():
        from fastapi import HTTPException

        from app.api.third_party_app.models import ThirdPartyApps

        with Session(test_engine) as session:
            try:
                return rotate_pair(
                    session, session.get(ThirdPartyApps, app_id), pair["refresh_token"]
                )
            except HTTPException as exc:
                return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: rotate(), range(2)))
    assert sum(r == 401 for r in results) == 1
    assert sum(r != 401 for r in results) == 1
    grant = db.get(
        ThirdPartyGrants, uuid.UUID(pair["grant_id"]), populate_existing=True
    )
    assert grant.revoked_at is not None
    tokens = db.exec(
        select(ThirdPartyRefreshTokens).where(
            ThirdPartyRefreshTokens.grant_id == grant.id
        )
    ).all()
    assert len(tokens) == 2


def test_invalid_credentials_and_schema(client, setup_sso, pair):
    body = {"refresh_token": pair["refresh_token"]}
    assert client.post(BASE + "/refresh", json=body).status_code == 422
    assert (
        client.post(
            BASE + "/refresh", headers=headers("invalid"), json=body
        ).status_code
        == 401
    )
    assert (
        client.post(
            BASE + "/refresh",
            headers=headers(setup_sso[3]),
            json={"refresh_token": pair["access_token"]},
        ).status_code
        == 422
    )
    assert (
        client.post(
            BASE + "/refresh",
            headers=headers(setup_sso[3]),
            json={"refresh_token": "eos_rt_" + secrets.token_urlsafe(32)},
        ).status_code
        == 401
    )


def test_failed_refresh_commit_rolls_back_consumption(db, test_engine, setup_sso, pair):
    from app.api.third_party_app.models import ThirdPartyApps

    with Session(test_engine) as session:
        app = session.get(ThirdPartyApps, setup_sso[2].id)
        with patch.object(
            session, "commit", side_effect=RuntimeError("simulated commit failure")
        ):
            with pytest.raises(RuntimeError):
                rotate_pair(session, app, pair["refresh_token"])
    token = db.get(
        ThirdPartyRefreshTokens,
        refresh_hash(pair["refresh_token"]),
        populate_existing=True,
    )
    assert token.consumed_at is None
    tokens = db.exec(
        select(ThirdPartyRefreshTokens).where(
            ThirdPartyRefreshTokens.grant_id == token.grant_id
        )
    ).all()
    assert len(tokens) == 1


def test_purge_preserves_live_family_ancestors(db, setup_sso, pair):
    from app.api.third_party_auth.service import purge_expired_grants

    rotate_pair(db, setup_sso[2], pair["refresh_token"])
    grant = db.get(
        ThirdPartyGrants, uuid.UUID(pair["grant_id"]), populate_existing=True
    )
    assert purge_expired_grants(db) == 0
    tokens = db.exec(
        select(ThirdPartyRefreshTokens).where(
            ThirdPartyRefreshTokens.grant_id == grant.id
        )
    ).all()
    assert len(tokens) == 2
    grant_id = grant.id
    grant.expires_at = datetime.now(UTC) - timedelta(days=2)
    db.add(grant)
    db.commit()
    assert purge_expired_grants(db) == 1
    assert db.get(ThirdPartyGrants, grant_id, populate_existing=True) is None
    assert (
        db.exec(
            select(ThirdPartyRefreshTokens).where(
                ThirdPartyRefreshTokens.grant_id == grant_id
            )
        ).all()
        == []
    )


@pytest.mark.parametrize("wrong_binding", ["human", "app", "origin"])
def test_jwt_grant_binding_cannot_be_swapped(client, setup_sso, pair, wrong_binding):
    token = create_access_token(
        uuid.uuid4() if wrong_binding == "human" else setup_sso[0].id,
        token_type="human",
        scopes=["portal:profile:read"],
        issued_via="portal" if wrong_binding == "origin" else "third_party",
        issued_by_app_id=uuid.uuid4() if wrong_binding == "app" else setup_sso[2].id,
        third_party_grant_id=uuid.UUID(pair["grant_id"]),
    )
    assert profile(client, {"access_token": token}).status_code == 401


@pytest.mark.parametrize("origin", ["otp", "sso"])
def test_blocked_human_cannot_receive_new_pair(client, db, setup_sso, origin):
    human = setup_sso[0]
    human.rating = HumanRating.RED_FLAG
    db.add(human)
    db.commit()
    if origin == "sso":
        code, verifier = issue(client, setup_sso)
        response = redeem(client, setup_sso, code, verifier)
    else:
        with patch("app.api.auth.crud.is_redis_available", return_value=False):
            code = _do_login_and_capture_code(client, setup_sso[3], human.email)
            response = client.post(
                BASE + "/authenticate",
                headers=headers(setup_sso[3]),
                json={"email": human.email, "code": code},
            )
    assert response.status_code == 401
    assert (
        db.exec(
            select(ThirdPartyGrants).where(ThirdPartyGrants.human_id == human.id)
        ).all()
        == []
    )


def test_discovery_includes_refresh_but_not_portal_grant_management(client, setup_sso):
    response = client.get(
        "/api/v1/third-party-apps/openapi.json", headers=headers(setup_sso[3])
    )
    assert response.status_code == 200
    paths = response.json()["paths"]
    for endpoint in ("/refresh", "/revoke", "/sso/exchange"):
        assert BASE + endpoint in paths
    assert BASE + "/grants" not in paths
    assert BASE + "/grants/{grant_id}" not in paths


def test_legacy_tokens_and_portal_lifetimes_unchanged(client, setup_sso):
    portal_payload = decode_access_token(setup_sso[4])
    assert portal_payload.exp > datetime.now(UTC) + timedelta(days=7)
    legacy = create_access_token(
        setup_sso[0].id,
        token_type="human",
        scopes=["portal:profile:read"],
        issued_via="third_party",
        issued_by_app_id=setup_sso[2].id,
    )
    assert decode_access_token(legacy).third_party_grant_id is None
    assert profile(client, {"access_token": legacy}).status_code == 200
