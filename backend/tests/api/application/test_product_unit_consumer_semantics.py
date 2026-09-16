"""Mixed-fixture coverage for active allocated ticket-unit consumers."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.crud import applications_crud
from app.api.application.history_crud import _ticket_counts
from app.api.application.router import _build_application_public
from app.api.attendee.models import AttendeeProducts
from app.api.dashboard.router import _get_attendee_stats, _get_paying_attendees_count
from app.api.human.crud import humans_crud
from app.api.human.schemas import HumanPublic
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.product.models import Products
from app.api.sales_flow.eligibility import has_popup_products
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from app.services.restrictions.context import build_context
from tests.api.application import test_attendee_directory as directory


@pytest.fixture()
def mixed_units(db: Session, tenant_a: Tenants):
    popup = directory._popup(db, tenant_a)
    popup.show_attendee_directory = True
    main = directory._category(db, popup, "main", is_primary=True)
    paid_human = directory._human(db, tenant_a, "Paid", "Ticket")
    grant_human = directory._human(db, tenant_a, "Granted", "Ticket")
    invalid_human = directory._human(db, tenant_a, "Invalid", "Units")
    paid_app = directory._application(db, popup, paid_human)
    grant_app = directory._application(db, popup, grant_human)
    invalid_app = directory._application(db, popup, invalid_human)
    paid = directory._attendee(db, popup, paid_app, paid_human, main)
    granted = directory._attendee(db, popup, grant_app, grant_human, main)
    invalid = directory._attendee(db, popup, invalid_app, invalid_human, main)
    ticket = Products(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        name="Snapshot Ticket",
        slug=f"snapshot-ticket-{uuid.uuid4().hex[:8]}",
        price=Decimal("10"),
        category="ticket",
        duration_type="day",
    )
    parking = Products(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        name="Snapshot Parking",
        slug=f"snapshot-parking-{uuid.uuid4().hex[:8]}",
        price=Decimal("5"),
        category="parking",
    )
    db.add_all([ticket, parking])
    db.flush()
    payment = Payments(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        application_id=paid_app.id,
        buyer_human_id=paid_human.id,
        status=PaymentStatus.APPROVED.value,
        amount=Decimal("30"),
    )
    db.add(payment)
    db.flush()
    line = PaymentProducts(
        tenant_id=tenant_a.id,
        payment_id=payment.id,
        product_id=ticket.id,
        attendee_id=paid.id,
        quantity=3,
        product_name=ticket.name,
        product_price=ticket.price,
        product_category="ticket",
    )
    parking_line = PaymentProducts(
        tenant_id=tenant_a.id,
        payment_id=payment.id,
        product_id=parking.id,
        quantity=1,
        product_name=parking.name,
        product_price=parking.price,
        product_category="parking",
    )
    db.add_all([line, parking_line])
    db.flush()

    def unit(
        attendee_id,
        product: Products,
        snapshot: str | None,
        *,
        payment_line: PaymentProducts | None = None,
        line_index: int | None = None,
        check_in: bool = False,
        revoked: bool = False,
    ) -> AttendeeProducts:
        return AttendeeProducts(
            tenant_id=tenant_a.id,
            attendee_id=attendee_id,
            product_id=product.id,
            payment_id=payment_line.payment_id if payment_line else None,
            payment_product_id=payment_line.id if payment_line else None,
            unit_index=line_index,
            check_in_code=uuid.uuid4().hex[:10],
            product_category_snapshot=snapshot,
            requires_check_in_snapshot=check_in,
            revoked_at=datetime.now(UTC) if revoked else None,
        )

    db.add_all(
        [
            unit(
                paid.id,
                ticket,
                "ticket",
                payment_line=line,
                line_index=0,
                check_in=True,
            ),
            unit(paid.id, ticket, "ticket", payment_line=line, line_index=1),
            unit(
                paid.id,
                ticket,
                "ticket",
                payment_line=line,
                line_index=2,
                revoked=True,
            ),
            unit(
                None,
                parking,
                "parking",
                payment_line=parking_line,
                line_index=0,
                check_in=True,
            ),
            unit(invalid.id, parking, "parking", check_in=True),
            unit(invalid.id, ticket, None),
            unit(granted.id, ticket, "ticket"),
        ]
    )
    db.commit()
    return SimpleNamespace(
        popup=popup,
        flow=db.get(SalesFlows, paid_app.sales_flow_id),
        paid_human=paid_human,
        grant_human=grant_human,
        invalid_human=invalid_human,
        paid_app=paid_app,
        grant_app=grant_app,
        invalid_app=invalid_app,
        paid=paid,
        granted=granted,
        ticket=ticket,
        parking=parking,
    )


def test_consumers_share_active_allocated_ticket_truth(
    db: Session, mixed_units
) -> None:
    world = mixed_units
    assert has_popup_products(db, world.paid_human.id, world.popup.id) is True
    assert has_popup_products(db, world.grant_human.id, world.popup.id) is True
    assert has_popup_products(db, world.invalid_human.id, world.popup.id) is False

    context = build_context(
        db,
        world.popup,
        world.flow,
        human=HumanPublic.model_validate(world.paid_human),
    )
    assert context.has_product("product", str(world.ticket.id)) is True
    assert context.has_product("category", "ticket") is True
    assert context.has_product("category", "parking") is False

    attendees, total = applications_crud.find_directory(db, world.popup.id)
    assert total == 2
    assert {attendee.id for attendee in attendees} == {world.paid.id, world.granted.id}
    invalid_apps, _ = applications_crud.find_by_human(db, world.invalid_human.id)
    assert _build_application_public(invalid_apps[0]).attendees[0].products == []
    counts = _ticket_counts(
        db, [world.paid_app.id, world.grant_app.id, world.invalid_app.id]
    )
    assert counts == {world.paid_app.id: 2, world.grant_app.id: 1}

    paid_apps, _ = applications_crud.find_by_human(db, world.paid_human.id)
    assert len(_build_application_public(paid_apps[0]).attendees[0].products) == 2
    attendee_stats = _get_attendee_stats(db, world.popup.id)
    assert (attendee_stats.total, attendee_stats.main) == (2, 2)
    assert _get_paying_attendees_count(db, world.popup.id) == 1
    assert humans_crud.get_profile_stats(db, world.paid_human.id).total_days == 2
    assert humans_crud.get_profile_stats(db, world.grant_human.id).total_days == 1


def test_directory_http_uses_the_same_ticket_population(
    client: TestClient, mixed_units
) -> None:
    world = mixed_units
    token = create_access_token(subject=world.paid_human.id, token_type="human")
    response = client.get(
        f"/api/v1/applications/my/directory/{world.popup.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text
    assert {row["id"] for row in response.json()["results"]} == {
        str(world.paid.id),
        str(world.granted.id),
    }
