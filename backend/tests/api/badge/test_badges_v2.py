"""Badge system v2: profile usernames, the holders read, and stars from profiles."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token
from app.core.tenant_db import ensure_tenant_credentials

BADGES = "/api/v1/badges"
POLICIES = "/api/v1/badge-issuer-policies"
MY_PROFILE = "/api/v1/humans/me/public-profile"
PUBLIC_BY_USERNAME = "/api/v1/humans/public/profiles/by-username"
HOLDERS = f"{BADGES}/portal/holders"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _portal_headers(human: Humans) -> dict[str, str]:
    return _auth(
        create_access_token(subject=human.id, token_type="human", issued_via="portal")
    )


def _third_party_headers(human: Humans, scopes: list[str]) -> dict[str, str]:
    return _auth(
        create_access_token(
            subject=human.id,
            token_type="human",
            issued_via="third_party",
            scopes=scopes,
        )
    )


def _make_tenant(db: Session, label: str) -> Tenants:
    suffix = uuid.uuid4().hex[:8]
    tenant = Tenants(name=f"{label} {suffix}", slug=f"{label.lower()}-{suffix}")
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    ensure_tenant_credentials(db, tenant.id)
    return tenant


@pytest.fixture(scope="module")
def tenant(db: Session) -> Tenants:
    return _make_tenant(db, "Badges-v2")


@pytest.fixture(scope="module")
def other_tenant(db: Session) -> Tenants:
    return _make_tenant(db, "Badges-v2-other")


@pytest.fixture(scope="module")
def headers(db: Session, tenant: Tenants) -> dict[str, str]:
    admin = Users(
        email=f"v2-admin-{uuid.uuid4().hex[:8]}@test.com",
        role=UserRole.ADMIN,
        tenant_id=tenant.id,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return _auth(create_access_token(subject=admin.id, token_type="user"))


@pytest.fixture(scope="module")
def style(client: TestClient, headers) -> dict:
    resp = client.post("/api/v1/badge-styles", json={"name": "Glass"}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture
def make_human(db: Session, tenant: Tenants):
    def _make(
        name: str = "Pat",
        *,
        shared: bool = True,
        username: str | None = None,
        in_tenant: Tenants | None = None,
    ) -> Humans:
        human = Humans(
            tenant_id=(in_tenant or tenant).id,
            email=f"{name.lower()}-{uuid.uuid4().hex[:8]}@test.com",
            first_name=name,
            last_name="Tester",
            public_profile_enabled=shared,
            public_profile_token=uuid.uuid4().hex,
            username=username,
        )
        db.add(human)
        db.commit()
        db.refresh(human)
        return human

    return _make


def _unique_name(prefix: str = "u") -> str:
    return f"{prefix}{uuid.uuid4().hex[:10]}"


def _badge(client: TestClient, headers, style, **overrides) -> dict:
    body = {
        "name": f"Star {uuid.uuid4().hex[:6]}",
        "repeatable": True,
        "images": [{"style_id": style["id"], "image_url": "https://cdn.test/s.webp"}],
    }
    body.update(overrides)
    resp = client.post(BADGES, json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _award(client: TestClient, headers, badge: dict, human: Humans) -> dict:
    resp = client.post(
        f"{BADGES}/{badge['id']}/awards",
        json={"recipient_human_id": str(human.id)},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _policy(client: TestClient, headers, **body) -> dict:
    resp = client.post(POLICIES, json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _tenant_headers(tenant: Tenants) -> dict[str, str]:
    return {"X-Tenant-Id": str(tenant.id)}


# ---------------------------------------------------------------------------
# Username alias
# ---------------------------------------------------------------------------


def test_username_is_normalized_and_serves_the_profile(
    client: TestClient, make_human, tenant
):
    human = make_human("Ada", shared=True)
    wanted = _unique_name("Ada-")
    resp = client.patch(
        MY_PROFILE,
        json={"username": f"  {wanted.upper()} "},
        headers=_portal_headers(human),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["username"] == wanted.lower()
    # Setting the alias alone leaves sharing as it was.
    assert resp.json()["enabled"] is True

    profile = client.get(
        f"{PUBLIC_BY_USERNAME}/{wanted.upper()}", headers=_tenant_headers(tenant)
    )
    assert profile.status_code == 200, profile.text
    body = profile.json()
    assert body["display_name"] == "Ada T."
    assert body["username"] == wanted.lower()
    assert "email" not in body

    # The token page reports the alias too.
    by_token = client.get(
        f"/api/v1/humans/public/profiles/{human.public_profile_token}",
        headers=_tenant_headers(tenant),
    )
    assert by_token.json()["username"] == wanted.lower()


@pytest.mark.parametrize(
    "bad",
    ["ab", "-leading", "trailing_", "has space", "dots.in.it", "portal", "x" * 31],
)
def test_malformed_or_reserved_usernames_are_rejected(
    client: TestClient, make_human, bad
):
    human = make_human()
    resp = client.patch(
        MY_PROFILE, json={"username": bad}, headers=_portal_headers(human)
    )
    assert resp.status_code == 422, resp.text


def test_username_is_unique_per_tenant(client: TestClient, make_human, other_tenant):
    taken = _unique_name()
    make_human("First", username=taken)
    resp = client.patch(
        MY_PROFILE,
        json={"username": taken},
        headers=_portal_headers(make_human("Second")),
    )
    assert resp.status_code == 409

    # Another tenant may use the same name.
    elsewhere = make_human("Third", in_tenant=other_tenant)
    resp = client.patch(
        MY_PROFILE, json={"username": taken}, headers=_portal_headers(elsewhere)
    )
    assert resp.status_code == 200, resp.text


def test_a_popup_slug_cannot_be_taken_and_wins_later(
    client: TestClient, db: Session, make_human, tenant
):
    slug = _unique_name("fest-")
    db.add(Popups(tenant_id=tenant.id, name="Fest", slug=slug))
    db.commit()
    resp = client.patch(
        MY_PROFILE, json={"username": slug}, headers=_portal_headers(make_human())
    )
    assert resp.status_code == 409

    # Someone already holds a name a popup takes afterwards: the popup owns it.
    later = _unique_name("later-")
    make_human("Holder", username=later)
    assert (
        client.get(
            f"{PUBLIC_BY_USERNAME}/{later}", headers=_tenant_headers(tenant)
        ).status_code
        == 200
    )
    db.add(Popups(tenant_id=tenant.id, name="Later", slug=later))
    db.commit()
    assert (
        client.get(
            f"{PUBLIC_BY_USERNAME}/{later}", headers=_tenant_headers(tenant)
        ).status_code
        == 404
    )


def test_alias_is_hidden_while_sharing_is_off_and_can_be_removed(
    client: TestClient, make_human, tenant
):
    name = _unique_name()
    human = make_human("Shy", shared=False, username=name)
    url = f"{PUBLIC_BY_USERNAME}/{name}"
    assert client.get(url, headers=_tenant_headers(tenant)).status_code == 404

    on = client.patch(
        MY_PROFILE, json={"enabled": True}, headers=_portal_headers(human)
    )
    # Turning sharing on keeps the alias.
    assert on.json()["username"] == name
    assert client.get(url, headers=_tenant_headers(tenant)).status_code == 200

    off = client.patch(
        MY_PROFILE, json={"username": None}, headers=_portal_headers(human)
    )
    assert off.json()["username"] is None
    assert off.json()["enabled"] is True
    assert client.get(url, headers=_tenant_headers(tenant)).status_code == 404


def test_alias_does_not_resolve_from_another_tenant(
    client: TestClient, make_human, other_tenant
):
    name = _unique_name()
    make_human("Local", username=name)
    resp = client.get(
        f"{PUBLIC_BY_USERNAME}/{name}", headers=_tenant_headers(other_tenant)
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Holders (third-party read)
# ---------------------------------------------------------------------------


def test_holders_need_the_badges_read_scope(client: TestClient, make_human):
    reader = make_human("Reader")
    denied = client.get(
        HOLDERS, headers=_third_party_headers(reader, ["portal:profile:read"])
    )
    assert denied.status_code == 403
    allowed = client.get(
        HOLDERS, headers=_third_party_headers(reader, ["portal:badges:read"])
    )
    assert allowed.status_code == 200, allowed.text


def test_holders_list_shared_profiles_only_without_contact_fields(
    client: TestClient, headers, style, make_human
):
    badge = _badge(client, headers, style, repeatable=True)
    sharer = make_human("Sharer", username=_unique_name())
    private = make_human("Private", shared=False)
    _award(client, headers, badge, sharer)
    _award(client, headers, badge, sharer)
    _award(client, headers, badge, private)

    reader = _third_party_headers(make_human("Reader"), ["portal:badges:read"])
    resp = client.get(HOLDERS, params={"badge_id": badge["id"]}, headers=reader)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["paging"]["total"] == 1
    [holder] = body["results"]
    assert holder["human_id"] == str(sharer.id)
    assert holder["username"] == sharer.username
    assert holder["display_name"] == "Sharer T."
    assert "email" not in holder
    [held] = holder["badges"]
    assert held["badge"]["id"] == badge["id"]
    assert held["count"] == 2


def test_holders_filter_by_badge_slug_and_person(
    client: TestClient, headers, style, make_human
):
    sauna = _badge(client, headers, style, repeatable=False)
    star = _badge(client, headers, style, repeatable=True)
    person = make_human("Both", username=_unique_name())
    _award(client, headers, sauna, person)
    _award(client, headers, star, person)
    reader = _third_party_headers(make_human("Reader"), ["portal:badges:read"])

    by_slug = client.get(
        HOLDERS, params={"badge_slug": sauna["slug"]}, headers=reader
    ).json()
    assert [h["human_id"] for h in by_slug["results"]] == [str(person.id)]
    # A badge filter narrows each holder to that badge.
    assert [b["badge"]["id"] for b in by_slug["results"][0]["badges"]] == [sauna["id"]]

    for params in ({"username": person.username.upper()}, {"human_id": str(person.id)}):
        mine = client.get(HOLDERS, params=params, headers=reader).json()
        [holder] = mine["results"]
        assert {b["badge"]["id"] for b in holder["badges"]} == {
            sauna["id"],
            star["id"],
        }

    unknown = client.get(HOLDERS, params={"badge_slug": "nope"}, headers=reader)
    assert unknown.json()["paging"]["total"] == 0


def test_revoked_awards_and_other_tenants_are_left_out(
    client: TestClient, headers, style, make_human, other_tenant
):
    badge = _badge(client, headers, style, repeatable=False)
    person = make_human("Revoked")
    award = _award(client, headers, badge, person)
    resp = client.post(
        f"{BADGES}/awards/{award['id']}/revoke", json={}, headers=headers
    )
    assert resp.status_code == 200, resp.text

    reader = _third_party_headers(make_human("Reader"), ["portal:badges:read"])
    assert (
        client.get(HOLDERS, params={"badge_id": badge["id"]}, headers=reader).json()[
            "paging"
        ]["total"]
        == 0
    )

    # Someone of another tenant reads nothing of this one.
    stranger = _third_party_headers(
        make_human("Stranger", in_tenant=other_tenant), ["portal:badges:read"]
    )
    kept = make_human("Kept")
    _award(client, headers, badge, kept)
    resp = client.get(HOLDERS, params={"human_id": str(kept.id)}, headers=stranger)
    assert resp.json()["paging"]["total"] == 0


# ---------------------------------------------------------------------------
# Stars from a profile
# ---------------------------------------------------------------------------


def _give(client: TestClient, sender: Humans, badge: dict, **recipient):
    return client.post(
        f"{BADGES}/portal/profile-awards",
        json={"badge_id": badge["id"], **recipient},
        headers=_portal_headers(sender),
    )


def test_three_stars_a_day_from_profiles(
    client: TestClient, headers, style, make_human, tenant
):
    star = _badge(client, headers, style, name=f"Gold star {uuid.uuid4().hex[:4]}")
    _policy(
        client,
        headers,
        name="Gold stars",
        audience_type="tenant",
        allowance_quantity=3,
        allowance_window="day",
        badge_ids=[star["id"]],
    )
    sender = make_human("Giver")
    friend = make_human("Friend", username=_unique_name())

    issuable = client.get(
        f"{BADGES}/portal/profile-issuable",
        params={"username": friend.username},
        headers=_portal_headers(sender),
    )
    assert issuable.status_code == 200, issuable.text
    [item] = [i for i in issuable.json() if i["badge"]["id"] == star["id"]]
    assert item["remaining"] == 3
    assert item["resets_at"] is not None

    for _ in range(2):
        resp = _give(client, sender, star, username=friend.username, message="Thanks!")
        assert resp.status_code == 201, resp.text
    resp = _give(client, sender, star, token=friend.public_profile_token)
    assert resp.status_code == 201, resp.text
    assert resp.json()["popup_id"] is None
    assert resp.json()["recipient_name"] == "Friend T."

    exhausted = _give(client, sender, star, username=friend.username)
    assert exhausted.status_code == 429
    assert "X-Allowance-Resets-At" in exhausted.headers

    profile = client.get(
        f"{PUBLIC_BY_USERNAME}/{friend.username}", headers=_tenant_headers(tenant)
    ).json()
    [shown] = [b for b in profile["badges"] if b["name"] == star["name"]]
    assert shown["count"] == 3


def test_popup_bound_policies_do_not_apply_on_profiles(
    client: TestClient, db: Session, headers, style, make_human, tenant
):
    popup = Popups(
        tenant_id=tenant.id,
        name="Bound fest",
        slug=_unique_name("bound-"),
        badges_enabled=True,
    )
    db.add(popup)
    db.commit()
    badge = _badge(client, headers, style)
    _policy(
        client,
        headers,
        name="Popup tenant",
        audience_type="tenant",
        popup_id=str(popup.id),
        badge_ids=[badge["id"]],
    )
    _policy(
        client,
        headers,
        name="Popup attendees",
        audience_type="popup_attendees",
        popup_id=str(popup.id),
        badge_ids=[badge["id"]],
    )
    sender = make_human("Bound")
    friend = make_human("Target")
    resp = _give(client, sender, badge, token=friend.public_profile_token)
    assert resp.status_code == 403
    issuable = client.get(
        f"{BADGES}/portal/profile-issuable",
        params={"token": friend.public_profile_token},
        headers=_portal_headers(sender),
    ).json()
    assert badge["id"] not in {i["badge"]["id"] for i in issuable}


def test_profile_giving_needs_a_shared_profile_and_another_person(
    client: TestClient, headers, style, make_human
):
    badge = _badge(client, headers, style)
    _policy(
        client,
        headers,
        name="Anyone",
        audience_type="tenant",
        badge_ids=[badge["id"]],
    )
    sender = make_human("Self", username=_unique_name())
    hidden = make_human("Hidden", shared=False)

    assert (
        _give(client, sender, badge, token=hidden.public_profile_token).status_code
        == 404
    )
    assert _give(client, sender, badge, username=sender.username).status_code == 403
    own = client.get(
        f"{BADGES}/portal/profile-issuable",
        params={"username": sender.username},
        headers=_portal_headers(sender),
    )
    assert own.json() == []

    both = _give(
        client, sender, badge, username="someone", token=hidden.public_profile_token
    )
    assert both.status_code == 422
    assert _give(client, sender, badge).status_code == 422
