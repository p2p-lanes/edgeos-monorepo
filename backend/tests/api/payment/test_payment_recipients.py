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
from app.api.payment.models import PaymentProducts, PaymentRecipients, Payments
from app.api.payment.schemas import (
    ApplicationFeeCreate,
    PaymentCreate,
    PaymentProductRequest,
    PaymentProductResponse,
    PaymentPublic,
    PaymentStatus,
)
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.api.tenant.utils import get_portal_url
from app.api.ticketing_step.constants import seed_ticketing_steps_for_popup
from app.api.ticketing_step.models import TicketingSteps
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
        sales_flow_id=flow.id,
        key="companion",
    )
    db.add(category)
    db.add(buyer)
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


def _set_ticket_recipient_categories(
    db: Session,
    flow: SalesFlows,
    product: Products,
    categories: list[AttendeeCategories] | None,
) -> None:
    step = db.exec(
        select(TicketingSteps).where(
            TicketingSteps.sales_flow_id == flow.id,
            TicketingSteps.template == "ticket-select",
        )
    ).one()
    step.template_config = {
        "sections": [
            {
                "key": "passes",
                "label": "Passes",
                "order": 0,
                "product_ids": [str(product.id)],
                "attendee_categories": (
                    [str(category.id) for category in categories]
                    if categories is not None
                    else None
                ),
            }
        ]
    }
    db.add(step)
    db.commit()


def _provider_response(label: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=f"provider-{label}-{uuid.uuid4().hex[:6]}",
        status="pending",
        checkout_url=f"https://pay.test/{label}",
        is_installment_plan=False,
    )


@pytest.mark.parametrize("payment_kind", ["passes", "application_fee"])
@pytest.mark.parametrize("secondary_flow", [False, True])
def test_application_payment_redirects_preserve_the_application_flow(
    db: Session,
    tenant_a: Tenants,
    payment_kind: str,
    secondary_flow: bool,
) -> None:
    popup, flow, buyer, category, application, product = _payment_context(db, tenant_a)
    if secondary_flow:
        # The same buyer also has an application through the default flow.
        # Neither that application nor the popup default should win on return.
        flow = SalesFlows(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            slug="partners",
            name="Partners",
            type=SaleType.application.value,
        )
        db.add(flow)
        db.flush()
        from app.api.attendee_category.crud import attendee_categories_crud

        attendee_categories_crud.seed_for_flow(
            db, flow, source_flow_id=application.sales_flow_id
        )
        db.flush()
        category = next(
            category
            for category in attendee_categories_crud.list_by_flow(db, flow.id)
            if not category.is_primary
        )
        product.attendee_category_id = category.id
        db.add(product)
        seed_ticketing_steps_for_popup(
            db,
            popup_id=popup.id,
            tenant_id=tenant_a.id,
            sales_flow_id=flow.id,
            flow_type=flow.type,
        )
        application = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            human_id=buyer.id,
            sales_flow_id=flow.id,
            status=ApplicationStatus.ACCEPTED.value,
        )
        db.add(application)

    if payment_kind == "application_fee":
        flow.requires_application_fee = True
        flow.application_fee_amount = Decimal("12")
        application.status = ApplicationStatus.PENDING_FEE.value
        db.add_all([flow, application])
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        provider = get_client.return_value
        provider.create_payment.return_value = SimpleNamespace(
            id=f"redirect-provider-{uuid.uuid4().hex}",
            status="pending",
            checkout_url="https://pay.test/redirect-test",
            is_installment_plan=False,
        )
        if payment_kind == "application_fee":
            payment = payments_crud.create_fee_payment(db, application, popup)
        else:
            payment, _ = payments_crud.create_payment(
                db, _request(application, product, category)
            )

    assert payment.sales_flow_id == application.sales_flow_id
    path = "application" if payment_kind == "application_fee" else "passes/buy"
    expected_cancel = (
        f"{get_portal_url(tenant_a)}/portal/{popup.slug}/{path}?flow={flow.id}"
    )
    provider.create_payment.assert_called_once()
    sent = provider.create_payment.call_args.kwargs
    assert sent["cancel_path"] == expected_cancel
    expected_success = (
        f"{get_portal_url(tenant_a)}/portal/{popup.slug}?flow={flow.id}&checkout=success"
        if payment_kind == "application_fee"
        else f"{expected_cancel}&checkout=success"
    )
    assert sent["success_path"] == expected_success


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


def test_transferred_legacy_self_is_rejected_before_provider_creation(
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
        application_id=application.id,
        name="Owned elsewhere",
        category_id=None,
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


def test_same_key_category_owned_by_another_flow_is_rejected_before_provider(
    db: Session, tenant_a: Tenants
) -> None:
    popup, _, _, current_category, application, _ = _payment_context(db, tenant_a)
    other_flow = SalesFlows(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        slug=f"other-{uuid.uuid4().hex[:6]}",
        name="Other flow",
        type=SaleType.application.value,
    )
    db.add(other_flow)
    db.flush()
    from app.api.attendee_category.crud import attendee_categories_crud

    attendee_categories_crud.seed_main_for_flow(db, other_flow)
    companion = AttendeeCategories(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=other_flow.id,
        key=current_category.key,
    )
    product = Products(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        name="Guest pass",
        slug=f"guest-pass-{uuid.uuid4().hex[:8]}",
        price=Decimal("25"),
        category="ticket",
        attendee_category_id=companion.id,
        is_active=True,
    )
    db.add_all([companion, product])
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        with pytest.raises(HTTPException) as error:
            payments_crud.create_payment(db, _request(application, product, companion))

    assert error.value.status_code == 422
    assert error.value.detail == "Recipient is not valid for this payment"
    get_client.assert_not_called()


def test_self_uses_current_primary_role_and_keeps_stale_attendee_category(
    db: Session, tenant_a: Tenants
) -> None:
    popup, flow, buyer, stale_category, application, product = _payment_context(
        db, tenant_a
    )
    from app.api.attendee_category.crud import attendee_categories_crud

    current_primary = attendee_categories_crud.get_primary_for_flow(db, flow.id)
    assert current_primary is not None
    attendee = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        application_id=application.id,
        human_id=buyer.id,
        name="Buyer attendee",
        category_id=stale_category.id,
    )
    db.add(attendee)
    db.commit()
    _set_ticket_recipient_categories(db, flow, product, [current_primary])

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        get_client.return_value.create_payment.return_value = _provider_response("self")
        payment, _ = payments_crud.create_payment(
            db,
            _request(
                application,
                product,
                current_primary,
                human_id=buyer.id,
                recipient_name="Buyer",
            ),
        )

    payments_crud.approve_payment(db, payment.id)
    db.refresh(attendee)
    recipient = db.exec(
        select(PaymentRecipients).where(PaymentRecipients.payment_id == payment.id)
    ).one()
    assert recipient.category_id == current_primary.id
    assert recipient.attendee_id == attendee.id
    assert attendee.category_id == stale_category.id


def test_legacy_primary_attendee_with_buyer_manager_uses_current_primary_role(
    db: Session, tenant_a: Tenants
) -> None:
    popup, flow, buyer, _, application, product = _payment_context(db, tenant_a)
    from app.api.attendee_category.crud import attendee_categories_crud

    current_primary = attendee_categories_crud.get_primary_for_flow(db, flow.id)
    assert current_primary is not None
    historical_flow = SalesFlows(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        slug=f"historical-{uuid.uuid4().hex[:6]}",
        name="Historical",
        type=SaleType.application.value,
    )
    db.add(historical_flow)
    db.flush()
    historical_primary = attendee_categories_crud.seed_main_for_flow(
        db, historical_flow
    )
    db.flush()
    legacy_self = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        application_id=application.id,
        managed_by_human_id=buyer.id,
        name="Legacy buyer",
        category_id=historical_primary.id,
    )
    db.add(legacy_self)
    db.commit()
    request = _request(
        application,
        product,
        current_primary,
        existing_attendee_id=legacy_self.id,
    )
    request.recipients[0].category_id = None
    _set_ticket_recipient_categories(db, flow, product, [current_primary])

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        get_client.return_value.create_payment.return_value = _provider_response(
            "legacy-self"
        )
        payment, _ = payments_crud.create_payment(db, request)

    recipient = db.exec(
        select(PaymentRecipients).where(PaymentRecipients.payment_id == payment.id)
    ).one()
    assert recipient.existing_attendee_id == legacy_self.id
    assert recipient.category_id == current_primary.id


def test_manager_owned_companion_uses_current_role_without_legacy_category_change(
    db: Session, tenant_a: Tenants
) -> None:
    popup, flow, buyer, category, application, product = _payment_context(db, tenant_a)
    companion = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        managed_by_human_id=buyer.id,
        name="Managed companion",
        category_id=None,
    )
    db.add(companion)
    db.commit()
    _set_ticket_recipient_categories(db, flow, product, [category])

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        get_client.return_value.create_payment.return_value = _provider_response(
            "managed"
        )
        payment, _ = payments_crud.create_payment(
            db,
            _request(
                application,
                product,
                category,
                existing_attendee_id=companion.id,
            ),
        )

    payments_crud.approve_payment(db, payment.id)
    db.refresh(companion)
    recipient = db.exec(
        select(PaymentRecipients).where(PaymentRecipients.payment_id == payment.id)
    ).one()
    assert recipient.attendee_id == companion.id
    assert recipient.category_id == category.id
    assert companion.category_id is None


def test_section_role_is_authoritative_over_product_and_attendee_categories(
    db: Session, tenant_a: Tenants
) -> None:
    popup, flow, buyer, allowed_role, application, product = _payment_context(
        db, tenant_a
    )
    stale_role = AttendeeCategories(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        key="stale-role",
    )
    db.add(stale_role)
    db.flush()
    product.attendee_category_id = stale_role.id
    companion = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        managed_by_human_id=buyer.id,
        name="Stale role companion",
        category_id=stale_role.id,
    )
    db.add_all([product, companion])
    db.commit()
    _set_ticket_recipient_categories(db, flow, product, [allowed_role])

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        get_client.return_value.create_payment.return_value = _provider_response(
            "section-role"
        )
        payment, _ = payments_crud.create_payment(
            db,
            _request(
                application,
                product,
                allowed_role,
                existing_attendee_id=companion.id,
            ),
        )

    recipient = db.exec(
        select(PaymentRecipients).where(PaymentRecipients.payment_id == payment.id)
    ).one()
    assert recipient.category_id == allowed_role.id


def test_section_empty_role_list_permits_no_role(
    db: Session, tenant_a: Tenants
) -> None:
    _, flow, _, category, application, product = _payment_context(db, tenant_a)
    _set_ticket_recipient_categories(db, flow, product, [])

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        with pytest.raises(HTTPException) as error:
            payments_crud.create_payment(db, _request(application, product, category))

    assert error.value.status_code == 422
    get_client.assert_not_called()


def test_section_role_union_and_unrestricted_match_semantics(
    db: Session, tenant_a: Tenants
) -> None:
    popup, flow, _, first_role, application, product = _payment_context(db, tenant_a)
    second_role = AttendeeCategories(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        key="second-role",
    )
    db.add(second_role)
    db.flush()
    step = db.exec(
        select(TicketingSteps).where(
            TicketingSteps.sales_flow_id == flow.id,
            TicketingSteps.template == "ticket-select",
        )
    ).one()
    step.template_config = {
        "sections": [
            {
                "product_ids": [str(product.id)],
                "attendee_categories": [str(first_role.id)],
            },
            {
                "product_ids": [str(product.id)],
                "attendee_categories": [str(second_role.id)],
            },
        ]
    }
    db.add(step)
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        get_client.return_value.create_payment.return_value = _provider_response(
            "union"
        )
        payment, _ = payments_crud.create_payment(
            db, _request(application, product, second_role)
        )
    assert payment.id is not None

    step.template_config = {
        "sections": [
            {
                "product_ids": [str(product.id)],
                "attendee_categories": [],
            },
            {"product_ids": [str(product.id)], "attendee_categories": None},
        ]
    }
    db.add(step)
    db.commit()
    with (
        patch("app.core.config.settings.SUPERSEDE_PENDING_ENABLED", False),
        patch("app.services.simplefi.get_simplefi_client") as get_client,
    ):
        get_client.return_value.create_payment.return_value = _provider_response(
            "unrestricted"
        )
        unrestricted, _ = payments_crud.create_payment(
            db, _request(application, product, first_role)
        )
    assert unrestricted.id != payment.id


def test_non_ticket_section_cannot_make_constrained_ticket_unrestricted(
    db: Session, tenant_a: Tenants
) -> None:
    popup, flow, _, allowed_role, application, product = _payment_context(db, tenant_a)
    other_role = AttendeeCategories(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        key="other-role",
    )
    db.add(other_role)
    db.flush()
    _set_ticket_recipient_categories(db, flow, product, [allowed_role])
    db.add(
        TicketingSteps(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            sales_flow_id=flow.id,
            step_type="ticket-card-audit",
            title="Ticket card audit",
            template="ticket-card",
            product_category="ticket",
            template_config={
                "sections": [
                    {
                        "product_ids": [str(product.id)],
                        "attendee_categories": None,
                    }
                ]
            },
        )
    )
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        with pytest.raises(HTTPException) as error:
            payments_crud.create_payment(db, _request(application, product, other_role))

    assert error.value.status_code == 422
    get_client.assert_not_called()


def test_non_ticket_section_cannot_define_ticket_role_eligibility(
    db: Session, tenant_a: Tenants
) -> None:
    popup, flow, _, role, application, product = _payment_context(db, tenant_a)
    ticket_select_product = Products(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        name="Ticket-select pass",
        slug=f"ticket-select-pass-{uuid.uuid4().hex[:8]}",
        price=Decimal("25"),
        category="ticket",
        is_active=True,
    )
    db.add(ticket_select_product)
    db.flush()
    _set_ticket_recipient_categories(db, flow, ticket_select_product, [role])
    db.add(
        TicketingSteps(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            sales_flow_id=flow.id,
            step_type="ticket-card-audit",
            title="Ticket card audit",
            template="ticket-card",
            product_category="ticket",
            template_config={
                "sections": [
                    {
                        "product_ids": [str(product.id)],
                        "attendee_categories": [str(role.id)],
                    }
                ]
            },
        )
    )
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        with pytest.raises(HTTPException) as error:
            payments_crud.create_payment(db, _request(application, product, role))

    assert error.value.status_code == 422
    get_client.assert_not_called()


def test_meal_plan_recipient_bypasses_ticket_role_segmentation(
    db: Session, tenant_a: Tenants
) -> None:
    popup, flow, _, role, application, product = _payment_context(db, tenant_a)
    product.category = "meal_plan"
    db.add_all(
        [
            product,
            TicketingSteps(
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                sales_flow_id=flow.id,
                step_type="meal-plan-audit",
                title="Meal plan audit",
                template="meal-plan-select",
                product_category="meal_plan",
                template_config={
                    "sections": [
                        {
                            "product_ids": [str(product.id)],
                            "products": [{"product_id": str(product.id)}],
                        }
                    ]
                },
            ),
        ]
    )
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        get_client.return_value.create_payment.return_value = _provider_response(
            "meal-plan-recipient"
        )
        payment, _ = payments_crud.create_payment(
            db, _request(application, product, role)
        )

    recipient = db.exec(
        select(PaymentRecipients).where(PaymentRecipients.payment_id == payment.id)
    ).one()
    assert recipient.category_id == role.id


def test_required_fields_use_canonical_name_email_over_snapshot(
    db: Session, tenant_a: Tenants
) -> None:
    _, _, _, category, application, product = _payment_context(db, tenant_a)
    category.required_fields = [
        {"name": "name", "type": "text", "required": True},
        {"name": "email", "type": "email", "required": True},
        {"name": "residence", "type": "text", "required": True},
    ]
    db.add(category)
    db.commit()
    request = _request(application, product, category)
    request.recipients[0].profile_snapshot.update(
        {"name": "", "email": "", "residence": "Lisbon"}
    )

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        get_client.return_value.create_payment.return_value = _provider_response(
            "required"
        )
        payment, _ = payments_crud.create_payment(db, request)

    assert payment.id is not None


def test_missing_required_recipient_field_is_rejected_before_provider(
    db: Session, tenant_a: Tenants
) -> None:
    _, _, _, category, application, product = _payment_context(db, tenant_a)
    category.required_fields = [{"name": "residence", "type": "text", "required": True}]
    db.add(category)
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        with pytest.raises(HTTPException) as error:
            payments_crud.create_payment(db, _request(application, product, category))

    assert error.value.status_code == 422
    assert error.value.detail == [
        {
            "code": "required_field_missing",
            "field": "residence",
            "message": "Missing required field 'residence'",
        }
    ]
    get_client.assert_not_called()


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


def test_arbitrary_foreign_human_is_rejected_before_provider_creation(
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
        sales_flow_id=application.sales_flow_id,
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


def test_recent_approved_payment_with_different_managed_recipient_is_not_reused(
    db: Session, tenant_a: Tenants
) -> None:
    popup, _, buyer, category, application, product = _payment_context(db, tenant_a)
    first_companion = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        managed_by_human_id=buyer.id,
        name="First companion",
    )
    second_companion = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        managed_by_human_id=buyer.id,
        name="Second companion",
    )
    db.add_all([first_companion, second_companion])
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
                existing_attendee_id=first_companion.id,
                recipient_name="First companion",
            ),
        )
        second, _ = payments_crud.create_payment(
            db,
            _request(
                application,
                product,
                category,
                existing_attendee_id=second_companion.id,
                recipient_name="Second companion",
            ),
        )

    assert first.id != second.id
    assert first.status == second.status == PaymentStatus.APPROVED.value
    assert get_client.return_value.create_payment.call_count == 2
    snapshots = list(
        db.exec(
            select(PaymentRecipients).where(
                PaymentRecipients.payment_id.in_([first.id, second.id])
            )
        ).all()
    )
    assert {snapshot.existing_attendee_id for snapshot in snapshots} == {
        first_companion.id,
        second_companion.id,
    }


def test_zero_total_cumulative_limit_dedupes_existing_companion_and_blocks_new_one(
    db: Session, tenant_a: Tenants
) -> None:
    popup, _, buyer, category, application, product = _payment_context(db, tenant_a)
    category.max_per_application = 1
    product.price = Decimal("0")
    db.add_all([category, product])
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        first, _ = payments_crud.create_payment(
            db, _request(application, product, category)
        )
    get_client.assert_not_called()
    assert first.status == PaymentStatus.APPROVED.value
    first_recipient = db.exec(
        select(PaymentRecipients).where(PaymentRecipients.payment_id == first.id)
    ).one()
    companion = db.get(Attendees, first_recipient.attendee_id)
    assert companion is not None
    assert companion.managed_by_human_id == buyer.id
    assert companion.category_id is None

    same_person = _request(
        application,
        product,
        category,
        existing_attendee_id=companion.id,
    )
    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        second, _ = payments_crud.create_payment(db, same_person)
    get_client.assert_not_called()
    assert second.id != first.id
    assert second.status == PaymentStatus.APPROVED.value

    different_person = _request(application, product, category)
    different_person.recipients[0].recipient_key = "second-companion"
    different_person.products[0].recipient_key = "second-companion"
    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        with pytest.raises(HTTPException) as error:
            payments_crud.create_payment(db, different_person)

    assert error.value.status_code == 422
    get_client.assert_not_called()


def test_cumulative_limit_ignores_approved_recipients_from_another_flow(
    db: Session, tenant_a: Tenants
) -> None:
    popup, _, buyer, category, application, product = _payment_context(db, tenant_a)
    category.max_per_application = 1
    product.price = Decimal("0")
    other_flow = SalesFlows(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        slug=f"other-limit-{uuid.uuid4().hex[:6]}",
        name="Other limit flow",
        type=SaleType.application.value,
    )
    db.add(other_flow)
    db.flush()
    historical_payment = Payments(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        application_id=application.id,
        buyer_human_id=buyer.id,
        sales_flow_id=other_flow.id,
        status=PaymentStatus.APPROVED.value,
        amount=Decimal("0"),
        currency="USD",
    )
    db.add_all([category, product, historical_payment])
    db.flush()
    historical_recipient = PaymentRecipients(
        tenant_id=tenant_a.id,
        payment_id=historical_payment.id,
        recipient_key="other-flow-companion",
        name="Other flow companion",
        category_id=category.id,
    )
    db.add(historical_recipient)
    db.flush()
    db.add(
        PaymentProducts(
            tenant_id=tenant_a.id,
            payment_id=historical_payment.id,
            payment_recipient_id=historical_recipient.id,
            product_id=product.id,
            quantity=1,
            product_name=product.name,
            product_price=product.price,
            product_category=product.category or "ticket",
        )
    )
    db.commit()

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        payment, _ = payments_crud.create_payment(
            db, _request(application, product, category)
        )

    get_client.assert_not_called()
    assert payment.status == PaymentStatus.APPROVED.value


@pytest.mark.parametrize("approval_method", ["approve_payment", "update_status"])
def test_pending_payment_rechecks_cumulative_limit_at_approval(
    db: Session, tenant_a: Tenants, approval_method: str
) -> None:
    popup, flow, buyer, category, application, product = _payment_context(db, tenant_a)
    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        get_client.return_value.create_payment.return_value = _provider_response(
            "pending-limit"
        )
        pending, _ = payments_crud.create_payment(
            db, _request(application, product, category)
        )

    category.max_per_application = 1
    approved = Payments(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        application_id=application.id,
        buyer_human_id=buyer.id,
        sales_flow_id=flow.id,
        status=PaymentStatus.APPROVED.value,
        amount=product.price,
        currency="USD",
    )
    db.add_all([category, approved])
    db.flush()
    approved_recipient = PaymentRecipients(
        tenant_id=tenant_a.id,
        payment_id=approved.id,
        recipient_key="approved-companion",
        name="Approved companion",
        category_id=category.id,
    )
    db.add(approved_recipient)
    db.flush()
    db.add(
        PaymentProducts(
            tenant_id=tenant_a.id,
            payment_id=approved.id,
            payment_recipient_id=approved_recipient.id,
            product_id=product.id,
            quantity=1,
            product_name=product.name,
            product_price=product.price,
            product_category=product.category or "ticket",
        )
    )
    db.commit()

    with pytest.raises(HTTPException) as error:
        if approval_method == "approve_payment":
            payments_crud.approve_payment(db, pending.id)
        else:
            payments_crud.update_status(db, pending.id, PaymentStatus.APPROVED)

    assert error.value.status_code == 422
    db.refresh(pending)
    assert pending.status == PaymentStatus.PENDING.value
    assert (
        db.exec(
            select(Attendees).where(
                Attendees.popup_id == popup.id,
                Attendees.managed_by_human_id == buyer.id,
            )
        ).all()
        == []
    )


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


def test_open_checkout_buyer_receives_the_current_flow_primary_role(
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
    assert recipient.human_id == payment.buyer_human_id
    assert recipient.profile_snapshot == {"accessibility": "aisle"}
    assert recipient.category_id is not None
    assert line.payment_recipient_id == recipient.id
    assert line.attendee_id is None
    assert db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).all() == []

    payments_crud.approve_payment(db, payment.id)

    attendee = db.exec(select(Attendees).where(Attendees.popup_id == popup.id)).one()
    assert attendee.name == "Guest Recipient"
    assert attendee.human_id == payment.buyer_human_id
    assert attendee.category_id is None
