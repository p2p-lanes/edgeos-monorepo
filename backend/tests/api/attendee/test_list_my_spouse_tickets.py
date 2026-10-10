"""Personal ticket reads include unclaimed spouse recipients, not a buyer's party."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.attendee.crud import attendees_crud
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.check_in.models import CheckIn
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from tests._flow_helpers import provision_default_flow
from tests.api.attendee.test_list_my_tickets import (
    _auth,
    _make_app_attendee,
    _make_human,
    _make_popup,
)

ENDPOINT = "/api/v1/applications/my/tickets"


def _spouse(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    recipient: Humans,
    *,
    human_id: uuid.UUID | None = None,
    application_id: uuid.UUID | None = None,
    manager_id: uuid.UUID | None = None,
) -> Attendees:
    flow = provision_default_flow(db, popup)
    category = db.exec(
        select(AttendeeCategories).where(
            AttendeeCategories.sales_flow_id == flow.id,
            AttendeeCategories.key == "spouse",
        )
    ).first()
    if category is None:
        category = AttendeeCategories(
            tenant_id=tenant.id,
            popup_id=popup.id,
            sales_flow_id=flow.id,
            key="spouse",
            is_primary=False,
        )
        db.add(category)
        db.flush()
    attendee = Attendees(
        tenant_id=tenant.id,
        popup_id=popup.id,
        application_id=application_id,
        human_id=human_id,
        managed_by_human_id=manager_id,
        email=recipient.email,
        name="Spouse recipient",
        category_id=category.id,
    )
    db.add(attendee)
    db.flush()
    return attendee


def _units(
    db: Session,
    attendee: Attendees,
    *,
    category: str = "ticket",
    count: int = 1,
    revoked: bool = False,
) -> Products:
    product = Products(
        tenant_id=attendee.tenant_id,
        popup_id=attendee.popup_id,
        name=f"Spouse {category}",
        slug=f"spouse-product-{uuid.uuid4().hex[:8]}",
        category=category,
        price=Decimal("10"),
        requires_check_in=category == "ticket",
    )
    db.add(product)
    db.flush()
    for _ in range(count):
        db.add(
            AttendeeProducts(
                tenant_id=attendee.tenant_id,
                attendee_id=attendee.id,
                product_id=product.id,
                product_category_snapshot=category,
                requires_check_in_snapshot=category == "ticket",
                check_in_code=uuid.uuid4().hex[:10],
                revoked_at=datetime.now(UTC) if revoked else None,
            )
        )
    db.flush()
    return product


@pytest.mark.parametrize("linked", [False, True])
@pytest.mark.parametrize("application_linked", [False, True])
def test_spouse_reads_ticket_bought_by_partner(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    linked: bool,
    application_linked: bool,
) -> None:
    popup = _make_popup(db, tenant_a, suffix="spouse")
    recipient = _make_human(db, tenant_a, suffix="recipient")
    buyer = _make_human(db, tenant_a, suffix="buyer")
    # Reproduce Jon: accepted application with a linked but ticketless main row.
    _, main = _make_app_attendee(db, tenant_a, popup, recipient)
    buyer_app, _ = _make_app_attendee(db, tenant_a, popup, buyer)
    spouse = _spouse(
        db,
        tenant_a,
        popup,
        recipient,
        human_id=recipient.id if linked else None,
        application_id=buyer_app.id if application_linked else None,
        manager_id=buyer.id,
    )
    ticket_product = _units(db, spouse, count=2)
    active_units = db.exec(
        select(AttendeeProducts).where(
            AttendeeProducts.attendee_id == spouse.id,
            AttendeeProducts.product_id == ticket_product.id,
        )
    ).all()
    scanned_at = datetime.now(UTC)
    db.add(
        CheckIn(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            attendee_product_id=active_units[0].id,
            occurred_at=scanned_at,
        )
    )
    # QR eligibility belongs to the purchased unit, not mutable catalog state.
    ticket_product.requires_check_in = False
    db.add(ticket_product)
    _units(db, spouse, revoked=True)
    _units(db, spouse, category="parking")
    db.commit()
    original_updated_at = spouse.updated_at

    response = client.get(ENDPOINT, headers=_auth(recipient))

    assert response.status_code == 200, response.text
    rows = {row["id"]: row for row in response.json()}
    assert rows[str(main.id)]["products"] == []
    tickets = rows[str(spouse.id)]
    assert tickets["popup_id"] == str(popup.id)
    assert tickets["popup_slug"] == popup.slug
    assert tickets["category"] == spouse.category
    assert tickets["products"] == [
        {
            "name": "Spouse ticket",
            "category": "ticket",
            "quantity": 2,
            "start_date": None,
            "end_date": None,
        }
    ]
    assert len(tickets["tickets"]) == 2
    details = {unit["id"]: unit for unit in tickets["tickets"]}
    for unit in active_units:
        detail = details[str(unit.id)]
        assert detail["attendee_id"] == str(spouse.id)
        assert detail["check_in_code"] == unit.check_in_code
        assert detail["requires_check_in"] is True
        assert detail["product_category_snapshot"] == "ticket"
        assert detail["product_name"] == "Spouse ticket"
    assert (
        datetime.fromisoformat(
            details[str(active_units[0].id)]["last_scan_at"].replace("Z", "+00:00")
        )
        == scanned_at
    )
    assert details[str(active_units[1].id)]["last_scan_at"] is None
    if not linked:
        denied_edit = client.patch(
            f"/api/v1/attendees/my/popup/{popup.id}/{spouse.id}",
            headers=_auth(recipient),
            json={"name": "Email matching must not authorize this edit"},
        )
        assert denied_edit.status_code == 404

    # Reading the fallback must not claim the row or change management.
    db.refresh(spouse)
    assert spouse.human_id == (recipient.id if linked else None)
    assert spouse.managed_by_human_id == buyer.id
    assert spouse.updated_at == original_updated_at


def test_email_fallback_is_normalized_but_never_overrides_another_human(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, suffix="normalized")
    human = _make_human(db, tenant_a, suffix="normalized")
    other = _make_human(db, tenant_a, suffix="other")
    unlinked = _spouse(db, tenant_a, popup, human)
    unlinked.email = f"  {human.email.upper()}  "
    assigned_to_other = _spouse(db, tenant_a, popup, human, human_id=other.id)
    _units(db, unlinked)
    _units(db, assigned_to_other)
    db.commit()

    response = client.get(ENDPOINT, headers=_auth(human))

    assert response.status_code == 200, response.text
    assert [row["id"] for row in response.json()] == [str(unlinked.id)]


def test_buyer_does_not_receive_unlinked_partner_tickets_by_management(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, suffix="personal-only")
    buyer = _make_human(db, tenant_a, suffix="personal-buyer")
    recipient = _make_human(db, tenant_a, suffix="personal-recipient")
    application, main = _make_app_attendee(db, tenant_a, popup, buyer)
    spouse = _spouse(
        db,
        tenant_a,
        popup,
        recipient,
        application_id=application.id,
        manager_id=buyer.id,
    )
    _units(db, spouse)
    db.commit()

    # Supplying someone else's email must not influence the identity lookup.
    response = client.get(
        ENDPOINT, headers=_auth(buyer), params={"email": recipient.email}
    )

    assert response.status_code == 200, response.text
    assert [row["id"] for row in response.json()] == [str(main.id)]


def test_email_fallback_is_explicitly_tenant_scoped(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    tenant_b: Tenants,
) -> None:
    human = _make_human(db, tenant_a, suffix="tenant-scope")
    popup = _make_popup(db, tenant_a, suffix="tenant-scope")
    foreign_popup = _make_popup(db, tenant_b, suffix="tenant-scope")
    own = _spouse(db, tenant_a, popup, human)
    foreign = _spouse(db, tenant_b, foreign_popup, human)
    _units(db, own)
    _units(db, foreign)
    db.commit()

    # Check with an unrestricted session as well as HTTP/RLS: the SQL itself
    # must not rely on RLS to exclude a matching recipient in another tenant.
    attendees = attendees_crud.find_ticket_attendees_for_human(
        db, human_id=human.id, tenant_id=tenant_a.id, email=human.email
    )
    assert [attendee.id for attendee in attendees] == [own.id]
    response = client.get(ENDPOINT, headers=_auth(human))
    assert response.status_code == 200, response.text
    assert [row["id"] for row in response.json()] == [str(own.id)]


@pytest.mark.parametrize("allowed_scope", [False, True])
def test_third_party_sessions_keep_ticket_read_scope_enforcement(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    third_party_jwt_factory,
    allowed_scope: bool,
) -> None:
    human = _make_human(db, tenant_a, suffix="third-party")
    popup = _make_popup(db, tenant_a, suffix="third-party")
    spouse = _spouse(db, tenant_a, popup, human)
    _units(db, spouse)
    db.commit()
    token = third_party_jwt_factory(
        human=human, scopes=["portal:applications:read"] if allowed_scope else []
    )

    response = client.get(ENDPOINT, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == (200 if allowed_scope else 403), response.text
    if allowed_scope:
        assert [row["id"] for row in response.json()] == [str(spouse.id)]


def test_ticket_read_requires_authentication(client: TestClient) -> None:
    response = client.get(ENDPOINT)
    assert response.status_code == 401, response.text
