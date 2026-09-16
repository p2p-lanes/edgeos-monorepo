"""POST /applications/my/detach-companion, and the row it leaves behind.

Leaving somebody's party used to delete the attendee row outright, which is
right only while the row is empty. A companion can buy their own ticket, and
that ticket lands on that very row, so deleting it would take a pass they paid
for. Who paid decides:

- host paid for any ticket -> 409, support unwinds the money
- every ticket is theirs    -> the row detaches and travels with them
- no tickets                -> the row is deleted, as before

The application they file next adopts the detached row instead of making them
a second person.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, func, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.crud import generate_check_in_code
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import application_flow_id


def _auth(human: Humans) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {create_access_token(subject=human.id, token_type='human')}"
    }


def _make_popup(db: Session, tenant: Tenants, *, suffix: str) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Detach {suffix}",
        slug=f"detach-{suffix}-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.application.value,
        status="active",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"detach-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Pat",
        last_name="Doe",
    )
    db.add(human)
    db.flush()
    return human


def _make_product(db: Session, popup: Popups) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name="GA",
        slug=f"ga-{uuid.uuid4().hex[:6]}",
        price=10,
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.flush()
    return product


def _make_party(
    db: Session, tenant: Tenants, popup: Popups
) -> tuple[Humans, Applications, Humans, Attendees]:
    """A holder with an accepted application and one companion on it."""
    holder = _make_human(db, tenant)
    application = Applications(
        sales_flow_id=application_flow_id(db, popup.id),
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=holder.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.flush()

    companion = _make_human(db, tenant)
    companion_row = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        human_id=companion.id,
        name="The Companion",
        email=companion.email,
        category="spouse",
    )
    db.add(companion_row)
    db.flush()
    return holder, application, companion, companion_row


def _give_ticket(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    attendee: Attendees,
    product: Products,
    *,
    application_id: uuid.UUID | None,
) -> AttendeeProducts:
    """One paid ticket on the row. `application_id` says who paid: the host
    application, or nobody (a direct purchase of their own)."""
    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=application_id,
        popup_id=popup.id,
        status=PaymentStatus.APPROVED.value,
        amount=10,
        currency=popup.currency,
    )
    db.add(payment)
    db.flush()
    ticket = AttendeeProducts(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        attendee_id=attendee.id,
        product_id=product.id,
        check_in_code=generate_check_in_code(""),
        payment_id=payment.id,
    )
    db.add(ticket)
    db.flush()
    return ticket


def _count_rows(db: Session, popup: Popups, human: Humans) -> int:
    return db.exec(
        select(func.count())
        .select_from(Attendees)
        .where(Attendees.popup_id == popup.id, Attendees.human_id == human.id)
    ).one()


class TestDetachCompanion:
    def test_empty_row_is_deleted(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="empty")
        _holder, _application, companion, _row = _make_party(db, tenant_a, popup)
        db.commit()

        response = client.post(
            "/api/v1/applications/my/detach-companion",
            headers=_auth(companion),
            json={"popup_id": str(popup.id)},
        )

        assert response.status_code == 204, response.text
        assert _count_rows(db, popup, companion) == 0

    def test_row_with_their_own_ticket_is_detached_not_deleted(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="own")
        _holder, _application, companion, row = _make_party(db, tenant_a, popup)
        product = _make_product(db, popup)
        ticket = _give_ticket(db, tenant_a, popup, row, product, application_id=None)
        db.commit()

        response = client.post(
            "/api/v1/applications/my/detach-companion",
            headers=_auth(companion),
            json={"popup_id": str(popup.id)},
        )

        assert response.status_code == 204, response.text
        db.expire_all()
        surviving = db.get(Attendees, row.id)
        assert surviving is not None
        assert surviving.application_id is None
        assert db.get(AttendeeProducts, ticket.id) is not None
        assert _count_rows(db, popup, companion) == 1

    def test_host_paid_ticket_still_blocks(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="host")
        _holder, application, companion, row = _make_party(db, tenant_a, popup)
        product = _make_product(db, popup)
        _give_ticket(db, tenant_a, popup, row, product, application_id=application.id)
        db.commit()

        response = client.post(
            "/api/v1/applications/my/detach-companion",
            headers=_auth(companion),
            json={"popup_id": str(popup.id)},
        )

        assert response.status_code == 409, response.text
        assert response.json()["detail"]["code"] == "tickets_already_purchased"
        db.expire_all()
        surviving = db.get(Attendees, row.id)
        assert surviving is not None
        assert surviving.application_id == application.id

    def test_their_own_application_adopts_the_detached_row(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """The point of detaching: one person, one row, ticket kept."""
        popup = _make_popup(db, tenant_a, suffix="adopt")
        _holder, _application, companion, row = _make_party(db, tenant_a, popup)
        product = _make_product(db, popup)
        ticket = _give_ticket(db, tenant_a, popup, row, product, application_id=None)
        db.commit()

        detach = client.post(
            "/api/v1/applications/my/detach-companion",
            headers=_auth(companion),
            json={"popup_id": str(popup.id)},
        )
        assert detach.status_code == 204, detach.text

        created = client.post(
            "/api/v1/applications/my",
            headers=_auth(companion),
            json={
                "popup_id": str(popup.id),
                "first_name": "Pat",
                "last_name": "Doe",
            },
        )
        assert created.status_code in (200, 201), created.text

        db.expire_all()
        assert _count_rows(db, popup, companion) == 1
        adopted = db.get(Attendees, row.id)
        assert adopted is not None
        assert adopted.application_id == uuid.UUID(created.json()["id"])
        assert db.get(AttendeeProducts, ticket.id) is not None
