"""Tests for HumansCRUD.hard_delete_cascade and DELETE /humans/{id}.

Covers admin/superadmin hard delete with full cascade across applications,
attendees, payments, products, carts, group memberships, and ambassador-owned
groups. Tenant admins are restricted to their own tenant; superadmins are
cross-tenant.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.cart.models import Carts
from app.api.group.models import GroupLeaders, GroupMembers, Groups
from app.api.human.crud import humans_crud
from app.api.human.models import Humans
from app.api.payment.models import PaymentProducts, Payments
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_human(db: Session, tenant_id: uuid.UUID, email_prefix: str = "del") -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        email=f"{email_prefix}-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Test",
        last_name="Delete",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


# ---------------------------------------------------------------------------
# CRUD-level cascade tests
# ---------------------------------------------------------------------------


def test_cascade_removes_minimal_human(db: Session, tenant_a: Tenants) -> None:
    """A human with no related rows is removed cleanly."""
    human = _make_human(db, tenant_a.id, "minimal")
    human_id = human.id

    summary = humans_crud.hard_delete_cascade(db, human_id)

    assert summary["applications"] == 0
    assert summary["ambassador_groups"] == 0
    assert db.get(Humans, human_id) is None


def test_cascade_removes_application_and_attendees(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    """Deleting a human drops their application and any attached attendees."""
    human = _make_human(db, tenant_a.id, "withapp")
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        human_id=human.id,
        popup_id=popup_tenant_a.id,
        status=ApplicationStatus.DRAFT.value,
        first_name="A",
        last_name="A",
        email=human.email,
    )
    db.add(application)
    db.commit()

    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        application_id=application.id,
        popup_id=popup_tenant_a.id,
        human_id=human.id,
        name="A A",
    )
    db.add(attendee)
    db.commit()
    application_id = application.id
    attendee_id = attendee.id

    summary = humans_crud.hard_delete_cascade(db, human.id)

    assert summary["applications"] == 1
    assert summary["attendees"] == 1
    assert db.get(Applications, application_id) is None
    assert db.get(Attendees, attendee_id) is None
    assert db.get(Humans, human.id) is None


def test_cascade_removes_payments_and_product_snapshots(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    """Payments + payment_products + attendee_products are wiped along the chain."""
    from decimal import Decimal

    from app.api.payment.schemas import PaymentStatus
    from app.api.product.models import Products

    human = _make_human(db, tenant_a.id, "chain")
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        human_id=human.id,
        popup_id=popup_tenant_a.id,
        status=ApplicationStatus.ACCEPTED.value,
        first_name="C",
        last_name="C",
        email=human.email,
    )
    db.add(application)
    db.flush()

    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        application_id=application.id,
        popup_id=popup_tenant_a.id,
        human_id=human.id,
        name="Chain Main",
    )
    db.add(attendee)
    db.flush()

    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        name="T",
        slug=f"prod-{uuid.uuid4().hex[:6]}",
        price=Decimal("10.00"),
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.flush()

    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        application_id=application.id,
        popup_id=popup_tenant_a.id,
        amount=Decimal("10.00"),
        currency="USD",
        status=PaymentStatus.APPROVED.value,
    )
    db.add(payment)
    db.flush()

    db.add(
        PaymentProducts(
            payment_id=payment.id,
            product_id=product.id,
            attendee_id=attendee.id,
            tenant_id=tenant_a.id,
            quantity=1,
            product_name=product.name,
            product_price=Decimal("10.00"),
            effective_unit_price=Decimal("10.00"),
            product_category="ticket",
            product_currency="USD",
        )
    )
    db.add(
        AttendeeProducts(
            attendee_id=attendee.id,
            product_id=product.id,
            payment_id=payment.id,
            tenant_id=tenant_a.id,
            check_in_code=f"chk-{uuid.uuid4().hex[:8]}",
        )
    )
    db.commit()

    payment_id = payment.id
    summary = humans_crud.hard_delete_cascade(db, human.id)

    assert summary["payments"] == 1
    assert summary["attendee_products"] == 1
    assert summary["payment_products"] == 1
    assert db.get(Payments, payment_id) is None
    # The Products row itself must survive — it belongs to the popup, not the human.
    assert db.get(Products, product.id) is not None


def test_cascade_removes_carts(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    human = _make_human(db, tenant_a.id, "cart")
    cart = Carts(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        human_id=human.id,
        popup_id=popup_tenant_a.id,
    )
    db.add(cart)
    db.commit()
    cart_id = cart.id

    summary = humans_crud.hard_delete_cascade(db, human.id)

    assert summary["carts"] == 1
    assert db.get(Carts, cart_id) is None


def test_cascade_removes_group_memberships(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    """Human as a non-ambassador member/leader — the group survives, links die."""
    ambassador = _make_human(db, tenant_a.id, "amb")
    member = _make_human(db, tenant_a.id, "member")

    group = Groups(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        name="G",
        slug=f"group-{uuid.uuid4().hex[:6]}",
        ambassador_id=ambassador.id,
    )
    db.add(group)
    db.flush()
    db.add(GroupMembers(group_id=group.id, human_id=member.id, tenant_id=tenant_a.id))
    db.add(GroupLeaders(group_id=group.id, human_id=member.id, tenant_id=tenant_a.id))
    db.commit()
    group_id = group.id

    summary = humans_crud.hard_delete_cascade(db, member.id)

    assert summary["group_memberships"] == 2
    assert summary["ambassador_groups"] == 0
    assert db.get(Groups, group_id) is not None
    # Ambassador human untouched.
    assert db.get(Humans, ambassador.id) is not None


def test_cascade_drops_ambassador_owned_groups(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    """Ambassador delete cascades to the group + its members/leaders."""
    ambassador = _make_human(db, tenant_a.id, "ambdrop")
    other_member = _make_human(db, tenant_a.id, "stays")

    group = Groups(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        name="AmbG",
        slug=f"ambg-{uuid.uuid4().hex[:6]}",
        ambassador_id=ambassador.id,
    )
    db.add(group)
    db.flush()
    db.add(
        GroupMembers(group_id=group.id, human_id=other_member.id, tenant_id=tenant_a.id)
    )
    db.commit()
    group_id = group.id

    summary = humans_crud.hard_delete_cascade(db, ambassador.id)

    assert summary["ambassador_groups"] == 1
    assert db.get(Groups, group_id) is None
    # Other member's human row must survive — only their group_members link died.
    assert db.get(Humans, other_member.id) is not None
    assert (
        db.exec(select(GroupMembers).where(GroupMembers.group_id == group_id)).first()
        is None
    )


# ---------------------------------------------------------------------------
# HTTP-level authorization tests
# ---------------------------------------------------------------------------


def test_http_delete_succeeds_for_admin_same_tenant(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    """A tenant admin can hard-delete a human within their own tenant."""
    human = _make_human(db, tenant_a.id, "adminown")
    human_id = human.id

    resp = client.delete(
        f"/api/v1/humans/{human_id}", headers=_auth(admin_token_tenant_a)
    )

    assert resp.status_code == 200, resp.text
    db.expire_all()
    assert db.get(Humans, human_id) is None


def test_http_delete_admin_cannot_delete_other_tenant(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_b: Tenants,
) -> None:
    """A tenant admin cannot delete a human in another tenant — 404, no delete.

    404 (not 403) avoids revealing that the human exists in another tenant.
    """
    human = _make_human(db, tenant_b.id, "crosstenant")

    resp = client.delete(
        f"/api/v1/humans/{human.id}", headers=_auth(admin_token_tenant_a)
    )

    assert resp.status_code == 404, resp.text
    assert db.get(Humans, human.id) is not None


def test_http_delete_rejected_for_operator(
    client: TestClient,
    db: Session,
    operator_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    """Operators are below the admin gate → 403, even in their own tenant."""
    human = _make_human(db, tenant_a.id, "operator")

    resp = client.delete(
        f"/api/v1/humans/{human.id}", headers=_auth(operator_token_tenant_a)
    )

    assert resp.status_code == 403, resp.text
    assert db.get(Humans, human.id) is not None


def test_http_delete_unknown_returns_404(
    client: TestClient, superadmin_token: str
) -> None:
    resp = client.delete(
        f"/api/v1/humans/{uuid.uuid4()}", headers=_auth(superadmin_token)
    )
    assert resp.status_code == 404


def test_http_delete_anonymous_rejected(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    human = _make_human(db, tenant_a.id, "anon")
    resp = client.delete(f"/api/v1/humans/{human.id}")
    assert resp.status_code in (401, 403)
    assert db.get(Humans, human.id) is not None


def test_http_delete_succeeds_for_superadmin(
    client: TestClient,
    db: Session,
    superadmin_token: str,
    tenant_a: Tenants,
) -> None:
    human = _make_human(db, tenant_a.id, "super")
    human_id = human.id

    resp = client.delete(f"/api/v1/humans/{human_id}", headers=_auth(superadmin_token))

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["applications"] == 0
    assert body["ambassador_groups"] == 0
    db.expire_all()
    assert db.get(Humans, human_id) is None
