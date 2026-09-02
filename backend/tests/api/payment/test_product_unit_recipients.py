import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.attendee.models import AttendeeProducts, Attendees
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

    def purchased_unit(
        self,
        attendee: Attendees,
        buyer: Humans,
        product: Products,
        *,
        popup_id: uuid.UUID | None = None,
        payment_tenant_id: uuid.UUID | None = None,
        line_tenant_id: uuid.UUID | None = None,
        unit_tenant_id: uuid.UUID | None = None,
        revoked: bool = False,
    ) -> AttendeeProducts:
        prior_payment = self.add(
            Payments(
                tenant_id=payment_tenant_id or self.tenant.id,
                popup_id=popup_id or self.popup.id,
                buyer_human_id=buyer.id,
                status=PaymentStatus.APPROVED.value,
                amount=product.price,
            )
        )
        prior_line = self.add(
            PaymentProducts(
                tenant_id=line_tenant_id or self.tenant.id,
                payment_id=prior_payment.id,
                product_id=product.id,
                quantity=1,
                product_name=product.name,
                product_price=product.price,
                product_category=product.category or "",
                requires_check_in_snapshot=product.requires_check_in,
            )
        )
        return self.add(
            AttendeeProducts(
                tenant_id=unit_tenant_id or self.tenant.id,
                attendee_id=attendee.id,
                product_id=product.id,
                check_in_code=uuid.uuid4().hex[:8].upper(),
                payment_id=prior_payment.id,
                payment_product_id=prior_line.id,
                unit_index=0,
                product_category_snapshot=product.category,
                revoked_at=datetime.now(UTC) if revoked else None,
            )
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
    prior_companion = context.attendee()
    prior = context.payment(buyer)
    context.add(
        PaymentRecipients(
            tenant_id=context.tenant.id,
            payment_id=prior.id,
            recipient_key="prior",
            attendee_id=prior_companion.id,
            name="Prior guest",
        )
    )
    assert (
        context.resolve(context.payment(buyer), ticket, attendee=prior_companion)
        == prior_companion
    )


@pytest.mark.parametrize("revoked", [False, True])
def test_prior_buyer_purchased_unit_authorizes_direct_companion_reuse(
    context: RecipientContext, revoked: bool
) -> None:
    buyer = context.human(f"prior-unit-{revoked}")
    attendee = context.attendee()
    prior_product = context.product()
    context.purchased_unit(attendee, buyer, prior_product, revoked=revoked)

    assert (
        context.resolve(context.payment(buyer), context.product(), attendee=attendee)
        == attendee
    )


@pytest.mark.parametrize(
    "invalid_lineage",
    [
        "other_buyer",
        "cross_popup",
        "unit_cross_tenant",
        "line_cross_tenant",
        "payment_cross_tenant",
        "paymentless",
        "loose_payment_id",
    ],
)
def test_invalid_product_unit_lineage_does_not_authorize_recipient(
    context: RecipientContext,
    tenant_b: Tenants,
    popup_tenant_a_summer_fest: Popups,
    invalid_lineage: str,
) -> None:
    buyer = context.human(f"invalid-{invalid_lineage}")
    attendee = context.attendee(manager=buyer)
    prior_product = context.product()
    if invalid_lineage in {"paymentless", "loose_payment_id"}:
        loose_payment = (
            context.payment(buyer) if invalid_lineage == "loose_payment_id" else None
        )
        context.add(
            AttendeeProducts(
                tenant_id=context.tenant.id,
                attendee_id=attendee.id,
                product_id=prior_product.id,
                check_in_code=uuid.uuid4().hex[:8].upper(),
                payment_id=loose_payment.id if loose_payment else None,
                product_category_snapshot="ticket",
            )
        )
    else:
        prior_buyer = (
            context.human("other-lineage-buyer")
            if invalid_lineage == "other_buyer"
            else buyer
        )
        context.purchased_unit(
            attendee,
            prior_buyer,
            prior_product,
            popup_id=(
                popup_tenant_a_summer_fest.id
                if invalid_lineage == "cross_popup"
                else None
            ),
            payment_tenant_id=(
                tenant_b.id if invalid_lineage == "payment_cross_tenant" else None
            ),
            line_tenant_id=(
                tenant_b.id if invalid_lineage == "line_cross_tenant" else None
            ),
            unit_tenant_id=(
                tenant_b.id if invalid_lineage == "unit_cross_tenant" else None
            ),
        )

    with pytest.raises(HTTPException) as error:
        context.resolve(context.payment(buyer), context.product(), attendee=attendee)

    assert error.value.status_code == 422
    assert error.value.detail == "Recipient is not valid for this payment"


@pytest.mark.parametrize("authority", ["spoof", "cross", "managed", "impersonate"])
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
    elif authority == "managed":
        recipient = context.attendee(manager=buyer)
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
