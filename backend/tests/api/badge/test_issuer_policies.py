"""SIM-108 phase 2: issuer policies, allowances and peer badge sending."""

import threading
import time
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.badge import policies
from app.api.badge.models import BadgeAwards, Badges
from app.api.badge.schemas import AllowanceWindow
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token
from app.core.tenant_db import ensure_tenant_credentials

BADGES = "/api/v1/badges"
POLICIES = "/api/v1/badge-issuer-policies"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Window math
# ---------------------------------------------------------------------------


def test_day_window_follows_the_popup_calendar():
    tz = ZoneInfo("America/Argentina/Buenos_Aires")  # UTC-3, no DST
    # 02:00 UTC on Oct 5 is still Oct 4 in Buenos Aires.
    now = datetime(2026, 10, 5, 2, 0, tzinfo=UTC)
    start, resets = policies.window_bounds(AllowanceWindow.DAY, tz, now)
    assert start == datetime(2026, 10, 4, 3, 0, tzinfo=UTC)
    assert resets == datetime(2026, 10, 5, 3, 0, tzinfo=UTC)


def test_week_window_starts_on_monday():
    tz = ZoneInfo("UTC")
    now = datetime(2026, 10, 8, 12, 0, tzinfo=UTC)  # Thursday
    start, resets = policies.window_bounds(AllowanceWindow.WEEK, tz, now)
    assert start == datetime(2026, 10, 5, tzinfo=UTC)
    assert resets == datetime(2026, 10, 12, tzinfo=UTC)


def test_day_window_across_a_dst_change_is_23_hours():
    tz = ZoneInfo("Europe/Madrid")  # clocks jump forward on 2026-03-29
    now = datetime(2026, 3, 29, 12, 0, tzinfo=UTC)
    start, resets = policies.window_bounds(AllowanceWindow.DAY, tz, now)
    assert (resets - start).total_seconds() == 23 * 3600


def test_popup_and_lifetime_windows_never_reset():
    for window in (AllowanceWindow.POPUP, AllowanceWindow.LIFETIME):
        assert policies.window_bounds(window, ZoneInfo("UTC"), datetime.now(UTC)) == (
            None,
            None,
        )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def tenant(db: Session) -> Tenants:
    suffix = uuid.uuid4().hex[:8]
    tenant = Tenants(name=f"Peer badges {suffix}", slug=f"peer-badges-{suffix}")
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    ensure_tenant_credentials(db, tenant.id)
    return tenant


@pytest.fixture(scope="module")
def headers(db: Session, tenant: Tenants) -> dict[str, str]:
    admin = Users(
        email=f"peer-admin-{uuid.uuid4().hex[:8]}@test.com",
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


@pytest.fixture(scope="module")
def popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id, name="Peer fest", slug=f"peer-{uuid.uuid4().hex[:8]}"
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


@pytest.fixture(scope="module")
def ticket(db: Session, tenant: Tenants, popup: Popups) -> Products:
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name="Full pass",
        slug=f"pass-{uuid.uuid4().hex[:6]}",
        price=Decimal("10"),
        category="ticket",
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


class Person:
    def __init__(self, human: Humans, attendee: Attendees | None) -> None:
        self.human = human
        self.attendee = attendee
        self.headers = _auth(
            create_access_token(
                subject=human.id, token_type="human", issued_via="portal"
            )
        )


@pytest.fixture
def person(db: Session, tenant: Tenants, popup: Popups, ticket: Products):
    """Factory: a human, optionally holding a ticket for the popup."""

    def _make(name: str = "Pat", *, with_ticket: bool = True) -> Person:
        human = Humans(
            tenant_id=tenant.id,
            email=f"{name.lower()}-{uuid.uuid4().hex[:8]}@test.com",
            first_name=name,
            last_name="Tester",
        )
        db.add(human)
        db.commit()
        db.refresh(human)
        attendee = Attendees(
            tenant_id=tenant.id,
            popup_id=popup.id,
            human_id=human.id,
            name=name,
            category="main",
        )
        db.add(attendee)
        db.commit()
        db.refresh(attendee)
        if with_ticket:
            db.add(
                AttendeeProducts(
                    tenant_id=tenant.id,
                    attendee_id=attendee.id,
                    product_id=ticket.id,
                    check_in_code=f"PB{uuid.uuid4().hex[:6].upper()}",
                    product_category_snapshot="ticket",
                )
            )
            db.commit()
        return Person(human, attendee)

    return _make


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


def _policy(client: TestClient, headers, **body) -> dict:
    resp = client.post(POLICIES, json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _send(client: TestClient, sender: Person, recipient: Person, badge, popup, **kw):
    return client.post(
        f"{BADGES}/portal/awards",
        json={
            "badge_id": badge["id"],
            "popup_id": str(popup.id),
            "attendee_id": str(recipient.attendee.id),
            **kw,
        },
        headers=sender.headers,
    )


# ---------------------------------------------------------------------------
# Policy CRUD
# ---------------------------------------------------------------------------


def test_policy_shape_is_validated(client: TestClient, headers, style):
    badge = _badge(client, headers, style)
    resp = client.post(
        POLICIES,
        json={
            "name": "Attendees",
            "audience_type": "popup_attendees",
            "badge_ids": [badge["id"]],
        },
        headers=headers,
    )
    assert resp.status_code == 422


def test_policy_crud(client: TestClient, headers, style, person, popup):
    badge = _badge(client, headers, style, name="Sauna")
    regular = person("Sauna")
    policy = _policy(
        client,
        headers,
        name="Sauna regulars",
        audience_type="humans",
        badge_ids=[badge["id"]],
        human_ids=[str(regular.human.id)],
        allowance_quantity=3,
        allowance_window="week",
    )
    assert [h["id"] for h in policy["humans"]] == [str(regular.human.id)]
    assert [b["id"] for b in policy["badges"]] == [badge["id"]]

    listed = client.get(POLICIES, params={"badge_id": badge["id"]}, headers=headers)
    assert [p["id"] for p in listed.json()] == [policy["id"]]

    # Switching to a non-list audience drops the people list.
    resp = client.patch(
        f"{POLICIES}/{policy['id']}",
        json={"audience_type": "popup_attendees", "popup_id": str(popup.id)},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["humans"] == []

    resp = client.patch(
        f"{POLICIES}/{policy['id']}",
        json={"allowance_window": "popup", "popup_id": None},
        headers=headers,
    )
    assert resp.status_code == 422

    assert (
        client.delete(f"{POLICIES}/{policy['id']}", headers=headers).status_code == 204
    )
    assert client.get(f"{POLICIES}/{policy['id']}", headers=headers).status_code == 404


# ---------------------------------------------------------------------------
# Peer sending
# ---------------------------------------------------------------------------


def test_listed_humans_send_within_their_allowance(
    client: TestClient, headers, style, person, popup
):
    badge = _badge(client, headers, style, name="Gold star")
    sender, recipient, outsider = person("Ana"), person("Ben"), person("Out")
    _policy(
        client,
        headers,
        name="Stars",
        audience_type="humans",
        badge_ids=[badge["id"]],
        human_ids=[str(sender.human.id)],
        allowance_quantity=2,
        allowance_window="day",
    )

    issuable = client.get(
        f"{BADGES}/portal/issuable",
        params={"popup_id": str(popup.id)},
        headers=sender.headers,
    ).json()
    [entry] = [i for i in issuable if i["badge"]["id"] == badge["id"]]
    assert entry["remaining"] == 2 and entry["resets_at"] is not None

    for _ in range(2):
        resp = _send(client, sender, recipient, badge, popup, message="Thanks!")
        assert resp.status_code == 201, resp.text
    assert resp.json()["recipient_name"] == "Ben Tester"
    third = _send(client, sender, recipient, badge, popup)
    assert third.status_code == 429
    assert "X-Allowance-Resets-At" in third.headers

    assert _send(client, outsider, recipient, badge, popup).status_code == 403
    assert _send(client, sender, sender, badge, popup).status_code == 403

    # The recipient sees who sent it; the sender sees what they sent.
    mine = client.get(f"{BADGES}/portal/me", headers=recipient.headers).json()
    [star] = [m for m in mine if m["badge"]["id"] == badge["id"]]
    assert star["count"] == 2
    assert {a["issuer_name"] for a in star["awards"]} == {"Ana Tester"}
    sent = client.get(f"{BADGES}/portal/sent", headers=sender.headers).json()
    assert len(sent) == 2


def test_issuable_flags_unique_badges_the_recipient_already_holds(
    client: TestClient, headers, style, person, popup
):
    unique = _badge(client, headers, style, repeatable=False)
    star = _badge(client, headers, style)
    sender, recipient = person("Gil"), person("Hal")
    _policy(
        client,
        headers,
        name="Mixed",
        audience_type="humans",
        badge_ids=[unique["id"], star["id"]],
        human_ids=[str(sender.human.id)],
    )

    def flags(attendee_id: str | None) -> dict[str, bool]:
        params = {"popup_id": str(popup.id)}
        if attendee_id:
            params["attendee_id"] = attendee_id
        items = client.get(
            f"{BADGES}/portal/issuable", params=params, headers=sender.headers
        ).json()
        return {
            i["badge"]["id"]: i["recipient_has_it"]
            for i in items
            if i["badge"]["id"] in (unique["id"], star["id"])
        }

    attendee = str(recipient.attendee.id)
    assert flags(attendee) == {unique["id"]: False, star["id"]: False}
    for badge in (unique, star):
        assert _send(client, sender, recipient, badge, popup).status_code == 201
    # Repeatable badges can always be sent again, so only the unique one is flagged.
    assert flags(attendee) == {unique["id"]: True, star["id"]: False}
    assert flags(None) == {unique["id"]: False, star["id"]: False}
    assert _send(client, sender, recipient, unique, popup).status_code == 409


def test_recipient_must_hold_a_ticket(
    client: TestClient, headers, style, person, popup
):
    badge = _badge(client, headers, style)
    sender, no_ticket = person("Cy"), person("Dee", with_ticket=False)
    _policy(
        client,
        headers,
        name="Everyone",
        audience_type="tenant",
        badge_ids=[badge["id"]],
    )
    assert _send(client, sender, no_ticket, badge, popup).status_code == 404


def test_popup_attendee_audience_requires_a_ticket(
    client: TestClient, headers, style, person, popup
):
    badge = _badge(client, headers, style)
    _policy(
        client,
        headers,
        name="Attendees",
        audience_type="popup_attendees",
        popup_id=str(popup.id),
        badge_ids=[badge["id"]],
    )
    attendee, visitor, recipient = (
        person("Eve"),
        person("Fay", with_ticket=False),
        person("Gus"),
    )
    assert _send(client, attendee, recipient, badge, popup).status_code == 201
    assert _send(client, visitor, recipient, badge, popup).status_code == 403


def test_allowance_is_shared_across_a_policys_badges_and_refunded_on_revoke(
    client: TestClient, headers, style, person, popup
):
    thanks = _badge(client, headers, style, name="Thanks")
    kudos = _badge(client, headers, style, name="Kudos")
    sender, recipient = person("Hal"), person("Ivy")
    _policy(
        client,
        headers,
        name="Kudos pool",
        audience_type="humans",
        badge_ids=[thanks["id"], kudos["id"]],
        human_ids=[str(sender.human.id)],
        allowance_quantity=1,
        allowance_window="lifetime",
    )
    first = _send(client, sender, recipient, thanks, popup)
    assert first.status_code == 201
    assert _send(client, sender, recipient, kudos, popup).status_code == 429

    issuable = client.get(
        f"{BADGES}/portal/issuable",
        params={"popup_id": str(popup.id)},
        headers=sender.headers,
    ).json()
    pool = {thanks["id"], kudos["id"]}
    assert {
        i["badge"]["name"]: i["remaining"] for i in issuable if i["badge"]["id"] in pool
    } == {
        "Kudos": 0,
        "Thanks": 0,
    }

    revoke = client.post(
        f"{BADGES}/awards/{first.json()['id']}/revoke", json={}, headers=headers
    )
    assert revoke.status_code == 200
    assert _send(client, sender, recipient, kudos, popup).status_code == 201


def test_overlapping_policies_add_up(client: TestClient, headers, style, person, popup):
    badge = _badge(client, headers, style)
    sender, recipient = person("Jo"), person("Kai")
    for name in ("Hosts", "Volunteers"):
        _policy(
            client,
            headers,
            name=name,
            audience_type="humans",
            badge_ids=[badge["id"]],
            human_ids=[str(sender.human.id)],
            allowance_quantity=1,
            allowance_window="day",
        )
    assert _send(client, sender, recipient, badge, popup).status_code == 201
    assert _send(client, sender, recipient, badge, popup).status_code == 201
    assert _send(client, sender, recipient, badge, popup).status_code == 429


def test_concurrent_sends_cannot_exceed_the_allowance(
    client: TestClient, test_engine, headers, style, person, popup, tenant
):
    """A send waits on the issuer's row lock, then sees the other's award."""
    badge = _badge(client, headers, style)
    sender, recipient = person("Lu"), person("Max")
    policy = _policy(
        client,
        headers,
        name="One shot",
        audience_type="humans",
        badge_ids=[badge["id"]],
        human_ids=[str(sender.human.id)],
        allowance_quantity=1,
        allowance_window="lifetime",
    )
    outcome: dict[str, object] = {}

    def second_send() -> None:
        with Session(test_engine) as b:
            try:
                policies.award_as_human(
                    b,
                    issuer_id=sender.human.id,
                    badge=b.get(Badges, uuid.UUID(badge["id"])),
                    recipient=b.get(Humans, recipient.human.id),
                    popup_id=popup.id,
                    message=None,
                )
                outcome["result"] = "awarded"
            except policies.AllowanceExhaustedError:
                outcome["result"] = "exhausted"

    with Session(test_engine) as a:
        a.exec(
            select(Humans).where(Humans.id == sender.human.id).with_for_update()
        ).one()
        thread = threading.Thread(target=second_send)
        thread.start()
        time.sleep(0.5)
        assert thread.is_alive(), "the second send should wait on the lock"
        a.add(
            BadgeAwards(
                tenant_id=tenant.id,
                badge_id=uuid.UUID(badge["id"]),
                recipient_human_id=recipient.human.id,
                issuer_type="human",
                issuer_human_id=sender.human.id,
                popup_id=popup.id,
                policy_id=uuid.UUID(policy["id"]),
                is_unique=False,
            )
        )
        a.commit()
    thread.join(10)
    assert outcome["result"] == "exhausted"


# ---------------------------------------------------------------------------
# Emails audience
# ---------------------------------------------------------------------------


def test_emails_audience_matches_by_email_including_later_sign_ups(
    client: TestClient, db: Session, headers, style, person, popup
):
    badge = _badge(client, headers, style)
    sender, recipient, outsider = person("Eve"), person("Fay"), person("Gus")
    tag = uuid.uuid4().hex[:8]
    later_email = f"later-{tag}@test.com"
    policy = _policy(
        client,
        headers,
        name="Crew",
        audience_type="emails",
        badge_ids=[badge["id"]],
        # Case and spacing don't matter; duplicates collapse.
        emails=[f"  {sender.human.email.upper()} ", sender.human.email, later_email],
    )
    assert policy["emails"] == [sender.human.email.lower(), later_email]

    assert _send(client, sender, recipient, badge, popup).status_code == 201
    assert _send(client, outsider, recipient, badge, popup).status_code == 403

    # Someone on the list who signs up afterwards can give it right away.
    newcomer = person("Hal")
    newcomer.human.email = later_email
    db.add(newcomer.human)
    db.commit()
    assert _send(client, newcomer, recipient, badge, popup).status_code == 201

    # Switching to another audience drops the list.
    resp = client.patch(
        f"{POLICIES}/{policy['id']}",
        json={"audience_type": "tenant"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["emails"] == []


def test_emails_audience_validation(client: TestClient, headers, style):
    badge = _badge(client, headers, style)
    base = {"name": "Crew", "audience_type": "emails", "badge_ids": [badge["id"]]}
    assert client.post(POLICIES, json=base, headers=headers).status_code == 422
    bad = client.post(
        POLICIES, json={**base, "emails": ["ok@test.com", "nope"]}, headers=headers
    )
    assert bad.status_code == 422
    assert "nope" in bad.text

    policy = _policy(client, headers, **{**base, "emails": ["ok@test.com"]})
    emptied = client.patch(
        f"{POLICIES}/{policy['id']}", json={"emails": []}, headers=headers
    )
    assert emptied.status_code == 422
