"""Tests for the admin attendee product-management CRUD methods.

Covers swap_ticket_product (change a ticket's product, no payment) and
remove_product (delete a ticket and restore its stock). Both operate on the
ticket layer plus inventory; the payment_products financial snapshot is left
untouched on purpose.
"""

import csv
import io
import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session, func, select

from app.api.attendee import crud as attendee_crud
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.payment.models import Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_product(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    stock: int | None = None,
    category: str = "ticket",
) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Swap Product {uuid.uuid4().hex[:6]}",
        slug=f"swap-prod-{uuid.uuid4().hex[:6]}",
        price=Decimal("10"),
        category=category,
        total_stock_cap=stock,
        total_stock_remaining=stock,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_attendee(db: Session, tenant: Tenants, popup: Popups) -> Attendees:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"swap-ticket-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Swap",
        last_name="Ticket",
    )
    db.add(human)
    db.commit()
    db.refresh(human)

    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        name="Swap Ticket Test",
        category="main",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _make_ticket(
    db: Session,
    tenant: Tenants,
    attendee: Attendees,
    product: Products,
) -> AttendeeProducts:
    ticket = AttendeeProducts(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        attendee_id=attendee.id,
        product_id=product.id,
        check_in_code=f"SW{uuid.uuid4().hex[:6].upper()}",
        product_category_snapshot=product.category,
        requires_check_in_snapshot=product.requires_check_in,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


# ---------------------------------------------------------------------------
# swap_ticket_product
# ---------------------------------------------------------------------------


class TestSwapTicketProduct:
    def test_swap_changes_product_and_keeps_check_in_code(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        old_product = _make_product(db, tenant_a, popup_tenant_a)
        new_product = _make_product(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, old_product)
        original_code = ticket.check_in_code

        updated = attendee_crud.attendees_crud.swap_ticket_product(
            db,
            attendee_id=attendee.id,
            ticket_id=ticket.id,
            new_product_id=new_product.id,
        )

        assert updated.product_id == new_product.id
        assert updated.check_in_code == original_code
        assert updated.product_category_snapshot == "ticket"

    def test_swap_classifies_a_legacy_holding_from_the_new_product(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        old_product = _make_product(db, tenant_a, popup_tenant_a)
        new_product = _make_product(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, old_product)

        updated = attendee_crud.attendees_crud.swap_ticket_product(
            db, attendee.id, ticket.id, new_product.id
        )

        assert (updated.product_id, updated.product_category_snapshot) == (
            new_product.id,
            "ticket",
        )

    @pytest.mark.parametrize("category", ["meal_plan", "housing", "merch"])
    def test_swap_rejects_non_access_product(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        category: str,
    ) -> None:
        old_product = _make_product(db, tenant_a, popup_tenant_a, stock=5)
        new_product = _make_product(
            db,
            tenant_a,
            popup_tenant_a,
            stock=5,
            category=category,
        )
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, old_product)

        with pytest.raises(HTTPException):
            attendee_crud.attendees_crud.swap_ticket_product(
                db, attendee.id, ticket.id, new_product.id
            )

        db.rollback()
        db.refresh(ticket)
        db.refresh(new_product)
        assert (ticket.product_id, ticket.product_category_snapshot) == (
            old_product.id,
            "ticket",
        )
        assert new_product.total_stock_remaining == 5

    def test_swap_restores_old_and_decrements_new_stock(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        old_product = _make_product(db, tenant_a, popup_tenant_a, stock=5)
        new_product = _make_product(db, tenant_a, popup_tenant_a, stock=5)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        # Simulate the ticket having consumed one unit of the old product.
        old_product.total_stock_remaining = 4
        db.add(old_product)
        db.commit()
        ticket = _make_ticket(db, tenant_a, attendee, old_product)

        attendee_crud.attendees_crud.swap_ticket_product(
            db,
            attendee_id=attendee.id,
            ticket_id=ticket.id,
            new_product_id=new_product.id,
        )

        db.refresh(old_product)
        db.refresh(new_product)
        assert old_product.total_stock_remaining == 5  # restored, clamped to cap
        assert new_product.total_stock_remaining == 4  # decremented

    def test_swap_same_product_is_noop(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        product = _make_product(db, tenant_a, popup_tenant_a, stock=5)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, product)

        attendee_crud.attendees_crud.swap_ticket_product(
            db,
            attendee_id=attendee.id,
            ticket_id=ticket.id,
            new_product_id=product.id,
        )

        db.refresh(product)
        assert product.total_stock_remaining == 5  # untouched

    def test_swap_sold_out_new_product_raises_409(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        old_product = _make_product(db, tenant_a, popup_tenant_a, stock=5)
        new_product = _make_product(db, tenant_a, popup_tenant_a, stock=0)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, old_product)

        with pytest.raises(HTTPException) as exc:
            attendee_crud.attendees_crud.swap_ticket_product(
                db,
                attendee_id=attendee.id,
                ticket_id=ticket.id,
                new_product_id=new_product.id,
            )
        assert exc.value.status_code == 409
        # Old product stock must not have been restored on the aborted swap.
        db.refresh(old_product)
        assert old_product.total_stock_remaining == 5
        db.refresh(ticket)
        assert ticket.product_id == old_product.id

    def test_swap_ticket_not_owned_raises_404(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        product = _make_product(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        other_attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, product)
        new_product = _make_product(db, tenant_a, popup_tenant_a)

        with pytest.raises(HTTPException) as exc:
            attendee_crud.attendees_crud.swap_ticket_product(
                db,
                attendee_id=other_attendee.id,
                ticket_id=ticket.id,
                new_product_id=new_product.id,
            )
        assert exc.value.status_code == 404

    def test_swap_cross_popup_raises_422(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        popup_tenant_a_summer_fest: Popups,
    ) -> None:
        old_product = _make_product(db, tenant_a, popup_tenant_a)
        foreign_product = _make_product(db, tenant_a, popup_tenant_a_summer_fest)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, old_product)

        with pytest.raises(HTTPException) as exc:
            attendee_crud.attendees_crud.swap_ticket_product(
                db,
                attendee_id=attendee.id,
                ticket_id=ticket.id,
                new_product_id=foreign_product.id,
            )
        assert exc.value.status_code == 422


# ---------------------------------------------------------------------------
# remove_product
# ---------------------------------------------------------------------------


class TestRemoveProduct:
    @pytest.mark.parametrize("remaining", [0, 1])
    def test_removed_ticket_stays_absent_after_reload(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_token_tenant_a: str,
        remaining: int,
    ) -> None:
        product = _make_product(db, tenant_a, popup_tenant_a, stock=5)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        attendee.email = attendee.human.email
        db.add(attendee)
        db.commit()
        attendee_crud.attendees_crud.add_products(
            db, attendee.id, [(product.id, remaining + 1)]
        )
        headers = {"Authorization": f"Bearer {admin_token_tenant_a}"}
        url = f"/api/v1/attendees/{attendee.id}"
        before = client.get(url, headers=headers)
        assert before.status_code == 200
        tickets = before.json()["products"]
        removed_id = tickets[0]["id"]
        expected_ids = {ticket["id"] for ticket in tickets[1:]}

        # A repeated removal must also leave the remaining tickets and stock alone.
        for _ in range(2):
            removed = client.delete(f"{url}/tickets/{removed_id}", headers=headers)
            assert removed.status_code == 200, removed.text
            assert {
                ticket["id"] for ticket in removed.json()["products"]
            } == expected_ids

            reloaded = client.get(url, headers=headers)
            assert reloaded.status_code == 200
            assert {
                ticket["id"] for ticket in reloaded.json()["products"]
            } == expected_ids

        db.expire_all()
        assert db.get(AttendeeProducts, uuid.UUID(removed_id)).revoked_at is not None
        db.refresh(product)
        assert product.total_stock_remaining == 5 - remaining

        listed = client.get(
            "/api/v1/attendees",
            params={"popup_id": str(popup_tenant_a.id), "search": attendee.email},
            headers=headers,
        )
        assert listed.status_code == 200
        assert len(listed.json()["results"]) == 1
        assert len(listed.json()["results"][0]["products"]) == remaining

        exported = client.get(
            "/api/v1/attendees/export.csv",
            params={"popup_id": str(popup_tenant_a.id), "search": attendee.email},
            headers=headers,
        )
        assert exported.status_code == 200
        rows = list(csv.DictReader(io.StringIO(exported.text)))
        assert [row["Product ID"] for row in rows] == (
            [str(product.id)] if remaining else [""]
        )

        by_email = client.get(
            f"/api/v1/attendees/tickets/{attendee.email}", headers=headers
        )
        assert by_email.status_code == 200
        assert len(by_email.json()) == remaining
        if remaining:
            assert len(by_email.json()[0]["products"]) == remaining

        human_token = create_access_token(subject=attendee.human_id, token_type="human")
        portal = client.get(
            f"/api/v1/attendees/my/popup/{popup_tenant_a.id}",
            headers={"Authorization": f"Bearer {human_token}"},
        )
        assert portal.status_code == 200
        assert len(portal.json()["results"]) == 1
        assert {
            ticket["id"] for ticket in portal.json()["results"][0]["products"]
        } == expected_ids

    def test_remove_revokes_ticket_and_restores_stock(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        product = _make_product(db, tenant_a, popup_tenant_a, stock=5)
        product.total_stock_remaining = 4  # one unit consumed by the ticket
        db.add(product)
        db.commit()
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, product)

        attendee_crud.attendees_crud.remove_product(
            db,
            attendee_id=attendee.id,
            ticket_id=ticket.id,
        )

        assert db.get(AttendeeProducts, ticket.id).revoked_at is not None
        db.refresh(product)
        assert product.total_stock_remaining == 5

    def test_remove_ticket_not_owned_raises_404(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        product = _make_product(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        other_attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, product)

        with pytest.raises(HTTPException) as exc:
            attendee_crud.attendees_crud.remove_product(
                db,
                attendee_id=other_attendee.id,
                ticket_id=ticket.id,
            )
        assert exc.value.status_code == 404
        # Ticket must survive the rejected removal.
        assert db.get(AttendeeProducts, ticket.id) is not None


# ---------------------------------------------------------------------------
# add_products (bulk)
# ---------------------------------------------------------------------------


def _ticket_count(db: Session, attendee_id: uuid.UUID) -> int:
    return db.exec(
        select(func.count())
        .select_from(AttendeeProducts)
        .where(AttendeeProducts.attendee_id == attendee_id)
    ).one()


class TestAddProducts:
    def test_adds_quantities_and_decrements_stock(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        prod_a = _make_product(db, tenant_a, popup_tenant_a, stock=10)
        prod_b = _make_product(db, tenant_a, popup_tenant_a, stock=10)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)

        attendee_crud.attendees_crud.add_products(
            db,
            attendee_id=attendee.id,
            items=[(prod_a.id, 2), (prod_b.id, 3)],
        )

        assert _ticket_count(db, attendee.id) == 5
        holdings = db.exec(
            select(AttendeeProducts).where(AttendeeProducts.attendee_id == attendee.id)
        ).all()
        assert {holding.product_category_snapshot for holding in holdings} == {"ticket"}
        db.refresh(prod_a)
        db.refresh(prod_b)
        assert prod_a.total_stock_remaining == 8
        assert prod_b.total_stock_remaining == 7

    def test_sold_out_rolls_back_whole_batch(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        prod_ok = _make_product(db, tenant_a, popup_tenant_a, stock=10)
        prod_short = _make_product(db, tenant_a, popup_tenant_a, stock=1)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)

        with pytest.raises(HTTPException) as exc:
            attendee_crud.attendees_crud.add_products(
                db,
                attendee_id=attendee.id,
                items=[(prod_ok.id, 2), (prod_short.id, 5)],
            )
        assert exc.value.status_code == 409

        # FastAPI rolls back on HTTPException — mirror that and assert nothing stuck.
        db.rollback()
        assert _ticket_count(db, attendee.id) == 0
        db.refresh(prod_ok)
        assert prod_ok.total_stock_remaining == 10

    def test_inactive_product_rejected_422(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        product = _make_product(db, tenant_a, popup_tenant_a, stock=10)
        product.is_active = False
        db.add(product)
        db.commit()
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)

        with pytest.raises(HTTPException) as exc:
            attendee_crud.attendees_crud.add_products(
                db,
                attendee_id=attendee.id,
                items=[(product.id, 1)],
            )
        assert exc.value.status_code == 422

    @pytest.mark.parametrize("category", ["meal_plan", "housing", "merch"])
    def test_assignment_supports_mixed_product_categories(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        category: str,
    ) -> None:
        access = _make_product(db, tenant_a, popup_tenant_a, stock=5)
        extra = _make_product(
            db,
            tenant_a,
            popup_tenant_a,
            stock=5,
            category=category,
        )
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)

        attendee_crud.attendees_crud.add_products(
            db, attendee.id, [(access.id, 1), (extra.id, 1)]
        )

        assert _ticket_count(db, attendee.id) == 2
        db.refresh(access)
        db.refresh(extra)
        assert (access.total_stock_remaining, extra.total_stock_remaining) == (4, 4)
        units = db.exec(
            select(AttendeeProducts).where(AttendeeProducts.attendee_id == attendee.id)
        ).all()
        assert {unit.product_category_snapshot for unit in units} == {
            "ticket",
            category,
        }
        assert all(unit.payment_id is None for unit in units)


@pytest.mark.parametrize("category", ["ticket", "meal_plan"])
def test_manual_holding_attachment_snapshots_product_category(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
    category: str,
) -> None:
    product = _make_product(db, tenant_a, popup_tenant_a, category=category)
    attendee = _make_attendee(db, tenant_a, popup_tenant_a)

    holding = attendee_crud.attendees_crud.add_product(db, attendee.id, product.id)

    assert (holding.product_category_snapshot, holding.payment_id) == (category, None)


@pytest.mark.parametrize("category", ["merch", "housing"])
def test_manual_holding_attachment_supports_non_ticket_product(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
    category: str,
) -> None:
    product = _make_product(
        db,
        tenant_a,
        popup_tenant_a,
        stock=5,
        category=category,
    )
    attendee = _make_attendee(db, tenant_a, popup_tenant_a)

    holding = attendee_crud.attendees_crud.add_product(db, attendee.id, product.id)

    assert holding.product_category_snapshot == category
    db.refresh(product)
    assert product.total_stock_remaining == 4


def test_manual_holding_attachment_rejects_partial_paid_lineage(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    product = _make_product(db, tenant_a, popup_tenant_a, stock=5)
    attendee = _make_attendee(db, tenant_a, popup_tenant_a)
    payment = Payments(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        amount=Decimal("0"),
        currency="USD",
    )
    db.add(payment)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        attendee_crud.attendees_crud.add_product(
            db, attendee.id, product.id, payment_id=payment.id
        )

    assert exc.value.status_code == 422
    db.rollback()
    assert _ticket_count(db, attendee.id) == 0
