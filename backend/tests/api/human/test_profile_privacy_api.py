"""End-to-end checks for portal, partner, admin and scanner profile boundaries."""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.attendee.models import Attendees
from app.api.cart.models import Carts
from app.api.human.models import Humans
from app.api.payment.models import PaymentRecipients, Payments
from app.api.shared.enums import HumanRating
from app.core.security import create_access_token
from tests._flow_helpers import application_flow_id


@pytest.fixture
def private_profile(db: Session, tenant_a, popup_tenant_a):
    human = Humans(
        tenant_id=tenant_a.id,
        email=f"private-{uuid.uuid4().hex}@example.com",
        first_name="Private",
        last_name="Profile",
        rating=HumanRating.RED_FLAG,
        enriched_profile={"bio": "Internal research", "tags": ["community"]},
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    flow_id = application_flow_id(db, popup_tenant_a.id)
    app = Applications(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        sales_flow_id=flow_id,
        human_id=human.id,
        status="draft",
    )
    metadata = {
        "red_flag": True,
        "rating": "red_flag",
        "enriched_profile": human.enriched_profile,
        "dietary_notes": "vegetarian",
    }
    attendee = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        human_id=human.id,
        name="Private Profile",
        email=human.email,
        additional_data=metadata,
    )
    db.add_all([app, attendee])
    db.commit()
    db.refresh(app)
    db.refresh(attendee)
    payment = Payments(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        application_id=app.id,
        buyer_human_id=human.id,
        sales_flow_id=flow_id,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    recipient = PaymentRecipients(
        tenant_id=tenant_a.id,
        payment_id=payment.id,
        recipient_key=f"human:{human.id}",
        human_id=human.id,
        name="Private Profile",
        profile_snapshot=metadata,
    )
    cart = Carts(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        human_id=human.id,
        sales_flow_id=flow_id,
        items={
            "lines": [],
            "recipients": [
                {
                    "recipient_key": f"human:{human.id}",
                    "human_id": str(human.id),
                    "name": "Private Profile",
                    "profile_snapshot": metadata,
                }
            ],
        },
    )
    db.add_all([recipient, cart])
    db.commit()
    return human, app, attendee, recipient, cart


def auth(human, partner=False):
    return {
        "Authorization": "Bearer "
        + create_access_token(
            subject=human.id,
            token_type="human",
            issued_via="third_party" if partner else "portal",
            scopes=[
                "portal:profile:read",
                "portal:profile:write",
                "portal:applications:read",
                "portal:payments:read",
            ],
        )
    }


def assert_no_assessments(data):
    assert {"red_flag", "rating", "enriched_profile"}.isdisjoint(data)


@pytest.mark.parametrize("partner", [False, True])
def test_portal_and_partner_do_not_receive_assessments(
    client, private_profile, partner
):
    human, app, attendee, recipient, cart = private_profile
    headers = auth(human, partner)
    me = client.get("/api/v1/humans/me", headers=headers)
    assert me.status_code == 200, me.text
    assert_no_assessments(me.json())
    updated = client.patch(
        "/api/v1/humans/me",
        headers=headers,
        json={
            "first_name": "Updated",
            "rating": "star",
            "enriched_profile": {"bio": "Injected"},
        },
    )
    assert updated.status_code == 200, updated.text
    assert_no_assessments(updated.json())

    for path in [
        "/api/v1/applications/my/applications",
        f"/api/v1/applications/my/{app.popup_id}",
    ]:
        response = client.get(path, headers=headers)
        assert response.status_code == 200, response.text
        data = response.json()
        apps = data["results"] if "results" in data else [data]
        assert apps
        for item in apps:
            assert_no_assessments(item)
            assert_no_assessments(item["human"])

    response = client.get(
        f"/api/v1/attendees/my/popup/{attendee.popup_id}", headers=headers
    )
    assert response.status_code == 200, response.text
    row = next(r for r in response.json()["results"] if r["id"] == str(attendee.id))
    assert row["additional_data"] == {"dietary_notes": "vegetarian"}

    for path in [
        f"/api/v1/payments/my/{app.id}",
        f"/api/v1/payments/my/popup/{app.popup_id}",
    ]:
        response = client.get(path, headers=headers)
        assert response.status_code == 200, response.text
        row = next(
            r
            for p in response.json()["results"]
            for r in p["recipients"]
            if r["id"] == str(recipient.id)
        )
        assert row["profile_snapshot"] == {"dietary_notes": "vegetarian"}

    response = client.get(f"/api/v1/carts/my/{app.popup_id}", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["items"]["recipients"][0]["profile_snapshot"] == {
        "dietary_notes": "vegetarian"
    }

    for path in [
        f"/api/v1/humans/{human.id}",
        f"/api/v1/humans/{human.id}/enrichment-facts",
    ]:
        assert client.get(path, headers=headers).status_code == 403


def test_admin_keeps_assessments_and_reads_do_not_mutate_history(
    client, db, private_profile, admin_token_tenant_a
):
    human, app, attendee, recipient, cart = private_profile
    headers = {"Authorization": f"Bearer {admin_token_tenant_a}"}
    response = client.get(f"/api/v1/humans/{human.id}", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["red_flag"] is True
    assert response.json()["rating"] == "red_flag"
    assert response.json()["enriched_profile"] == human.enriched_profile
    response = client.get(f"/api/v1/applications/{app.id}", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["red_flag"] is True
    assert response.json()["human"]["enriched_profile"] == human.enriched_profile
    for obj in [human, attendee, recipient, cart]:
        db.refresh(obj)
    assert human.rating == HumanRating.RED_FLAG
    assert attendee.additional_data["red_flag"] is True
    assert recipient.profile_snapshot["red_flag"] is True
    assert cart.items["recipients"][0]["profile_snapshot"]["red_flag"] is True


def test_profile_update_cannot_change_assessments(client, db, private_profile):
    human, *_ = private_profile
    before = human.enriched_profile.copy()
    response = client.patch(
        "/api/v1/humans/me",
        headers=auth(human),
        json={
            "rating": "star",
            "red_flag": False,
            "enriched_profile": {"bio": "Injected"},
        },
    )
    assert response.status_code == 200, response.text
    db.refresh(human)
    assert human.rating == HumanRating.RED_FLAG
    assert human.red_flag
    assert human.enriched_profile == before


def test_scanner_does_not_receive_historical_assessments(
    client, private_profile, check_in_controller_token_tenant_a
):
    _, _, attendee, _, _ = private_profile
    headers = {"Authorization": f"Bearer {check_in_controller_token_tenant_a}"}
    response = client.get(f"/api/v1/attendees/{attendee.id}", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["additional_data"] == {"dietary_notes": "vegetarian"}
    response = client.get(
        "/api/v1/attendees",
        params={"email": attendee.email},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    row = next(r for r in response.json()["results"] if r["id"] == str(attendee.id))
    assert row["additional_data"] == {"dietary_notes": "vegetarian"}


@pytest.mark.parametrize(
    "role_fixture", ["viewer_token_tenant_a", "check_in_controller_token_tenant_a"]
)
def test_enrichment_sources_require_an_administrative_role(
    client, private_profile, request, role_fixture
):
    human, *_ = private_profile
    headers = {"Authorization": f"Bearer {request.getfixturevalue(role_fixture)}"}
    path = f"/api/v1/humans/{human.id}/enrichment-facts"
    assert client.get(path, headers=headers).status_code == 403
    assert (
        client.post(
            path,
            headers=headers,
            json={"field": "bio", "value": "Injected", "source": "manual"},
        ).status_code
        == 403
    )


@pytest.mark.parametrize(
    "scopes,can_read,can_write",
    [
        (["events:read"], False, False),
        (["humans:read"], True, False),
        (["humans:write"], False, True),
    ],
)
def test_enrichment_sources_enforce_admin_api_key_scopes(
    client, private_profile, admin_api_key_factory, scopes, can_read, can_write
):
    human, *_ = private_profile
    _, raw_key = admin_api_key_factory(scopes)
    headers = {"Authorization": f"Bearer {raw_key}"}
    path = f"/api/v1/humans/{human.id}/enrichment-facts"
    assert client.get(path, headers=headers).status_code == (200 if can_read else 403)
    response = client.post(
        path,
        headers=headers,
        json={"field": "bio", "value": "Research", "source": "manual"},
    )
    assert response.status_code == (201 if can_write else 403), response.text


def test_public_registration_ignores_client_flag(client, db, tenant_a):
    from sqlmodel import select

    email = f"registration-privacy-{uuid.uuid4().hex}@example.com"
    with (
        patch("app.api.auth.crud.is_redis_available", return_value=False),
        patch("app.api.auth.crud.check_rate_limit"),
        patch("app.api.auth.crud.generate_auth_code", return_value="123456"),
        patch(
            "app.api.auth.crud.get_email_service",
            return_value=SimpleNamespace(
                send_login_code_human=AsyncMock(return_value=True)
            ),
        ),
    ):
        response = client.post(
            "/api/v1/auth/human/login",
            json={
                "tenant_id": str(tenant_a.id),
                "email": email,
                "red_flag": True,
            },
        )
        assert response.status_code == 200, response.text
        response = client.post(
            "/api/v1/auth/human/authenticate",
            json={
                "tenant_id": str(tenant_a.id),
                "email": email,
                "code": "123456",
            },
        )
        assert response.status_code == 200, response.text
    human = db.exec(
        select(Humans).where(Humans.email == email, Humans.tenant_id == tenant_a.id)
    ).one()
    assert human.rating == HumanRating.UNRATED
    assert human.red_flag is False


def test_open_checkout_cart_filters_historical_metadata_without_rewriting_it(
    client, db, tenant_a
):
    from tests.api.checkout.test_open_cart import _make_popup

    popup = _make_popup(
        db, tenant_a, slug_prefix="privacy", signing_secret="privacy-secret"
    )
    db.commit()
    path = f"/api/v1/checkout/{popup.slug}/checkout/cart"
    metadata = {
        "rating": "red_flag",
        "red_flag": True,
        "enriched_profile": {"bio": "Internal"},
        "dietary_notes": "vegetarian",
    }
    items = {
        "lines": [],
        "recipients": [
            {
                "recipient_key": "draft:privacy",
                "name": "Buyer",
                "profile_snapshot": metadata,
            }
        ],
    }
    headers = {"X-Tenant-Id": str(tenant_a.id)}
    with patch("app.core.rate_limit.get_redis", return_value=None):
        response = client.put(
            path,
            headers=headers,
            json={"email": f"cart-{uuid.uuid4().hex}@example.com", "items": items},
        )
        assert response.status_code == 200, response.text
        created = response.json()
        assert created["items"]["recipients"][0]["profile_snapshot"] == {
            "dietary_notes": "vegetarian"
        }
        cart = db.get(Carts, uuid.UUID(created["id"]))
        assert cart.items["recipients"][0]["profile_snapshot"] == {
            "dietary_notes": "vegetarian"
        }
        # Simulate a pre-fix cart using canonical historical data.
        cart.items = items
        db.add(cart)
        db.commit()
        response = client.get(
            path,
            headers=headers,
            params={"cid": created["id"], "sig": created["restore_token"]},
        )
        assert response.status_code == 200, response.text
        assert response.json()["items"]["recipients"][0]["profile_snapshot"] == {
            "dietary_notes": "vegetarian"
        }
        db.refresh(cart)
        assert cart.items["recipients"][0]["profile_snapshot"]["red_flag"] is True


def test_enrichment_admin_keys_cannot_cross_tenants(
    client, db, tenant_b, admin_api_key_factory
):
    human = Humans(
        tenant_id=tenant_b.id, email=f"other-private-{uuid.uuid4().hex}@example.com"
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    _, key = admin_api_key_factory(["humans:read", "humans:write"])
    headers = {"Authorization": f"Bearer {key}"}
    path = f"/api/v1/humans/{human.id}/enrichment-facts"
    assert client.get(path, headers=headers).status_code == 404
    assert (
        client.post(
            path,
            headers=headers,
            json={"field": "bio", "value": "Injected", "source": "manual"},
        ).status_code
        == 404
    )


def test_group_leader_errors_do_not_disclose_another_persons_flag(
    client, db, private_profile, tenant_a, popup_tenant_a
):
    from app.api.group.models import GroupLeaders
    from tests.api.group.test_group_flags import _make_group

    human, *_ = private_profile
    leader = Humans(
        tenant_id=tenant_a.id, email=f"leader-private-{uuid.uuid4().hex}@example.com"
    )
    db.add(leader)
    db.commit()
    db.refresh(leader)
    group = _make_group(db, tenant_a, popup_tenant_a)
    db.add(GroupLeaders(tenant_id=tenant_a.id, group_id=group.id, human_id=leader.id))
    db.commit()
    headers = auth(leader)
    path = f"/api/v1/groups/my/{group.id}/members"
    response = client.post(path, headers=headers, json={"email": human.email})
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "This person cannot be added to the group."
    response = client.post(
        path + "/batch",
        headers=headers,
        json={
            "members": [
                {
                    "email": human.email,
                    "first_name": "Private",
                    "last_name": "Profile",
                }
            ]
        },
    )
    assert response.status_code == 207, response.text
    assert response.json()[0]["err_msg"] == "This person cannot be added to the group."
