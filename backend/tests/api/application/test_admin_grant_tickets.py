"""Backoffice grants assign products to people without purchase or flow lineage."""

import importlib
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session, func, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.audit_log.constants import AuditAction
from app.api.audit_log.models import AuditLog
from app.api.human.models import Humans
from app.api.payment.models import PaymentProducts, Payments
from app.api.popup.models import Popups
from app.api.product.crud import products_crud
from app.api.product.models import Products
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token
from tests._flow_helpers import application_flow_id, provision_default_flow

URL = "/api/v1/applications/admin/grant-tickets"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _person(email: str, product: Products, quantity: int = 1, **names) -> dict:
    return {
        "email": email,
        "products": [{"product_id": str(product.id), "quantity": quantity}],
        **names,
    }


def _product(db: Session, popup: Popups, category: str = "ticket", stock: int = 5):
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"Grant {category}",
        slug=f"grant-{uuid.uuid4().hex}",
        price=Decimal("50"),
        category=category,
        requires_check_in=category == "ticket",
        total_stock_cap=stock,
        total_stock_remaining=stock,
    )
    db.add(product)
    db.commit()
    return product


def _units(db: Session, attendee_id: uuid.UUID) -> list[AttendeeProducts]:
    return list(
        db.exec(
            select(AttendeeProducts).where(AttendeeProducts.attendee_id == attendee_id)
        ).all()
    )


@pytest.fixture()
def grant_popup(db: Session, tenant_a: Tenants) -> Popups:
    """Deliberately has no sales flow, default flow or attendee categories."""
    popup = Popups(
        tenant_id=tenant_a.id,
        name="Manual assignments",
        slug=f"manual-{uuid.uuid4().hex}",
    )
    db.add(popup)
    db.commit()
    return popup


@pytest.fixture()
def payment_email(monkeypatch) -> AsyncMock:
    mock = AsyncMock()
    monkeypatch.setattr(
        importlib.import_module("app.api.payment.router"),
        "_send_payment_confirmed_email",
        mock,
    )
    return mock


@pytest.mark.parametrize(
    "category", ["ticket", "meal_plan", "housing", "merch", "patreon"]
)
def test_grant_without_flow_creates_only_attendee_units_and_audit(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    admin_user_tenant_a: Users,
    grant_popup: Popups,
    payment_email: AsyncMock,
    category: str,
) -> None:
    product = _product(db, grant_popup, category)
    email = f"grant-{uuid.uuid4().hex}@test.com"
    response = client.post(
        URL,
        headers=_auth(admin_token_tenant_a),
        json={
            "popup_id": str(grant_popup.id),
            "people": [
                _person(email, product, 2, first_name="New", last_name="Person")
            ],
        },
    )
    assert response.status_code == 201, response.text
    result = response.json()["granted"][0]
    assert result["tickets_created"] == 2
    assert "payment_id" not in result
    assert "application_id" not in result
    attendee = db.get(Attendees, uuid.UUID(result["attendee_id"]))
    assert attendee.name == "New Person"
    assert attendee.application_id is None
    assert attendee.category_id is None
    assert str(attendee.human_id) == result["human_id"]
    assert attendee.email == email
    units = _units(db, attendee.id)
    assert len(units) == 2
    assert len({unit.check_in_code for unit in units}) == 2
    assert {
        (unit.payment_id, unit.payment_product_id, unit.unit_index) for unit in units
    } == {(None, None, None)}
    assert {unit.product_category_snapshot for unit in units} == {category}
    assert {unit.requires_check_in_snapshot for unit in units} == {
        product.requires_check_in
    }
    for model in (Applications, Payments, SalesFlows):
        assert (
            db.exec(select(model).where(model.popup_id == grant_popup.id)).all() == []
        )
    assert (
        db.exec(
            select(PaymentProducts).where(PaymentProducts.product_id == product.id)
        ).all()
        == []
    )
    payment_email.assert_not_awaited()
    audit = db.exec(
        select(AuditLog).where(
            AuditLog.entity_id == attendee.id,
            AuditLog.action == AuditAction.TICKET_GRANT,
        )
    ).one()
    assert audit.actor_id == admin_user_tenant_a.id
    assert audit.details["tickets_created"] == 2
    assert "payment_id" not in audit.details
    db.refresh(product)
    assert product.total_stock_remaining == 3

    # Bulk grants have the same removal semantics as assignments from Edit attendee.
    removed = client.delete(
        f"/api/v1/attendees/{attendee.id}/tickets/{units[0].id}",
        headers=_auth(admin_token_tenant_a),
    )
    assert removed.status_code == 200, removed.text
    assert len(removed.json()["products"]) == 1
    db.refresh(product)
    assert product.total_stock_remaining == 4


def test_new_bulk_invitee_can_log_in_and_read_ticket_with_only_application_flow(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    grant_popup: Popups,
    monkeypatch,
) -> None:
    grant_popup.status = "active"
    db.add(grant_popup)
    provision_default_flow(db, grant_popup, sale_type="application")
    flows = db.exec(
        select(SalesFlows).where(SalesFlows.popup_id == grant_popup.id)
    ).all()
    assert [flow.type for flow in flows] == ["application"]
    product = _product(db, grant_popup)
    email = f"first-login-{uuid.uuid4().hex}@test.com"
    assert db.exec(select(Humans).where(Humans.email == email)).first() is None

    grant = client.post(
        URL,
        headers=_auth(admin_token_tenant_a),
        json={"popup_id": str(grant_popup.id), "people": [_person(email, product)]},
    )
    assert grant.status_code == 201, grant.text
    recipient = grant.json()["granted"][0]

    # Exercise real login and OTP verification against the Human created by the grant.
    auth_crud = importlib.import_module("app.api.auth.crud")
    email_service = AsyncMock()
    monkeypatch.setattr(auth_crud, "get_email_service", lambda: email_service)
    monkeypatch.setattr(auth_crud, "is_redis_available", lambda: False)
    credentials = {"tenant_id": str(grant_popup.tenant_id), "email": email.upper()}
    login = client.post("/api/v1/auth/human/login", json=credentials)
    assert login.status_code == 200, login.text
    sent_code = email_service.send_login_code_human.call_args.kwargs[
        "context"
    ].auth_code
    authenticated = client.post(
        "/api/v1/auth/human/authenticate", json={**credentials, "code": sent_code}
    )
    assert authenticated.status_code == 200, authenticated.text
    headers = _auth(authenticated.json()["access_token"])
    profile = client.get("/api/v1/humans/me", headers=headers)
    assert profile.status_code == 200
    assert profile.json()["id"] == recipient["human_id"]

    popups = client.get("/api/v1/popups/portal/list", headers=headers)
    assert popups.status_code == 200
    popup = next(p for p in popups.json() if p["id"] == str(grant_popup.id))
    assert popup["takes_applications"] is True
    assert popup["sells_directly"] is False
    access_url = f"/api/v1/portal/popup/{grant_popup.id}/access"
    access = client.get(access_url, headers=headers)
    assert access.status_code == 200
    assert access.json()["allowed"] is True
    assert access.json()["source"] == "attendee"

    tickets_url = f"/api/v1/attendees/my/popup/{grant_popup.id}"
    attendees = client.get(tickets_url, headers=headers)
    assert attendees.status_code == 200
    attendee = attendees.json()["results"][0]
    assert attendee["id"] == recipient["attendee_id"]
    assert attendee["application_id"] is None
    ticket = attendee["products"][0]
    assert ticket["product_id"] == str(product.id)
    assert ticket["payment_id"] is None
    assert ticket["check_in_code"]
    assert ticket["requires_check_in"] is True
    for model in (Applications, Payments):
        assert (
            db.exec(select(model).where(model.popup_id == grant_popup.id)).all() == []
        )

    removed = client.delete(
        f"/api/v1/attendees/{attendee['id']}/tickets/{ticket['id']}",
        headers=_auth(admin_token_tenant_a),
    )
    assert removed.status_code == 200
    assert client.get(access_url, headers=headers).json()["allowed"] is False
    assert (
        client.get(tickets_url, headers=headers).json()["results"][0]["products"] == []
    )


def test_bulk_invitee_can_submit_application_without_changing_manual_tickets(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    grant_popup: Popups,
    monkeypatch,
) -> None:
    grant_popup.status = "active"
    db.add(grant_popup)
    flow = provision_default_flow(db, grant_popup, sale_type="application")
    product = _product(db, grant_popup)
    email = f"apply-after-grant-{uuid.uuid4().hex}@test.com"
    grant = client.post(
        URL,
        headers=_auth(admin_token_tenant_a),
        json={"popup_id": str(grant_popup.id), "people": [_person(email, product)]},
    )
    assert grant.status_code == 201, grant.text
    recipient = grant.json()["granted"][0]
    human_id = uuid.UUID(recipient["human_id"])
    attendee_id = uuid.UUID(recipient["attendee_id"])
    headers = _auth(create_access_token(subject=human_id, token_type="human"))
    ticket = _units(db, attendee_id)[0]
    identity = (ticket.id, ticket.check_in_code, ticket.product_id)
    application_router = importlib.import_module("app.api.application.router")
    monkeypatch.setattr(
        application_router, "send_application_status_email", AsyncMock()
    )

    draft = client.post(
        "/api/v1/applications/my",
        headers=headers,
        json={
            "popup_id": str(grant_popup.id),
            "sales_flow_id": str(flow.id),
            "first_name": "Invited",
            "last_name": "Person",
            "status": "draft",
        },
    )
    assert draft.status_code == 201, draft.text
    application_id = uuid.UUID(draft.json()["id"])
    assert draft.json()["sales_flow_id"] == str(flow.id)
    draft_access = client.get(
        f"/api/v1/portal/popup/{grant_popup.id}/access", headers=headers
    )
    assert draft_access.json()["allowed"] is True
    submitted = client.patch(
        f"/api/v1/applications/my/{grant_popup.id}",
        params={"sales_flow_id": str(flow.id)},
        headers=headers,
        json={"status": "in review"},
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["status"] == "accepted"

    db.expire_all()
    attendees = db.exec(
        select(Attendees).where(
            Attendees.human_id == human_id, Attendees.popup_id == grant_popup.id
        )
    ).all()
    assert [(row.id, row.application_id) for row in attendees] == [
        (attendee_id, application_id)
    ]
    preserved = _units(db, attendee_id)
    assert [(unit.id, unit.check_in_code, unit.product_id) for unit in preserved] == [
        identity
    ]
    assert (
        preserved[0].payment_id,
        preserved[0].payment_product_id,
        preserved[0].revoked_at,
    ) == (None, None, None)
    assert (
        db.exec(select(Payments).where(Payments.popup_id == grant_popup.id)).all() == []
    )
    db.refresh(product)
    assert product.total_stock_remaining == 4

    application = db.get(Applications, application_id)
    application.status = ApplicationStatus.REJECTED.value
    db.add(application)
    db.commit()
    access = client.get(
        f"/api/v1/portal/popup/{grant_popup.id}/access", headers=headers
    )
    assert access.status_code == 200
    assert access.json()["allowed"] is True
    assert access.json()["source"] == "attendee"
    visible = client.get(
        f"/api/v1/attendees/my/popup/{grant_popup.id}", headers=headers
    )
    assert visible.status_code == 200
    assert [unit["id"] for unit in visible.json()["results"][0]["products"]] == [
        str(identity[0])
    ]


@pytest.mark.parametrize("state", ["draft", "in review", "rejected", "accepted"])
def test_grant_does_not_change_existing_application(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
    state: str,
) -> None:
    human = Humans(tenant_id=tenant_a.id, email=f"existing-{uuid.uuid4().hex}@test.com")
    db.add(human)
    db.flush()
    application = Applications(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        human_id=human.id,
        sales_flow_id=application_flow_id(db, popup_tenant_a.id),
        status=state,
        info_not_shared=["email"],
        credit=Decimal("7"),
    )
    db.add(application)
    db.commit()
    product = _product(db, popup_tenant_a)
    response = client.post(
        URL,
        headers=_auth(admin_token_tenant_a),
        json={
            "popup_id": str(popup_tenant_a.id),
            "people": [_person(human.email, product)],
        },
    )
    assert response.status_code == 201, response.text
    db.refresh(application)
    assert application.status == state
    assert application.accepted_at is None
    assert application.credit == Decimal("7")
    assert application.fee_credit_granted is False
    assert application.info_not_shared == ["email"]
    attendee = db.get(
        Attendees, uuid.UUID(response.json()["granted"][0]["attendee_id"])
    )
    assert attendee.application_id is None
    assert attendee.category_id is None
    assert [
        app.id
        for app in db.exec(
            select(Applications).where(Applications.human_id == human.id)
        )
    ] == [application.id]


@pytest.mark.parametrize("origin", ["direct", "application", "companion"])
def test_grant_reuses_existing_attendee(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
    origin: str,
) -> None:
    human = Humans(tenant_id=tenant_a.id, email=f"reuse-{uuid.uuid4().hex}@test.com")
    owner = Humans(tenant_id=tenant_a.id, email=f"owner-{uuid.uuid4().hex}@test.com")
    db.add_all([human, owner])
    db.flush()
    application = None
    if origin != "direct":
        application = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=owner.id if origin == "companion" else human.id,
            sales_flow_id=application_flow_id(db, popup_tenant_a.id),
            status=ApplicationStatus.ACCEPTED.value,
        )
        db.add(application)
        db.flush()
    attendee = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        human_id=human.id,
        application_id=application.id if application else None,
        name="Existing person",
        email=human.email,
    )
    db.add(attendee)
    db.commit()
    product = _product(db, popup_tenant_a)
    response = client.post(
        URL,
        headers=_auth(admin_token_tenant_a),
        json={
            "popup_id": str(popup_tenant_a.id),
            "people": [_person(human.email, product, 2)],
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["granted"][0]["attendee_id"] == str(attendee.id)
    assert [
        row.id
        for row in db.exec(select(Attendees).where(Attendees.human_id == human.id))
    ] == [attendee.id]
    units = _units(db, attendee.id)
    assert len(units) == 2
    assert all(unit.payment_id is None for unit in units)


def test_grant_deduplicates_people_fills_only_blank_names_and_keeps_product_mix(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    grant_popup: Popups,
) -> None:
    human = Humans(
        tenant_id=grant_popup.tenant_id,
        email=f"names-{uuid.uuid4().hex}@test.com",
        first_name="Existing",
        last_name="",
    )
    db.add(human)
    db.commit()
    ticket = _product(db, grant_popup)
    merch = _product(db, grant_popup, "merch")
    other_email = f"other-{uuid.uuid4().hex}@test.com"
    response = client.post(
        URL,
        headers=_auth(admin_token_tenant_a),
        json={
            "popup_id": str(grant_popup.id),
            "people": [
                _person(
                    human.email, ticket, 2, first_name="Replacement", last_name="Filled"
                ),
                _person(human.email.upper(), ticket, 2),
                _person(other_email, merch),
            ],
        },
    )
    assert response.status_code == 201, response.text
    by_email = {row["email"]: row for row in response.json()["granted"]}
    assert len(by_email) == 2
    db.refresh(human)
    assert (human.first_name, human.last_name) == ("Existing", "Filled")
    for email, product, quantity in [(human.email, ticket, 2), (other_email, merch, 1)]:
        units = _units(db, uuid.UUID(by_email[email]["attendee_id"]))
        assert len(units) == quantity
        assert {unit.product_id for unit in units} == {product.id}
        db.refresh(product)
        assert product.total_stock_remaining == 5 - quantity


def test_stock_exhaustion_before_batch_creates_nothing(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    grant_popup: Popups,
) -> None:
    product = _product(db, grant_popup, stock=1)
    emails = [f"sold-out-{uuid.uuid4().hex}@test.com" for _ in range(2)]
    response = client.post(
        URL,
        headers=_auth(admin_token_tenant_a),
        json={
            "popup_id": str(grant_popup.id),
            "people": [_person(email, product) for email in emails],
        },
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["error"] == "stock_exhausted"
    assert db.exec(select(Humans).where(Humans.email.in_(emails))).all() == []
    assert (
        db.exec(select(Attendees).where(Attendees.popup_id == grant_popup.id)).all()
        == []
    )


def test_mid_batch_stock_failure_rolls_back_people_units_stock_and_audit(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    grant_popup: Popups,
    monkeypatch,
) -> None:
    product = _product(db, grant_popup)
    emails = [f"rollback-{uuid.uuid4().hex}@test.com" for _ in range(2)]
    decrement = products_crud.decrement_total_stock
    calls = 0

    def fail_second(session, product_id, quantity):
        nonlocal calls
        calls += 1
        if calls == 2:
            # The first person's rows and audit have already been flushed.
            assert (
                session.exec(
                    select(func.count())
                    .select_from(AttendeeProducts)
                    .where(AttendeeProducts.product_id == product.id)
                ).one()
                == 1
            )
            raise HTTPException(status_code=409, detail="Product sold out")
        return decrement(session, product_id, quantity)

    monkeypatch.setattr(products_crud, "decrement_total_stock", fail_second)
    response = client.post(
        URL,
        headers=_auth(admin_token_tenant_a),
        json={
            "popup_id": str(grant_popup.id),
            "people": [_person(email, product) for email in emails],
        },
    )
    assert response.status_code == 409, response.text
    assert calls == 2
    db.expire_all()
    assert db.exec(select(Humans).where(Humans.email.in_(emails))).all() == []
    for model in (Attendees, Applications, Payments, AuditLog):
        assert (
            db.exec(select(model).where(model.popup_id == grant_popup.id)).all() == []
        )
    assert (
        db.exec(
            select(AttendeeProducts).where(AttendeeProducts.product_id == product.id)
        ).all()
        == []
    )
    assert product.total_stock_remaining == 5


@pytest.mark.parametrize(
    "invalid", ["inactive", "deleted", "foreign_popup", "empty", "quantity"]
)
def test_invalid_products_are_rejected_before_creating_people(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    grant_popup: Popups,
    popup_tenant_a: Popups,
    invalid: str,
) -> None:
    product = _product(
        db, popup_tenant_a if invalid == "foreign_popup" else grant_popup
    )
    if invalid == "inactive":
        product.is_active = False
    if invalid == "deleted":
        product.deleted_at = datetime.now(UTC)
    db.add(product)
    db.commit()
    email = f"invalid-{uuid.uuid4().hex}@test.com"
    person = _person(email, product, 0 if invalid == "quantity" else 1)
    if invalid == "empty":
        person["products"] = []
    response = client.post(
        URL,
        headers=_auth(admin_token_tenant_a),
        json={
            "popup_id": str(grant_popup.id),
            "people": [person],
        },
    )
    assert response.status_code == 422, response.text
    assert db.exec(select(Humans).where(Humans.email == email)).first() is None


def test_grant_blocks_cross_tenant_popup(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    popup_tenant_b: Popups,
) -> None:
    product = _product(db, popup_tenant_b)
    response = client.post(
        URL,
        headers=_auth(admin_token_tenant_a),
        json={
            "popup_id": str(popup_tenant_b.id),
            "people": [_person(f"foreign-{uuid.uuid4().hex}@test.com", product)],
        },
    )
    assert response.status_code == 404, response.text


def test_viewer_cannot_grant(
    client: TestClient,
    db: Session,
    viewer_token_tenant_a: str,
    grant_popup: Popups,
) -> None:
    product = _product(db, grant_popup)
    response = client.post(
        URL,
        headers=_auth(viewer_token_tenant_a),
        json={
            "popup_id": str(grant_popup.id),
            "people": [_person(f"viewer-{uuid.uuid4().hex}@test.com", product)],
        },
    )
    assert response.status_code == 403, response.text
