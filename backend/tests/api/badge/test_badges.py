"""SIM-108 phase 1: badge styles, catalog, admin awards and public profiles."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token
from app.core.tenant_db import ensure_tenant_credentials

BADGES = "/api/v1/badges"
STYLES = "/api/v1/badge-styles"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def tenant(db: Session) -> Tenants:
    """A tenant of its own: style defaults are per tenant and must start empty."""
    suffix = uuid.uuid4().hex[:8]
    tenant = Tenants(name=f"Badges {suffix}", slug=f"badges-{suffix}")
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    ensure_tenant_credentials(db, tenant.id)
    return tenant


@pytest.fixture(scope="module")
def admin(db: Session, tenant: Tenants) -> Users:
    user = Users(
        email=f"badges-admin-{uuid.uuid4().hex[:8]}@test.com",
        full_name="Badge Admin",
        role=UserRole.ADMIN,
        tenant_id=tenant.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture(scope="module")
def headers(admin: Users) -> dict[str, str]:
    return _auth(create_access_token(subject=admin.id, token_type="user"))


@pytest.fixture(scope="module")
def styles(client: TestClient, headers) -> dict[str, dict]:
    glass = client.post(STYLES, json={"name": "Luminous glass"}, headers=headers)
    assert glass.status_code == 201, glass.text
    ceramic = client.post(
        STYLES, json={"name": "Sculpted ceramics", "sort_order": 1}, headers=headers
    )
    assert ceramic.status_code == 201, ceramic.text
    return {"glass": glass.json(), "ceramic": ceramic.json()}


def _human(db: Session, tenant: Tenants, **fields) -> Humans:
    human = Humans(
        tenant_id=tenant.id, email=f"h-{uuid.uuid4().hex[:8]}@test.com", **fields
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _human_headers(human: Humans) -> dict[str, str]:
    return _auth(
        create_access_token(subject=human.id, token_type="human", issued_via="portal")
    )


def _badge(client: TestClient, headers, styles, **overrides) -> dict:
    body = {
        "name": f"Sauna {uuid.uuid4().hex[:6]}",
        "category": "Wellbeing",
        "images": [
            {
                "style_id": styles["glass"]["id"],
                "image_url": "https://cdn.test/glass/sauna.webp",
            },
            {
                "style_id": styles["ceramic"]["id"],
                "image_url": "https://cdn.test/ceramic/sauna.webp",
            },
        ],
    }
    body.update(overrides)
    resp = client.post(BADGES, json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------


def test_first_style_becomes_the_default(styles):
    assert styles["glass"]["is_default"] is True
    assert styles["glass"]["key"] == "luminous-glass"
    assert styles["ceramic"]["is_default"] is False


def test_switching_the_default_style(client: TestClient, headers, styles):
    resp = client.post(f"{STYLES}/{styles['ceramic']['id']}/default", headers=headers)
    assert resp.status_code == 200, resp.text
    listed = {s["id"]: s for s in client.get(STYLES, headers=headers).json()}
    assert listed[styles["ceramic"]["id"]]["is_default"] is True
    assert listed[styles["glass"]["id"]]["is_default"] is False

    # Restore so later tests see glass as the default.
    client.post(f"{STYLES}/{styles['glass']['id']}/default", headers=headers)


def test_default_style_cannot_be_deleted(client: TestClient, headers, styles):
    resp = client.delete(f"{STYLES}/{styles['glass']['id']}", headers=headers)
    assert resp.status_code == 409


def test_style_holding_a_badges_only_image_cannot_be_deleted(
    client: TestClient, headers, styles
):
    extra = client.post(STYLES, json={"name": "Paper"}, headers=headers).json()
    _badge(
        client,
        headers,
        styles,
        images=[{"style_id": extra["id"], "image_url": "https://cdn.test/p.webp"}],
    )
    resp = client.delete(f"{STYLES}/{extra['id']}", headers=headers)
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


def test_badge_requires_an_image(client: TestClient, headers):
    resp = client.post(BADGES, json={"name": "No art", "images": []}, headers=headers)
    assert resp.status_code == 422


def test_effective_image_follows_override_then_default(
    client: TestClient, headers, styles
):
    badge = _badge(client, headers, styles)
    assert badge["image_url"].endswith("/glass/sauna.webp")
    assert badge["slug"].startswith("sauna-")

    resp = client.patch(
        f"{BADGES}/{badge['id']}",
        json={"style_override_id": styles["ceramic"]["id"]},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["image_url"].endswith("/ceramic/sauna.webp")

    # Without its default-style artwork the badge falls back to what it has.
    only_ceramic = _badge(
        client,
        headers,
        styles,
        images=[
            {
                "style_id": styles["ceramic"]["id"],
                "image_url": "https://cdn.test/ceramic/yoga.webp",
            }
        ],
    )
    assert only_ceramic["image_url"].endswith("/ceramic/yoga.webp")


def test_last_image_cannot_be_removed(client: TestClient, headers, styles):
    badge = _badge(client, headers, styles)
    url = f"{BADGES}/{badge['id']}/images"
    assert client.delete(f"{url}/{styles['ceramic']['id']}", headers=headers).is_success
    resp = client.delete(f"{url}/{styles['glass']['id']}", headers=headers)
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Awards
# ---------------------------------------------------------------------------


def test_non_repeatable_badge_is_not_duplicated(
    client: TestClient, db: Session, tenant, headers, styles
):
    badge = _badge(client, headers, styles)
    human = _human(db, tenant)
    url = f"{BADGES}/{badge['id']}/awards"

    first = client.post(
        url, json={"recipient_human_id": str(human.id)}, headers=headers
    )
    assert first.status_code == 201, first.text
    assert first.json()["issuer_type"] == "admin"
    assert first.json()["issuer_name"] == "Badge Admin"

    dup = client.post(url, json={"recipient_email": human.email}, headers=headers)
    assert dup.status_code == 409

    revoke = client.post(
        f"{BADGES}/awards/{first.json()['id']}/revoke",
        json={"reason": "Given by mistake"},
        headers=headers,
    )
    assert revoke.status_code == 200, revoke.text
    assert revoke.json()["revoked_at"] is not None

    again = client.post(
        url, json={"recipient_human_id": str(human.id)}, headers=headers
    )
    assert again.status_code == 201, again.text


def test_repeatable_badge_stacks_and_is_counted(
    client: TestClient, db: Session, tenant, headers, styles
):
    badge = _badge(client, headers, styles, name="Gold star", repeatable=True)
    human = _human(db, tenant, first_name="Ada", last_name="lovelace")
    url = f"{BADGES}/{badge['id']}/awards"
    for message in ("Thanks for hosting", "Great talk"):
        resp = client.post(
            url,
            json={"recipient_human_id": str(human.id), "message": message},
            headers=headers,
        )
        assert resp.status_code == 201, resp.text

    mine = client.get(f"{BADGES}/portal/me", headers=_human_headers(human))
    assert mine.status_code == 200, mine.text
    [entry] = mine.json()
    assert entry["count"] == 2
    assert {a["message"] for a in entry["awards"]} == {
        "Thanks for hosting",
        "Great talk",
    }

    detail = client.get(f"{BADGES}/{badge['id']}", headers=headers).json()
    assert detail["award_count"] == 2

    # Flipping repeatable would desync the duplicate guard of existing awards.
    resp = client.patch(
        f"{BADGES}/{badge['id']}", json={"repeatable": False}, headers=headers
    )
    assert resp.status_code == 409


def test_awards_can_be_looked_up_by_email(
    client: TestClient, db: Session, tenant, headers, styles
):
    badge = _badge(client, headers, styles)
    human = _human(db, tenant)
    client.post(
        f"{BADGES}/{badge['id']}/awards",
        json={"recipient_human_id": str(human.id)},
        headers=headers,
    )
    resp = client.get(
        f"{BADGES}/awards", params={"email": human.email.upper()}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    [award] = resp.json()["results"]
    assert award["badge"]["id"] == badge["id"]
    assert award["recipient"]["email"] == human.email

    unknown = client.get(
        f"{BADGES}/awards", params={"email": "nobody@test.com"}, headers=headers
    )
    assert unknown.json()["results"] == []


def test_bulk_award_skips_holders_and_reports_unknown_emails(
    client: TestClient, db: Session, tenant, headers, styles
):
    badge = _badge(client, headers, styles)
    holder = _human(db, tenant)
    picked = _human(db, tenant, first_name="Grace")
    pasted = _human(db, tenant)
    url = f"{BADGES}/{badge['id']}/awards"
    client.post(url, json={"recipient_human_id": str(holder.id)}, headers=headers)

    resp = client.post(
        f"{url}/bulk",
        json={
            # The same person by id and by email gets it once.
            "recipient_human_ids": [str(picked.id), str(holder.id)],
            "recipient_emails": [
                picked.email.upper(),
                f" {pasted.email} ",
                "nobody@test.com",
            ],
            "message": "Thanks for showing up",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert {a["recipient"]["id"] for a in body["awarded"]} == {
        str(picked.id),
        str(pasted.id),
    }
    assert all(a["message"] == "Thanks for showing up" for a in body["awarded"])
    assert all(a["issuer_type"] == "admin" for a in body["awarded"])
    assert [h["id"] for h in body["already_had"]] == [str(holder.id)]
    assert body["unknown_emails"] == ["nobody@test.com"]

    detail = client.get(f"{BADGES}/{badge['id']}", headers=headers).json()
    assert detail["award_count"] == 3


def test_bulk_award_rejects_bad_input(
    client: TestClient, db: Session, tenant, headers, styles
):
    badge = _badge(client, headers, styles)
    url = f"{BADGES}/{badge['id']}/awards/bulk"

    empty = client.post(url, json={}, headers=headers)
    assert empty.status_code == 422

    bad_email = client.post(
        url, json={"recipient_emails": ["not-an-email"]}, headers=headers
    )
    assert bad_email.status_code == 422

    missing = client.post(
        url, json={"recipient_human_ids": [str(uuid.uuid4())]}, headers=headers
    )
    assert missing.status_code == 404

    # Awarded once, so deleting it archives it, and then nobody can get it.
    first = _human(db, tenant)
    client.post(url, json={"recipient_human_ids": [str(first.id)]}, headers=headers)
    client.delete(f"{BADGES}/{badge['id']}", headers=headers)
    late = _human(db, tenant)
    archived = client.post(
        url, json={"recipient_human_ids": [str(late.id)]}, headers=headers
    )
    assert archived.status_code == 409


def test_deleting_an_awarded_badge_archives_it(
    client: TestClient, db: Session, tenant, headers, styles
):
    badge = _badge(client, headers, styles)
    human = _human(db, tenant)
    url = f"{BADGES}/{badge['id']}"
    client.post(
        f"{url}/awards", json={"recipient_human_id": str(human.id)}, headers=headers
    )

    assert client.delete(url, headers=headers).status_code == 204
    archived = client.get(url, headers=headers).json()
    assert archived["archived_at"] is not None
    listed = client.get(BADGES, headers=headers).json()["results"]
    assert badge["id"] not in {b["id"] for b in listed}

    other = _human(db, tenant)
    resp = client.post(
        f"{url}/awards", json={"recipient_human_id": str(other.id)}, headers=headers
    )
    assert resp.status_code == 409

    # A never-awarded badge is deleted outright.
    unused = _badge(client, headers, styles)
    assert client.delete(f"{BADGES}/{unused['id']}", headers=headers).status_code == 204
    assert client.get(f"{BADGES}/{unused['id']}", headers=headers).status_code == 404


def test_badges_are_tenant_isolated(
    client: TestClient, admin_token_tenant_b: str, headers, styles
):
    badge = _badge(client, headers, styles)
    other = _auth(admin_token_tenant_b)
    assert client.get(f"{BADGES}/{badge['id']}", headers=other).status_code == 404
    listed = client.get(BADGES, headers=other).json()["results"]
    assert badge["id"] not in {b["id"] for b in listed}


# ---------------------------------------------------------------------------
# API keys (AgentVillage)
# ---------------------------------------------------------------------------


def test_admin_api_key_scopes(client: TestClient, admin_api_key_factory):
    _, read_only = admin_api_key_factory(scopes=["badges:read"])
    assert client.get(BADGES, headers=_auth(read_only)).status_code == 200
    assert client.get(f"{BADGES}/awards", headers=_auth(read_only)).status_code == 200
    resp = client.post(STYLES, json={"name": "Nope"}, headers=_auth(read_only))
    assert resp.status_code == 403

    _, unrelated = admin_api_key_factory(scopes=["events:read"])
    assert client.get(BADGES, headers=_auth(unrelated)).status_code == 403


# ---------------------------------------------------------------------------
# Public profile
# ---------------------------------------------------------------------------


def test_public_profile_shows_only_safe_fields(
    client: TestClient, db: Session, tenant, headers, styles
):
    badge = _badge(client, headers, styles, name="Mentor")
    human = _human(
        db,
        tenant,
        first_name="Grace",
        last_name="hopper",
        picture_url="https://cdn.test/grace.png",
    )
    client.post(
        f"{BADGES}/{badge['id']}/awards",
        json={"recipient_human_id": str(human.id), "message": "Private note"},
        headers=headers,
    )

    settings = client.get(
        "/api/v1/humans/me/public-profile", headers=_human_headers(human)
    )
    assert settings.status_code == 200, settings.text
    token = settings.json()["token"]
    assert settings.json()["enabled"] is False
    # Reading settings creates a stable token, but does not publish the profile.
    again = client.get(
        "/api/v1/humans/me/public-profile", headers=_human_headers(human)
    )
    assert again.json()["token"] == token
    assert again.json()["enabled"] is False
    assert (
        client.get(
            f"/api/v1/humans/public/profiles/{token}",
            headers={"X-Tenant-Id": str(tenant.id)},
        ).status_code
        == 404
    )
    enabled = client.patch(
        "/api/v1/humans/me/public-profile",
        json={"enabled": True},
        headers=_human_headers(human),
    )
    assert enabled.status_code == 200
    assert enabled.json() == {"enabled": True, "token": token}

    resp = client.get(
        f"/api/v1/humans/public/profiles/{token}",
        headers={"X-Tenant-Id": str(tenant.id)},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {
        "display_name": "Grace H.",
        "picture_url": "https://cdn.test/grace.png",
        "badges": [
            {
                "name": "Mentor",
                "description": None,
                "image_url": "https://cdn.test/glass/sauna.webp",
                "count": 1,
            }
        ],
    }
    assert human.email not in resp.text
    assert "Private note" not in resp.text


def test_public_profile_404s(
    client: TestClient, db: Session, tenant, tenant_b: Tenants
):
    human = _human(db, tenant, first_name="Linus")
    hh = _human_headers(human)
    token = client.get("/api/v1/humans/me/public-profile", headers=hh).json()["token"]
    url = f"/api/v1/humans/public/profiles/{token}"
    own = {"X-Tenant-Id": str(tenant.id)}

    assert client.get(url, headers=own).status_code == 404
    enabled = client.patch(
        "/api/v1/humans/me/public-profile", json={"enabled": True}, headers=hh
    )
    assert enabled.status_code == 200
    assert client.get(url, headers=own).status_code == 200
    # Sibling tenant cannot resolve it.
    assert client.get(url, headers={"X-Tenant-Id": str(tenant_b.id)}).status_code == 404
    assert (
        client.get("/api/v1/humans/public/profiles/nope", headers=own).status_code
        == 404
    )

    off = client.patch(
        "/api/v1/humans/me/public-profile", json={"enabled": False}, headers=hh
    )
    assert off.status_code == 200 and off.json()["enabled"] is False
    assert client.get(url, headers=own).status_code == 404
    client.patch("/api/v1/humans/me/public-profile", json={"enabled": True}, headers=hh)

    new = client.post("/api/v1/humans/me/public-profile/regenerate", headers=hh).json()
    assert new["token"] != token
    assert client.get(url, headers=own).status_code == 404
    assert (
        client.get(
            f"/api/v1/humans/public/profiles/{new['token']}", headers=own
        ).status_code
        == 200
    )
