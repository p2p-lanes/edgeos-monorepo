"""Each door offers its own payment terms.

Design: sdd/sales-flows-rediseno, `docs/sales-flows-que-mover.md` slice 3.
How many payments an order may be split into is a condition of the sale, and
the sale belongs to a flow. The terms lived only on `popups`, so a partner
selling through their own door had to offer whatever the event offered.

`a7e4b2c81f95` copied the popup's terms onto every flow, so nobody was offered
a different plan the day it ran. These cases make the two disagree and assert
what SimpleFi is actually asked for — the plan a buyer is offered is the wire
call, not a flag.
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.schemas import PaymentCreate, PaymentProductRequest
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import InstallmentInterval, SaleType
from app.api.tenant.models import Tenants
from app.api.ticketing_step.constants import seed_ticketing_steps_for_popup
from tests._flow_helpers import application_flow_id


def _popup(db: Session, tenant: Tenants, **terms) -> Popups:
    popup = Popups(
        name=f"Installment Terms {uuid.uuid4().hex[:8]}",
        slug=f"installment-terms-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        sale_type=SaleType.application,
        currency="USD",
        simplefi_api_key="sf_test_key",
        **terms,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    application_flow_id(db, popup.id)  # provision the default flow
    return popup


def _default_flow(db: Session, popup: Popups) -> SalesFlows:
    flow = sales_flows_crud.get_default_flow(db, popup.id)
    assert flow is not None
    return flow


def _set_terms(db: Session, flow: SalesFlows, **terms) -> SalesFlows:
    for name, value in terms.items():
        setattr(flow, name, value)
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _ticket(db: Session, popup: Popups, *, price: str) -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"Ticket {uuid.uuid4().hex[:6]}",
        slug=f"ticket-{uuid.uuid4().hex[:8]}",
        price=Decimal(price),
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"terms-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Ana",
        last_name="Diaz",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _application_with_attendee(
    db: Session, popup: Popups, human: Humans, flow: SalesFlows
) -> tuple[Applications, Attendees]:
    application = Applications(
        sales_flow_id=flow.id,
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    attendee = Attendees(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        application_id=application.id,
        human_id=human.id,
        name="Ana Diaz",
        email=human.email,
        category="main",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return application, attendee


def _buy(
    db: Session, application: Applications, product: Products, attendee: Attendees
):
    obj = PaymentCreate(
        application_id=application.id,
        products=[
            PaymentProductRequest(
                product_id=product.id, attendee_id=attendee.id, quantity=1
            )
        ],
    )
    response = SimpleNamespace(
        id=f"plan_{uuid.uuid4().hex[:8]}",
        status="pending",
        checkout_url="https://sf.test/plan",
        is_installment_plan=True,
    )
    with patch("app.services.simplefi.get_simplefi_client") as mock_client:
        create = mock_client.return_value.create_payment
        create.return_value = response
        payments_crud.create_payment(db, obj)
    _, kwargs = create.call_args
    return kwargs


def _deadline(months: int) -> datetime:
    return datetime.now(UTC) + timedelta(days=31 * months)


class TestInstallmentTerms:
    def test_the_flow_offers_a_plan_the_event_does_not(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, installments_enabled=False)
        flow = _set_terms(
            db,
            _default_flow(db, popup),
            installments_enabled=True,
            installments_max=6,
            installments_deadline=_deadline(6),
            installments_interval=InstallmentInterval.month.value,
            installments_interval_count=1,
        )
        product = _ticket(db, popup, price="600")
        human = _human(db, tenant_a)
        application, attendee = _application_with_attendee(db, popup, human, flow)

        kwargs = _buy(db, application, product, attendee)

        assert kwargs["max_installments"] == 6
        assert kwargs["installment_interval"] == "month"

    def test_the_flow_withholds_a_plan_the_event_offers(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(
            db,
            tenant_a,
            installments_enabled=True,
            installments_max=6,
            installments_deadline=_deadline(6),
        )
        flow = _set_terms(
            db,
            _default_flow(db, popup),
            installments_enabled=False,
            installments_max=None,
            installments_deadline=None,
        )
        product = _ticket(db, popup, price="600")
        human = _human(db, tenant_a)
        application, attendee = _application_with_attendee(db, popup, human, flow)

        kwargs = _buy(db, application, product, attendee)

        assert kwargs["max_installments"] is None

    def test_two_doors_offer_different_ceilings(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Same gathering, same $600 ticket, two plans."""
        popup = _popup(db, tenant_a, installments_enabled=False)
        general = _set_terms(
            db,
            _default_flow(db, popup),
            installments_enabled=True,
            installments_max=6,
            installments_deadline=_deadline(6),
            installments_interval=InstallmentInterval.month.value,
            installments_interval_count=1,
        )
        partner = SalesFlows(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            slug=f"partner-{uuid.uuid4().hex[:8]}",
            name="Partner",
            type=SaleType.application.value,
            installments_enabled=True,
            installments_max=3,
            installments_deadline=_deadline(6),
            installments_interval=InstallmentInterval.month.value,
            installments_interval_count=1,
        )
        db.add(partner)
        db.flush()
        # A flow sells what its steps offer (R6), so a bare one refuses every
        # product before any plan is computed.
        seed_ticketing_steps_for_popup(
            db,
            popup_id=popup.id,
            tenant_id=popup.tenant_id,
            sales_flow_id=partner.id,
            flow_type=partner.type,
        )
        db.commit()
        db.refresh(partner)
        product = _ticket(db, popup, price="600")

        buyer_a = _human(db, tenant_a)
        app_a, att_a = _application_with_attendee(db, popup, buyer_a, general)
        buyer_b = _human(db, tenant_a)
        app_b, att_b = _application_with_attendee(db, popup, buyer_b, partner)

        assert _buy(db, app_a, product, att_a)["max_installments"] == 6
        assert _buy(db, app_b, product, att_b)["max_installments"] == 3

    def test_a_flow_that_never_named_an_interval_still_bills_monthly(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The popup's column is NOT NULL with a `month` default and the flow's
        is nullable, so the gap has to close somewhere other than SimpleFi."""
        popup = _popup(db, tenant_a, installments_enabled=False)
        flow = _set_terms(
            db,
            _default_flow(db, popup),
            installments_enabled=True,
            installments_max=4,
            installments_deadline=_deadline(6),
            installments_interval=None,
            installments_interval_count=None,
        )
        product = _ticket(db, popup, price="400")
        human = _human(db, tenant_a)
        application, attendee = _application_with_attendee(db, popup, human, flow)

        kwargs = _buy(db, application, product, attendee)

        assert kwargs["installment_interval"] == "month"
        assert kwargs["installment_interval_count"] == 1
