import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.api.human.models import Humans
from app.api.tenant.models import Tenants
from app.core.config import settings
from app.core.security import ALGORITHM, create_access_token, decode_access_token

PATH = "/api/v1/auth/human/session"


@pytest.fixture
def human(db, tenant_a):
    row = Humans(tenant_id=tenant_a.id, email=f"session-{uuid.uuid4()}@example.com")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def headers(token, tenant):
    return {"Authorization": f"Bearer {token}", "X-Tenant-Id": str(tenant.id)}


def test_legacy_portal_session_preserves_original_expiry(client, human, tenant_a):
    token = create_access_token(human.id, "human", timedelta(minutes=17))
    response = client.get(PATH, headers=headers(token, tenant_a))
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"human", "expires_at"}
    assert set(body["human"]) == {
        "id",
        "tenant_id",
        "email",
        "first_name",
        "last_name",
        "picture_url",
    }
    assert body["human"]["id"] == str(human.id)
    assert datetime.fromisoformat(body["expires_at"]) == decode_access_token(token).exp
    assert response.headers["Cache-Control"] == "private, no-store"
    assert token not in response.text


@pytest.mark.parametrize(
    "kind",
    [
        "forged",
        "expired",
        "admin",
        "third_party",
        "api_key",
        "malformed",
        "missing_exp",
        "restricted",
        "missing_human",
    ],
)
def test_rejects_non_portal_credentials(client, human, tenant_a, kind):
    claims = {
        "sub": str(human.id),
        "exp": datetime.now(UTC) + timedelta(minutes=5),
        "token_type": "human",
    }
    key = settings.SECRET_KEY
    if kind == "forged":
        key = "fake-session-test-key-not-the-signing-key"
    elif kind == "expired":
        claims["exp"] = datetime.now(UTC) - timedelta(seconds=1)
    elif kind == "admin":
        claims["token_type"] = "user"
    elif kind == "third_party":
        claims.update(issued_via="third_party", scopes=["portal:profile:read"])
    elif kind == "api_key":
        claims["via_api_key"] = True
    elif kind == "malformed":
        claims["issued_by_app_id"] = "not-a-uuid"
    elif kind == "missing_exp":
        del claims["exp"]
    elif kind == "restricted":
        claims["scopes"] = ["portal:profile:read"]
    elif kind == "missing_human":
        claims["sub"] = str(uuid.uuid4())
    token = jwt.encode(claims, key, algorithm=ALGORITHM)
    assert client.get(PATH, headers=headers(token, tenant_a)).status_code == 401


def test_rejects_raw_api_key_without_database_resolution(client, tenant_a):
    assert (
        client.get(PATH, headers=headers("edge_fake_api_key", tenant_a)).status_code
        == 401
    )


def test_rejects_wrong_tenant_even_with_origin_override(
    client, human, tenant_a, tenant_b
):
    token = create_access_token(human.id, "human")
    request_headers = headers(token, tenant_b)
    request_headers["Origin"] = f"https://{tenant_a.slug}.example.com"
    assert client.get(PATH, headers=request_headers).status_code == 401


@pytest.mark.parametrize("state", ["deleted", "suspended"])
def test_rejects_inactive_tenant(client, db, state):
    tenant = Tenants(name="Inactive session test", slug=f"inactive-{uuid.uuid4().hex}")
    if state == "deleted":
        tenant.deleted = True
    else:
        tenant.suspended_at = datetime.now(UTC)
    db.add(tenant)
    db.commit()
    human = Humans(tenant_id=tenant.id, email=f"inactive-{uuid.uuid4()}@example.com")
    db.add(human)
    db.commit()
    token = create_access_token(human.id, "human")
    assert client.get(PATH, headers=headers(token, tenant)).status_code in (403, 404)


def test_requires_explicit_tenant_header(client, human):
    token = create_access_token(human.id, "human")
    assert (
        client.get(PATH, headers={"Authorization": f"Bearer {token}"}).status_code
        == 422
    )
