import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.checkout.schemas import BuyerInfo, OpenTicketingPurchaseCreate, ProductLine
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, PaymentRecipients
from app.api.payment.schemas import (
    ApplicationFeeCreate,
    PaymentCreate,
    PaymentProductRequest,
    PaymentProductResponse,
    PaymentPublic,
)
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from tests._flow_helpers import seed_default_steps


def _payment_context(db: Session, tenant: Tenants):
    popup = Popups(
        tenant_id=tenant.id,
        name="Recipient payment",
        slug=f"recipient-payment-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.application.value,
        status="active",
        simplefi_api_key="test-key",
        currency="USD",
    )
    db.add(popup)
    db.flush()
    flow = seed_default_steps(db, popup, sale_type=SaleType.application.value)
    buyer = Humans(
        tenant_id=tenant.id,
        email=f"recipient-buyer-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Buyer",
    )
    category = AttendeeCategories(
        tenant_id=tenant.id,
        popup_id=popup.id,
        key=f"main-{uuid.uuid4().hex[:6]}",
        is_primary=True,
    )
    db.add_all([buyer, category])
    db.flush()
    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=buyer.id,
        sales_flow_id=flow.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name="Recipient pass",
        slug=f"recipient-pass-{uuid.uuid4().hex[:8]}",
        price=Decimal("25"),
        category="ticket",
        attendee_category_id=category.id,
        is_active=True,
    )
    db.add_all([application, product])
    db.commit()
    return popup, flow, buyer, category, application, product


def _request(
    application,
    product,
    category,
    *,
    existing_attendee_id=None,
    human_id=None,
    recipient_name="Managed Child",
):
    return PaymentCreate(
        application_id=application.id,
        recipients=[
            {
                "recipient_key": "child",
                "name": recipient_name,
                "email": "child@test.com",
                "category_id": category.id,
                "existing_attendee_id": existing_attendee_id,
                "human_id": human_id,
                "profile_snapshot": {"dietary_restriction": "vegan"},
            },
            {
                "recipient_key": "not-purchased",
                "name": "Not Purchased",
                "category_id": category.id,
            },
        ],
        products=[PaymentProductRequest(product_id=product.id, recipient_key="child")],
    )


def test_payment_attempts_write_distinct_immutable_recipient_snapshots(
    db: Session, tenant_a: Tenants
) -> None:
    popup, _, buyer, category, application, product = _payment_context(db, tenant_a)
    request = _request(application, product, category)
    provider_responses = [
        SimpleNamespace(
            id=f"provider-{index}",
            status="pending",
            checkout_url=f"https://pay.test/{index}",
            is_installment_plan=False,
        )
        for index in range(2)
    ]

    with (
        patch("app.core.config.settings.SUPERSEDE_PENDING_ENABLED", False),
        patch("app.services.simplefi.get_simplefi_client") as get_client,
    ):
        get_client.return_value.create_payment.side_effect = provider_responses
        first, _ = payments_crud.create_payment(db, request)
        second, _ = payments_crud.create_payment(db, request)

    recipients = list(
        db.exec(
            select(PaymentRecipients)
            .where(PaymentRecipients.payment_id.in_([first.id, second.id]))
            .order_by(PaymentRecipients.payment_id)
        ).all()
    )
    lines = list(
        db.exec(
            select(PaymentProducts).where(
                PaymentProducts.payment_id.in_([first.id, second.id])
            )
        ).all()
    )

    assert first.id != second.id
    assert first.buyer_human_id == second.buyer_human_id == buyer.id
    assert len(recipients) == 2
    assert {recipient.recipient_key for recipient in recipients} == {"child"}
    assert len({recipient.id for recipient in recipients}) == 2
    assert all(
        recipient.profile_snapshot == {"dietary_restriction": "vegan"}
        for recipient in recipients
    )
    assert all(line.attendee_id is None for line in lines)
    assert {line.payment_recipient_id for line in lines} == {
        recipient.id for recipient in recipients
    }
    assert db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all() == []

    public = PaymentPublic.model_validate(first)
    assert public.recipients[0].recipient_key == "child"
    assert public.products_snapshot[0].recipient_key == "child"
    assert public.products_snapshot[0].attendee_name == "Managed Child"


def test_invalid_existing_attendee_is_rejected_before_provider_creation(
    db: Session, tenant_a: Tenants
) -> None:
    popup, _, _, category, application, product = _payment_context(db, tenant_a)
    other_manager = Humans(
        tenant_id=tenant_a.id,
        email=f"other-manager-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(other_manager)
    db.flush()
    attendee = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        name="Owned elsewhere",
        category_id=category.id,
        managed_by_human_id=other_manager.id,
    )
    db.add(attendee)
    db.commit()

    with (
        patch("app.core.config.settings.SUPERSEDE_PENDING_ENABLED", True),
        patch.object(payments_crud, "supersede_pending_payments") as supersede,
        patch("app.services.simplefi.get_simplefi_client") as get_client,
    ):
        with pytest.raises(HTTPException) as error:
            payments_crud.create_payment(
                db,
                _request(
                    application,
                    product,
                    category,
                    existing_attendee_id=attendee.id,
                ),
            )

    assert error.value.status_code == 422
    assert error.value.detail == "Recipient is not valid for this payment"
    supersede.assert_not_called()
    get_client.assert_not_called()
    db.refresh(attendee)
    assert attendee.managed_by_human_id == other_manager.id


def test_payment_line_rejects_both_legacy_and_recipient_identity() -> None:
    with pytest.raises(ValidationError):
        PaymentProductRequest(
            product_id=uuid.uuid4(),
            attendee_id=uuid.uuid4(),
            recipient_key="ambiguous",
        )


def test_legacy_line_keeps_attendee_projection() -> None:
    attendee = Attendees(
        tenant_id=uuid.uuid4(),
        popup_id=uuid.uuid4(),
        name="Legacy Recipient",
    )
    line = PaymentProducts(
        tenant_id=attendee.tenant_id,
        payment_id=uuid.uuid4(),
        product_id=uuid.uuid4(),
        attendee_id=attendee.id,
        product_name="Legacy pass",
        product_price=Decimal("10"),
        product_category="ticket",
    )
    line.attendee = attendee

    public = PaymentProductResponse.model_validate(line)

    assert public.attendee_id == attendee.id
    assert public.attendee_name == "Legacy Recipient"
    assert public.payment_recipient_id is None
    assert public.recipient_key is None


def test_recipient_line_keeps_snapshot_name_after_attendee_changes() -> None:
    payment_id = uuid.uuid4()
    attendee = Attendees(
        tenant_id=uuid.uuid4(),
        popup_id=uuid.uuid4(),
        name="Current Attendee Name",
    )
    recipient = PaymentRecipients(
        tenant_id=attendee.tenant_id,
        payment_id=payment_id,
        recipient_key="recipient",
        name="Purchased Recipient Name",
    )
    line = PaymentProducts(
        tenant_id=attendee.tenant_id,
        payment_id=payment_id,
        product_id=uuid.uuid4(),
        attendee_id=attendee.id,
        payment_recipient_id=recipient.id,
        product_name="Recipient pass",
        product_price=Decimal("10"),
        product_category="ticket",
    )
    line.attendee = attendee
    line.recipient = recipient

    public = PaymentProductResponse.model_validate(line)

    assert public.attendee_name == "Purchased Recipient Name"


def test_linked_human_category_conflict_is_rejected_before_provider_creation(
    db: Session, tenant_a: Tenants
) -> None:
    popup, _, _, category, application, product = _payment_context(db, tenant_a)
    linked_human = Humans(
        tenant_id=tenant_a.id,
        email=f"linked-recipient-{uuid.uuid4().hex[:8]}@test.com",
    )
    other_category = AttendeeCategories(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        key=f"other-{uuid.uuid4().hex[:6]}",
    )
    db.add_all([linked_human, other_category])
    db.flush()
    db.add(
        Attendees(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            human_id=linked_human.id,
            managed_by_human_id=linked_human.id,
            name="Existing linked attendee",
            category_id=other_category.id,
        )
    )
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        with pytest.raises(HTTPException) as error:
            payments_crud.create_payment(
                db,
                _request(
                    application,
                    product,
                    category,
                    human_id=linked_human.id,
                ),
            )

    assert error.value.status_code == 422
    assert error.value.detail == "Recipient is not valid for this payment"
    get_client.assert_not_called()


def test_recent_recipient_payment_with_different_identity_is_not_reused(
    db: Session, tenant_a: Tenants
) -> None:
    _, _, _, category, application, product = _payment_context(db, tenant_a)
    first_human = Humans(
        tenant_id=tenant_a.id,
        email=f"first-recipient-{uuid.uuid4().hex[:8]}@test.com",
    )
    second_human = Humans(
        tenant_id=tenant_a.id,
        email=f"second-recipient-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add_all([first_human, second_human])
    db.commit()
    provider_responses = [
        SimpleNamespace(
            id=f"approved-provider-{index}",
            status="approved",
            checkout_url=f"https://pay.test/approved/{index}",
            is_installment_plan=False,
        )
        for index in range(2)
    ]

    with (
        patch("app.core.config.settings.SUPERSEDE_PENDING_ENABLED", False),
        patch("app.services.simplefi.get_simplefi_client") as get_client,
    ):
        get_client.return_value.create_payment.side_effect = provider_responses
        first, _ = payments_crud.create_payment(
            db,
            _request(
                application,
                product,
                category,
                human_id=first_human.id,
                recipient_name="First Recipient",
            ),
        )
        second, _ = payments_crud.create_payment(
            db,
            _request(
                application,
                product,
                category,
                human_id=second_human.id,
                recipient_name="Second Recipient",
            ),
        )

    assert first.id != second.id
    assert get_client.return_value.create_payment.call_count == 2
    snapshots = list(
        db.exec(
            select(PaymentRecipients).where(
                PaymentRecipients.payment_id.in_([first.id, second.id])
            )
        ).all()
    )
    assert {snapshot.human_id for snapshot in snapshots} == {
        first_human.id,
        second_human.id,
    }


def test_application_fee_snapshots_buyer_but_accepts_no_recipients(
    db: Session, tenant_a: Tenants
) -> None:
    popup, flow, buyer, _, application, _ = _payment_context(db, tenant_a)
    flow.requires_application_fee = True
    flow.application_fee_amount = Decimal("12")
    application.status = ApplicationStatus.PENDING_FEE.value
    db.add_all([flow, application])
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        get_client.return_value.create_payment.return_value = SimpleNamespace(
            id="fee-provider-id",
            status="pending",
            checkout_url="https://pay.test/fee",
        )
        payment = payments_crud.create_fee_payment(db, application, popup)

    assert payment.buyer_human_id == buyer.id
    assert payment.recipients == []
    assert (
        db.exec(
            select(PaymentRecipients).where(PaymentRecipients.payment_id == payment.id)
        ).all()
        == []
    )
    with pytest.raises(ValidationError):
        ApplicationFeeCreate.model_validate(
            {
                "application_id": str(application.id),
                "recipients": [{"recipient_key": "x"}],
            }
        )


def test_open_checkout_writes_uncategorized_recipient_without_attendee(
    db: Session, tenant_a: Tenants
) -> None:
    popup = Popups(
        tenant_id=tenant_a.id,
        name="Open recipient payment",
        slug=f"open-recipient-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.direct.value,
        status="active",
        simplefi_api_key="test-key",
        currency="USD",
    )
    db.add(popup)
    db.flush()
    flow = seed_default_steps(db, popup, sale_type=SaleType.direct.value)
    product = Products(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        name="Guest pass",
        slug=f"guest-pass-{uuid.uuid4().hex[:8]}",
        price=Decimal("20"),
        category="ticket",
    )
    db.add(product)
    db.commit()
    request = OpenTicketingPurchaseCreate(
        buyer=BuyerInfo(
            email="open-recipient@test.com", first_name="Open", last_name="Buyer"
        ),
        recipients=[
            {
                "recipient_key": "guest",
                "name": "Guest Recipient",
                "profile_snapshot": {"accessibility": "aisle"},
            }
        ],
        products=[ProductLine(product_id=product.id, recipient_key="guest")],
    )

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        get_client.return_value.create_payment.return_value = SimpleNamespace(
            id="open-provider-id",
            status="pending",
            checkout_url="https://pay.test/open",
            is_installment_plan=False,
        )
        payment, _, _ = payments_crud.create_open_ticketing_payment(
            db,
            obj=request,
            popup=popup,
            tenant=tenant_a,
            flow_slug=flow.slug,
        )

    recipient = db.exec(
        select(PaymentRecipients).where(PaymentRecipients.payment_id == payment.id)
    ).one()
    line = db.exec(
        select(PaymentProducts).where(PaymentProducts.payment_id == payment.id)
    ).one()
    assert payment.buyer_human_id is not None
    assert recipient.recipient_key == "guest"
    assert recipient.profile_snapshot == {"accessibility": "aisle"}
    assert recipient.category_id is None
    assert line.payment_recipient_id == recipient.id
    assert line.attendee_id is None
    assert db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all() == []

    payments_crud.approve_payment(db, payment.id)

    attendee = db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).one()
    assert attendee.name == "Guest Recipient"
    assert attendee.category_id is None
