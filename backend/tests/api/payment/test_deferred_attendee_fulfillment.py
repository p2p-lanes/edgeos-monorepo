import asyncio
import importlib
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Event
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, PaymentRecipients, Payments
from app.api.payment.router import _handle_regular_payment
from app.api.payment.schemas import PaymentStatus, PaymentType
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.services.payment_notifications import _resolve_payment_buyer
from tests._flow_helpers import application_flow_id


def _human(db: Session, tenant: Tenants, label: str) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"{label}-{uuid.uuid4().hex[:8]}@test.com",
        first_name=label,
    )
    db.add(human)
    db.flush()
    return human


def _category(db: Session, popup: Popups) -> AttendeeCategories:
    category = db.exec(
        select(AttendeeCategories).where(
            AttendeeCategories.popup_id == popup.id,
            AttendeeCategories.is_primary.is_(True),
        )
    ).first()
    if category is None:
        category = AttendeeCategories(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            key="main",
            is_primary=True,
        )
        db.add(category)
        db.flush()
    return category


def _product(
    db: Session,
    popup: Popups,
    category: str = "ticket",
    *,
    attendee_category_id: uuid.UUID | None = None,
) -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"Deferred pass {uuid.uuid4().hex[:6]}",
        slug=f"deferred-{uuid.uuid4().hex[:8]}",
        price=Decimal("25"),
        category=category,
        attendee_category_id=attendee_category_id,
        is_active=True,
    )
    db.add(product)
    db.flush()
    return product


def _payment(
    db: Session,
    popup: Popups,
    buyer: Humans,
    product: Products,
    *,
    human: Humans | None = None,
    existing_attendee: Attendees | None = None,
    quantity: int = 1,
    payment_type: PaymentType = PaymentType.PASS_PURCHASE,
) -> tuple[Payments, PaymentRecipients | None, PaymentProducts | None]:
    payment = Payments(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        buyer_human_id=buyer.id,
        payment_type=payment_type.value,
        status=PaymentStatus.PENDING.value,
        amount=product.price * quantity,
    )
    db.add(payment)
    db.flush()
    if payment_type == PaymentType.APPLICATION_FEE:
        db.commit()
        return payment, None, None

    recipient = PaymentRecipients(
        tenant_id=popup.tenant_id,
        payment_id=payment.id,
        recipient_key=f"recipient-{uuid.uuid4().hex[:8]}",
        human_id=human.id if human else None,
        existing_attendee_id=existing_attendee.id if existing_attendee else None,
        name=human.first_name if human else "Accountless guest",
        email=human.email if human else "guest@test.com",
        category_id=_category(db, popup).id,
        profile_snapshot={"dietary_restriction": "vegan"},
    )
    db.add(recipient)
    db.flush()
    line = PaymentProducts(
        tenant_id=popup.tenant_id,
        payment_id=payment.id,
        payment_recipient_id=recipient.id,
        product_id=product.id,
        quantity=quantity,
        product_name=product.name,
        product_price=product.price,
        product_category=product.category or "ticket",
        purchase_metadata={"meal": "vegan"},
    )
    db.add(line)
    db.commit()
    return payment, recipient, line


def _tickets(db: Session, payment_id: uuid.UUID) -> list[AttendeeProducts]:
    return list(
        db.exec(
            select(AttendeeProducts)
            .where(AttendeeProducts.payment_id == payment_id)
            .order_by(AttendeeProducts.unit_index)
        ).all()
    )


def _line(
    db: Session,
    payment: Payments,
    product: Products,
    *,
    recipient: PaymentRecipients | None = None,
    attendee: Attendees | None = None,
    metadata: dict | None = None,
) -> PaymentProducts:
    line = PaymentProducts(
        tenant_id=payment.tenant_id,
        payment_id=payment.id,
        payment_recipient_id=recipient.id if recipient else None,
        attendee_id=attendee.id if attendee else None,
        product_id=product.id,
        quantity=1,
        product_name=product.name,
        product_price=product.price,
        product_category=product.category or "",
        purchase_metadata=metadata,
    )
    db.add(line)
    db.flush()
    return line


def _attendee_count(db: Session, popup: Popups) -> int:
    return len(
        db.exec(select(Attendees.id).where(Attendees.popup_id == popup.id)).all()
    )


def test_approval_materializes_unmanaged_attendee_and_repairs_missing_lineage(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer = _human(db, tenant_a, "Buyer")
    product = _product(db, popup_tenant_a)
    payment, recipient, line = _payment(db, popup_tenant_a, buyer, product, quantity=2)

    payments_crud.approve_payment(db, payment.id)
    db.refresh(recipient)
    db.refresh(line)
    attendee = db.get(Attendees, recipient.attendee_id)
    tickets = _tickets(db, payment.id)

    assert attendee is not None
    assert attendee.human_id is None
    assert attendee.managed_by_human_id is None
    assert attendee.additional_data == {"dietary_restriction": "vegan"}
    assert line.attendee_id == attendee.id
    assert [ticket.unit_index for ticket in tickets] == [0, 1]
    assert all(ticket.payment_product_id == line.id for ticket in tickets)
    assert all(ticket.purchase_metadata == {"meal": "vegan"} for ticket in tickets)

    preserved_code = tickets[0].check_in_code
    db.delete(tickets[1])
    db.commit()
    payments_crud.approve_payment(db, payment.id)

    repaired = _tickets(db, payment.id)
    assert len(repaired) == 2
    assert [ticket.unit_index for ticket in repaired] == [0, 1]
    assert repaired[0].check_in_code == preserved_code

    payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)
    assert all(ticket.revoked_at is not None for ticket in _tickets(db, payment.id))
    assert db.get(PaymentRecipients, recipient.id) is not None
    assert db.get(Attendees, attendee.id) is not None


def test_same_access_product_keeps_recipient_price_category_and_qr_lines_separate(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer = _human(db, tenant_a, "DiscountBuyer")
    product = _product(db, popup_tenant_a, "ticket")
    adult_category = _category(db, popup_tenant_a)
    child_category = AttendeeCategories(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        key=f"discount-child-{uuid.uuid4().hex[:6]}",
    )
    db.add(child_category)
    db.flush()
    payment, adult_recipient, adult_line = _payment(db, popup_tenant_a, buyer, product)
    adult_recipient.recipient_key = "discount-adult"
    adult_recipient.category_id = adult_category.id
    adult_line.effective_unit_price = Decimal("25")
    child_recipient = PaymentRecipients(
        tenant_id=tenant_a.id,
        payment_id=payment.id,
        recipient_key="discount-child",
        name="Child",
        category_id=child_category.id,
    )
    db.add(child_recipient)
    db.flush()
    child_line = _line(db, payment, product, recipient=child_recipient)
    child_line.effective_unit_price = Decimal("15")
    payment.amount = Decimal("40")
    db.commit()

    payments_crud.approve_payment(db, payment.id)
    db.expire_all()

    durable_lines = db.exec(
        select(PaymentProducts)
        .where(PaymentProducts.payment_id == payment.id)
        .order_by(PaymentProducts.effective_unit_price.desc())
    ).all()
    durable_recipients = {
        recipient.id: recipient
        for recipient in db.exec(
            select(PaymentRecipients).where(PaymentRecipients.payment_id == payment.id)
        ).all()
    }
    holdings = _tickets(db, payment.id)
    holdings_by_line = {holding.payment_product_id: holding for holding in holdings}
    attendees_by_id = {
        attendee.id: attendee
        for attendee in db.exec(
            select(Attendees).where(
                Attendees.id.in_([holding.attendee_id for holding in holdings])
            )
        ).all()
    }

    assert len(durable_lines) == len(durable_recipients) == len(holdings) == 2
    assert [
        (
            durable_recipients[line.payment_recipient_id].recipient_key,
            durable_recipients[line.payment_recipient_id].category_id,
            attendees_by_id[holdings_by_line[line.id].attendee_id].category_id,
            line.effective_unit_price,
            holdings_by_line[line.id].payment_product_id,
        )
        for line in durable_lines
    ] == [
        (
            "discount-adult",
            adult_category.id,
            adult_category.id,
            Decimal("25.00"),
            adult_line.id,
        ),
        (
            "discount-child",
            child_category.id,
            child_category.id,
            Decimal("15.00"),
            child_line.id,
        ),
    ]
    assert len({holding.attendee_id for holding in holdings}) == 2
    assert len({holding.check_in_code for holding in holdings}) == 2
    assert all(holding.product_id == product.id for holding in holdings)
    assert all(holding.unit_index == 0 for holding in holdings)


def test_linked_recipient_reuses_popup_attendee_without_changing_manager(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer = _human(db, tenant_a, "Linked")
    other_manager = _human(db, tenant_a, "ExistingManager")
    product = _product(db, popup_tenant_a)
    existing = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        human_id=buyer.id,
        managed_by_human_id=other_manager.id,
        name="Existing identity",
        category_id=_category(db, popup_tenant_a).id,
    )
    db.add(existing)
    db.commit()
    payment, recipient, _ = _payment(db, popup_tenant_a, buyer, product, human=buyer)

    payments_crud.approve_payment(db, payment.id)
    db.refresh(recipient)
    db.refresh(existing)

    assert recipient.attendee_id == existing.id
    assert existing.managed_by_human_id == other_manager.id
    assert len(_tickets(db, payment.id)) == 1


def test_approval_materializes_only_referenced_recipients_without_application_link(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer = _human(db, tenant_a, "SnapshotBuyer")
    applicant = _human(db, tenant_a, "Applicant")
    product = _product(db, popup_tenant_a)
    payment, recipient, _ = _payment(db, popup_tenant_a, buyer, product)
    application = Applications(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        human_id=applicant.id,
        sales_flow_id=application_flow_id(db, popup_tenant_a.id),
    )
    db.add(application)
    db.flush()
    payment.application_id = application.id
    unreferenced = PaymentRecipients(
        tenant_id=tenant_a.id,
        payment_id=payment.id,
        recipient_key="unreferenced",
        name="No entitlement",
        category_id=_category(db, popup_tenant_a).id,
    )
    db.add(unreferenced)
    db.commit()

    payments_crud.approve_payment(db, payment.id)
    db.refresh(recipient)
    db.refresh(unreferenced)
    attendee = db.get(Attendees, recipient.attendee_id)

    assert attendee is not None
    assert attendee.application_id is None
    assert unreferenced.attendee_id is None
    assert _resolve_payment_buyer(payment, db) == buyer


@pytest.mark.parametrize("invalid_field", ["tenant", "popup", "category"])
def test_explicit_reuse_rejects_invalid_scope_without_transferring_ownership(
    db: Session,
    tenant_a: Tenants,
    tenant_b: Tenants,
    popup_tenant_a: Popups,
    popup_tenant_b: Popups,
    invalid_field: str,
) -> None:
    buyer = _human(db, tenant_a, "ReuseBuyer")
    product = _product(db, popup_tenant_a)
    wrong_category = AttendeeCategories(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        key=f"wrong-{uuid.uuid4().hex[:6]}",
    )
    db.add(wrong_category)
    db.flush()
    attendee = Attendees(
        tenant_id=tenant_b.id if invalid_field == "tenant" else tenant_a.id,
        popup_id=popup_tenant_b.id if invalid_field == "popup" else popup_tenant_a.id,
        name="Managed guest",
        category_id=(
            wrong_category.id
            if invalid_field == "category"
            else _category(db, popup_tenant_a).id
        ),
        managed_by_human_id=buyer.id,
    )
    db.add(attendee)
    db.commit()
    payment, recipient, line = _payment(
        db, popup_tenant_a, buyer, product, existing_attendee=attendee
    )

    with pytest.raises(HTTPException) as error:
        payments_crud.approve_payment(db, payment.id)

    assert error.value.status_code == 422
    assert error.value.detail == "Recipient could not be fulfilled"
    db.refresh(attendee)
    db.refresh(recipient)
    db.refresh(line)
    assert attendee.managed_by_human_id == buyer.id
    assert recipient.attendee_id is None
    assert line.attendee_id is None


def test_explicit_recipient_reuse_ignores_existing_manager_metadata(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer = _human(db, tenant_a, "ExplicitBuyer")
    existing_manager = _human(db, tenant_a, "UnrelatedManager")
    product = _product(db, popup_tenant_a)
    attendee = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        name="Explicit guest",
        category_id=_category(db, popup_tenant_a).id,
        managed_by_human_id=existing_manager.id,
    )
    db.add(attendee)
    db.flush()
    prior_payment = Payments(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        buyer_human_id=buyer.id,
        status=PaymentStatus.APPROVED.value,
        amount=product.price,
    )
    db.add(prior_payment)
    db.flush()
    db.add(
        PaymentRecipients(
            tenant_id=tenant_a.id,
            payment_id=prior_payment.id,
            recipient_key="prior-explicit-recipient",
            attendee_id=attendee.id,
            name=attendee.name,
            category_id=attendee.category_id,
        )
    )
    db.commit()
    payment, recipient, line = _payment(
        db, popup_tenant_a, buyer, product, existing_attendee=attendee
    )

    payments_crud.approve_payment(db, payment.id)
    db.refresh(attendee)
    db.refresh(recipient)
    db.refresh(line)

    assert attendee.managed_by_human_id == existing_manager.id
    assert recipient.attendee_id == attendee.id
    assert line.attendee_id == attendee.id
    assert [unit.attendee_id for unit in _tickets(db, payment.id)] == [attendee.id]


def test_concurrent_approval_and_legacy_or_fee_compatibility(
    db: Session,
    test_engine,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    buyer = _human(db, tenant_a, "Concurrent")
    product = _product(db, popup_tenant_a, "ticket")
    payment, recipient, access_line = _payment(
        db, popup_tenant_a, buyer, product, quantity=2
    )
    participant_line = _line(
        db,
        payment,
        _product(db, popup_tenant_a, "meal_plan"),
        recipient=recipient,
        metadata={"meal": "vegan"},
    )
    order_line = _line(db, payment, _product(db, popup_tenant_a, "merch"))
    db.commit()
    attendee_count = _attendee_count(db, popup_tenant_a)
    started = Event()

    def approve() -> None:
        started.set()
        with Session(test_engine) as worker:
            payments_crud.approve_payment(worker, payment.id)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(approve) for _ in range(2)]
        assert started.wait(timeout=5)
        for future in futures:
            future.result(timeout=10)

    db.expire_all()
    tickets = _tickets(db, payment.id)
    assert sorted(ticket.product_category_snapshot for ticket in tickets) == [
        "meal_plan",
        "ticket",
        "ticket",
    ]
    assert {ticket.payment_product_id for ticket in tickets} == {
        access_line.id,
        participant_line.id,
    }
    stable_codes = [ticket.check_in_code for ticket in tickets]
    stable_lineage = {
        (ticket.id, ticket.payment_product_id, ticket.unit_index) for ticket in tickets
    }
    recipient_attendee_id = recipient.attendee_id
    payments_crud.approve_payment(db, payment.id)
    db.refresh(recipient)
    for line in (access_line, participant_line, order_line):
        db.refresh(line)
    replayed = _tickets(db, payment.id)
    assert [ticket.check_in_code for ticket in replayed] == stable_codes
    assert {
        (ticket.id, ticket.payment_product_id, ticket.unit_index) for ticket in replayed
    } == stable_lineage
    assert recipient.attendee_id == recipient_attendee_id is not None
    assert {
        line.attendee_id for line in (access_line, participant_line, order_line)
    } == {recipient_attendee_id, None}
    assert _attendee_count(db, popup_tenant_a) == attendee_count + 1

    legacy_attendee = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        human_id=buyer.id,
        name="Legacy attendee",
        category_id=_category(db, popup_tenant_a).id,
    )
    db.add(legacy_attendee)
    db.flush()
    legacy_payment = Payments(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        status=PaymentStatus.PENDING.value,
        amount=product.price,
    )
    db.add(legacy_payment)
    db.flush()
    db.add(
        PaymentProducts(
            tenant_id=tenant_a.id,
            payment_id=legacy_payment.id,
            attendee_id=legacy_attendee.id,
            product_id=product.id,
            product_name=product.name,
            product_price=product.price,
            product_category="ticket",
        )
    )
    db.commit()
    payments_crud.approve_payment(db, legacy_payment.id)
    legacy_tickets = _tickets(db, legacy_payment.id)
    assert len(legacy_tickets) == 1
    assert legacy_tickets[0].product_category_snapshot == "ticket"

    fee, _, _ = _payment(
        db,
        popup_tenant_a,
        buyer,
        product,
        payment_type=PaymentType.APPLICATION_FEE,
    )
    payments_crud.approve_payment(db, fee.id)
    assert _tickets(db, fee.id) == []


def test_mixed_snapshot_approval_materializes_personal_lineage_and_skips_merch(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer = _human(db, tenant_a, "MixedBuyer")
    products = {
        category: _product(db, popup_tenant_a, category)
        for category in ("ticket", "meal_plan", "merch")
    }
    payment, recipient, access_line = _payment(
        db, popup_tenant_a, buyer, products["ticket"], quantity=2
    )
    participant_line = _line(
        db,
        payment,
        products["meal_plan"],
        recipient=recipient,
        metadata={"meal": "vegan"},
    )
    order_line = _line(db, payment, products["merch"])
    db.commit()

    payments_crud.approve_payment(db, payment.id)
    db.refresh(recipient)
    for line in (access_line, participant_line, order_line):
        db.refresh(line)
    tickets = _tickets(db, payment.id)

    assert sorted(ticket.product_category_snapshot for ticket in tickets) == [
        "meal_plan",
        "ticket",
        "ticket",
    ]
    assert tickets[-1].purchase_metadata == {"meal": "vegan"}
    assert {ticket.payment_product_id for ticket in tickets} == {
        access_line.id,
        participant_line.id,
    }
    assert recipient.attendee_id is not None
    assert {
        line.attendee_id for line in (access_line, participant_line, order_line)
    } == {recipient.attendee_id, None}


def test_side_only_merch_approval_creates_no_attendee_or_unit(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer = _human(db, tenant_a, "OrderBuyer")
    product = _product(db, popup_tenant_a, "merch")
    attendee = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        human_id=buyer.id,
        name="Legacy order owner",
        category_id=_category(db, popup_tenant_a).id,
    )
    db.add(attendee)
    db.flush()
    payment = Payments(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        buyer_human_id=buyer.id,
        status=PaymentStatus.PENDING.value,
        amount=product.price,
    )
    db.add(payment)
    db.flush()
    line = _line(db, payment, product)
    holding = AttendeeProducts(
        tenant_id=tenant_a.id,
        attendee_id=attendee.id,
        product_id=product.id,
        check_in_code="LEGACY01",
        payment_id=payment.id,
        payment_product_id=line.id,
        unit_index=0,
        product_category_snapshot="merch",
    )
    db.add(holding)
    db.commit()
    attendee_count = _attendee_count(db, popup_tenant_a)

    payments_crud.approve_payment(db, payment.id)
    assert line.attendee_id is None
    assert _tickets(db, payment.id) == [holding]
    assert _attendee_count(db, popup_tenant_a) == attendee_count


@pytest.mark.parametrize("grant", ["application", "ticket", "unresolved"])
def test_application_or_existing_unit_authority(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
    grant: str,
) -> None:
    buyer = _human(db, tenant_a, "Entitled")
    category = _category(db, popup_tenant_a)
    purchased_product = _product(db, popup_tenant_a)
    if grant == "application":
        application = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=buyer.id,
            sales_flow_id=application_flow_id(db, popup_tenant_a.id),
            status=ApplicationStatus.ACCEPTED.value,
        )
        db.add(application)
        db.flush()
        payment, _, _ = _payment(
            db, popup_tenant_a, buyer, purchased_product, human=buyer
        )
        payment.application_id = application.id
    else:
        attendee = Attendees(
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            managed_by_human_id=buyer.id,
            name="Existing guest",
            category_id=category.id,
        )
        prior_product = _product(db, popup_tenant_a)
        db.add(attendee)
        db.flush()
        db.add(
            AttendeeProducts(
                tenant_id=tenant_a.id,
                attendee_id=attendee.id,
                product_id=prior_product.id,
                check_in_code=uuid.uuid4().hex[:8].upper(),
                product_category_snapshot="ticket" if grant == "ticket" else None,
            )
        )
        db.commit()
        payment, _, _ = _payment(
            db, popup_tenant_a, buyer, purchased_product, existing_attendee=attendee
        )
    db.commit()

    if grant == "application":
        payments_crud.approve_payment(db, payment.id)
        assert [
            ticket.product_category_snapshot for ticket in _tickets(db, payment.id)
        ] == ["ticket"]
    else:
        with pytest.raises(HTTPException) as error:
            payments_crud.approve_payment(db, payment.id)
        assert error.value.status_code == 422
        assert _tickets(db, payment.id) == []


def test_payment_application_allocates_accountless_ticket_unit(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer = _human(db, tenant_a, "FamilyApplicant")
    application = Applications(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        human_id=buyer.id,
        sales_flow_id=application_flow_id(db, popup_tenant_a.id),
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.flush()
    payment, _, _ = _payment(db, popup_tenant_a, buyer, _product(db, popup_tenant_a))
    payment.application_id = application.id
    db.add(payment)
    db.commit()

    payments_crud.approve_payment(db, payment.id)

    assert [
        ticket.product_category_snapshot for ticket in _tickets(db, payment.id)
    ] == ["ticket"]


def test_same_payment_access_does_not_cross_recipient_identity(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer = _human(db, tenant_a, "SharedAttendee")
    attendee = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        managed_by_human_id=buyer.id,
        name="Shared attendee",
        category_id=_category(db, popup_tenant_a).id,
    )
    db.add(attendee)
    db.flush()
    payment, _, _ = _payment(
        db,
        popup_tenant_a,
        buyer,
        _product(db, popup_tenant_a, "ticket"),
        human=buyer,
        existing_attendee=attendee,
    )
    meal_recipient = PaymentRecipients(
        tenant_id=tenant_a.id,
        payment_id=payment.id,
        recipient_key="different-snapshot",
        existing_attendee_id=attendee.id,
        name="Same attendee, different recipient",
        category_id=attendee.category_id,
    )
    db.add(meal_recipient)
    db.flush()
    _line(
        db,
        payment,
        _product(db, popup_tenant_a, "meal_plan"),
        recipient=meal_recipient,
    )
    db.commit()

    with pytest.raises(HTTPException) as error:
        payments_crud.approve_payment(db, payment.id)

    assert error.value.detail == "Recipient could not be fulfilled"
    assert _tickets(db, payment.id) == []


def test_self_attendee_allocates_ticket_when_prior_product_is_inactive(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer = _human(db, tenant_a, "InactiveAccess")
    attendee = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        human_id=buyer.id,
        name="Existing guest",
        category_id=_category(db, popup_tenant_a).id,
    )
    ticket_product = _product(db, popup_tenant_a, "ticket")
    ticket_product.is_active = False
    db.add(attendee)
    db.flush()
    db.add(
        AttendeeProducts(
            tenant_id=tenant_a.id,
            attendee_id=attendee.id,
            product_id=ticket_product.id,
            check_in_code=uuid.uuid4().hex[:8].upper(),
            product_category_snapshot="ticket",
        )
    )
    db.commit()
    payment, _, _ = _payment(
        db,
        popup_tenant_a,
        buyer,
        _product(db, popup_tenant_a, "ticket"),
        human=buyer,
    )

    payments_crud.approve_payment(db, payment.id)

    assert [
        ticket.product_category_snapshot for ticket in _tickets(db, payment.id)
    ] == ["ticket"]


def test_recipient_category_mismatch_rejects_and_rolls_back_materialization(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    other = AttendeeCategories(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        key=f"other-{uuid.uuid4().hex[:6]}",
    )
    db.add(other)
    db.flush()
    buyer = _human(db, tenant_a, "InvalidRecipientCategory")
    product = _product(
        db,
        popup_tenant_a,
        "ticket",
        attendee_category_id=other.id,
    )
    attendee_count = _attendee_count(db, popup_tenant_a)
    payment, recipient, line = _payment(db, popup_tenant_a, buyer, product)

    with pytest.raises(HTTPException) as error:
        payments_crud.approve_payment(db, payment.id)

    assert (error.value.status_code, error.value.detail) == (
        422,
        "Recipient could not be fulfilled",
    )
    db.refresh(payment)
    db.refresh(recipient)
    db.refresh(line)
    assert (payment.status, recipient.attendee_id, line.attendee_id) == (
        PaymentStatus.PENDING.value,
        None,
        None,
    )
    assert _tickets(db, payment.id) == []
    assert _attendee_count(db, popup_tenant_a) == attendee_count


@pytest.mark.parametrize(
    "invalid_scope", ["recipient_tenant", "recipient_category", "product_popup"]
)
def test_approval_rejects_cross_scope_snapshot_data(
    db: Session,
    tenant_a: Tenants,
    tenant_b: Tenants,
    popup_tenant_a: Popups,
    popup_tenant_b: Popups,
    invalid_scope: str,
) -> None:
    buyer = _human(db, tenant_a, "ScopeBuyer")
    product = _product(db, popup_tenant_a)
    payment, recipient, line = _payment(db, popup_tenant_a, buyer, product)
    if invalid_scope == "recipient_tenant":
        recipient.tenant_id = tenant_b.id
    elif invalid_scope == "recipient_category":
        recipient.category_id = _category(db, popup_tenant_b).id
    else:
        line.product_id = _product(db, popup_tenant_b).id
    db.add(recipient)
    db.add(line)
    db.commit()

    with pytest.raises(HTTPException) as error:
        payments_crud.approve_payment(db, payment.id)

    assert error.value.status_code == 422
    assert _tickets(db, payment.id) == []


def test_sweeper_repairs_approved_payment_and_terminal_state_blocks_reapproval(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer = _human(db, tenant_a, "SweeperBuyer")
    product = _product(db, popup_tenant_a)
    payment, _, _ = _payment(db, popup_tenant_a, buyer, product, quantity=2)
    payments_crud.approve_payment(db, payment.id)
    db.delete(_tickets(db, payment.id)[1])
    db.commit()

    payments_crud._reconcile_approved(db, payment)
    assert len(_tickets(db, payment.id)) == 2

    payments_crud.update_status(db, payment.id, PaymentStatus.CANCELLED)
    with pytest.raises(HTTPException) as error:
        payments_crud.approve_payment(db, payment.id)
    assert error.value.status_code == 409
    assert all(ticket.revoked_at is not None for ticket in _tickets(db, payment.id))


def test_notification_resolves_direct_buyer_from_payment_snapshot(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer = _human(db, tenant_a, "NotificationBuyer")
    payment = Payments(
        tenant_id=tenant_a.id,
        popup_id=popup_tenant_a.id,
        buyer_human_id=buyer.id,
        amount=Decimal("10"),
    )
    db.add(payment)
    db.commit()

    assert _resolve_payment_buyer(payment, db) == buyer


@pytest.mark.parametrize(
    ("payment_type", "should_reconcile"),
    [(PaymentType.PASS_PURCHASE, True), (PaymentType.APPLICATION_FEE, False)],
)
def test_duplicate_approved_webhook_reconciles_pass_fulfillment(
    monkeypatch, payment_type: PaymentType, should_reconcile: bool
) -> None:
    payment = SimpleNamespace(
        id=uuid.uuid4(),
        external_id="provider-id",
        status=PaymentStatus.APPROVED.value,
        payment_type=payment_type.value,
    )
    calls: list[uuid.UUID] = []

    class FakeCRUD:
        def get_by_external_id(self, _db, _external_id):
            return payment

        def approve_payment(self, _db, payment_id):
            calls.append(payment_id)
            return payment

    class Cache:
        def add(self, _fingerprint):
            return True

    payment_router = importlib.import_module("app.api.payment.router")
    monkeypatch.setattr(payment_router, "payments_crud", FakeCRUD())
    payload = SimpleNamespace(
        event_type="new_payment",
        data=SimpleNamespace(
            payment_request=SimpleNamespace(id="provider-id", status="approved")
        ),
    )

    result = asyncio.run(_handle_regular_payment(payload, object(), Cache()))

    assert result == {"message": "Payment status unchanged"}
    assert calls == ([payment.id] if should_reconcile else [])
