import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, PaymentRecipients, Payments
from app.api.payment.schemas import PaymentRecipientRequest, PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps
from tests._flow_helpers import application_flow_id


class RecipientContext:
    def __init__(self, db: Session, tenant: Tenants, popup: Popups) -> None:
        self.db = db
        self.tenant = tenant
        self.popup = popup
        self.flow_id = application_flow_id(db, popup.id)

    def add(self, model):
        self.db.add(model)
        self.db.flush()
        return model

    def human(self, label: str) -> Humans:
        return self.add(
            Humans(
                tenant_id=self.tenant.id,
                email=f"unit-{label}-{uuid.uuid4().hex[:6]}@test.com",
            )
        )

    def product(self, category: str = "ticket") -> Products:
        return self.add(
            Products(
                tenant_id=self.tenant.id,
                popup_id=self.popup.id,
                name=f"Recipient {category}",
                slug=f"recipient-{category}-{uuid.uuid4().hex[:8]}",
                price=Decimal("10"),
                category=category,
                requires_check_in=category != "merch",
                is_active=True,
            )
        )

    def application(self, owner: Humans) -> Applications:
        return self.add(
            Applications(
                tenant_id=self.tenant.id,
                popup_id=self.popup.id,
                human_id=owner.id,
                sales_flow_id=self.flow_id,
            )
        )

    def attendee(
        self,
        *,
        human: Humans | None = None,
        application: Applications | None = None,
        manager: Humans | None = None,
    ) -> Attendees:
        return self.add(
            Attendees(
                tenant_id=self.tenant.id,
                popup_id=self.popup.id,
                human_id=human.id if human else None,
                application_id=application.id if application else None,
                managed_by_human_id=manager.id if manager else None,
                name="Unit recipient",
            )
        )

    def payment(
        self, buyer: Humans, application: Applications | None = None
    ) -> Payments:
        return self.add(
            Payments(
                tenant_id=self.tenant.id,
                popup_id=self.popup.id,
                buyer_human_id=buyer.id,
                application_id=application.id if application else None,
                sales_flow_id=application.sales_flow_id
                if application
                else self.flow_id,
                status=PaymentStatus.PENDING.value,
                amount=Decimal("10"),
            )
        )

    def resolve(
        self,
        payment: Payments,
        product: Products,
        *,
        attendee: Attendees | None = None,
        recipient: PaymentRecipientRequest | None = None,
    ) -> Attendees | None:
        line = self.add(
            PaymentProducts(
                tenant_id=self.tenant.id,
                payment_id=payment.id,
                product_id=product.id,
                attendee_id=attendee.id if attendee else None,
                quantity=1,
                product_name=product.name,
                product_price=product.price,
                product_category=product.category or "",
                requires_check_in_snapshot=product.requires_check_in,
            )
        )
        return payments_crud._resolve_unit_recipient(
            self.db, payment, line, product, recipient
        )


@pytest.fixture
def context(db: Session, tenant_a: Tenants, popup_tenant_a: Popups) -> RecipientContext:
    return RecipientContext(db, tenant_a, popup_tenant_a)


def test_authorized_recipient_flows(context: RecipientContext) -> None:
    buyer = context.human("buyer")
    ticket = context.product()
    self_attendee = context.attendee(human=buyer)
    assert (
        context.resolve(context.payment(buyer), ticket, attendee=self_attendee)
        == self_attendee
    )
    application = context.application(buyer)
    app_companion = context.attendee(application=application)
    assert (
        context.resolve(
            context.payment(buyer, application), ticket, attendee=app_companion
        )
        == app_companion
    )
    draft = PaymentRecipientRequest(recipient_key="guest", name="Guest")
    assert context.resolve(context.payment(buyer), ticket, recipient=draft) is None
    assert draft.name == "Guest"
    managed_companion = context.attendee(manager=buyer)
    assert (
        context.resolve(context.payment(buyer), ticket, attendee=managed_companion)
        == managed_companion
    )


def test_historical_payment_recipient_does_not_authorize_companion_reuse(
    context: RecipientContext,
) -> None:
    buyer = context.human("historical")
    attendee = context.attendee()
    prior = context.payment(buyer)
    context.add(
        PaymentRecipients(
            tenant_id=context.tenant.id,
            payment_id=prior.id,
            recipient_key="prior",
            attendee_id=attendee.id,
            name="Prior guest",
        )
    )
    with pytest.raises(HTTPException) as error:
        context.resolve(context.payment(buyer), context.product(), attendee=attendee)

    assert error.value.status_code == 422
    assert error.value.detail == "Recipient is not valid for this payment"


@pytest.mark.parametrize("authority", ["spoof", "cross", "impersonate"])
def test_unauthorized_existing_recipient_is_rejected(
    context: RecipientContext, authority: str
) -> None:
    buyer = context.human(f"buyer-{authority}")
    application = context.application(buyer)
    payment = context.payment(buyer, application)
    if authority == "spoof":
        recipient = context.attendee(human=context.human("foreign"))
    elif authority == "cross":
        recipient = context.attendee(
            application=context.application(context.human("other-owner"))
        )
    else:
        owner = context.human("impersonated-owner")
        application = context.application(owner)
        payment = context.payment(buyer, application)
        recipient = context.attendee(application=application)
    with pytest.raises(HTTPException) as error:
        context.resolve(payment, context.product(), attendee=recipient)
    assert error.value.status_code == 422
    assert error.value.detail == "Recipient is not valid for this payment"


def test_product_recipient_eligibility(context: RecipientContext) -> None:
    buyer = context.human("eligibility")
    payment = context.payment(buyer)
    self_attendee = context.attendee(human=buyer)
    assert context.resolve(payment, context.product("parking")) is None
    with pytest.raises(HTTPException):
        context.resolve(payment, context.product("merch"), attendee=self_attendee)

    meal = context.product("meal_plan")
    context.add(
        TicketingSteps(
            tenant_id=context.tenant.id,
            popup_id=context.popup.id,
            sales_flow_id=context.flow_id,
            step_type="meal_plan",
            title="Meals",
            template="meal-plan-select",
            template_config={
                "sections": [
                    {
                        "products": [{"product_id": str(meal.id)}],
                    }
                ]
            },
        )
    )
    assert context.resolve(payment, meal, attendee=self_attendee) == self_attendee
    other_flow = payment.model_copy(update={"sales_flow_id": uuid.uuid4()})
    with pytest.raises(HTTPException):
        context.resolve(other_flow, meal, attendee=self_attendee)
