"""Task 12.x — restriction_rule + D3 flow-exclusivity enforcement at both
purchase call sites (design's call-site table): `create_open_ticketing_payment`
(anonymous) and `create_payment` (authenticated).

Placement is load-bearing (subsumes + relocates slice 13's inline
flow_products check, per this slice's explicit mandate): enforcement must run
BEFORE any side effect — before `humans_crud.find_or_create` on the anonymous
path, before `SUPERSEDE_PENDING_ENABLED`/the `FOR UPDATE` application lock on
the authenticated path.

TDD: RED -> GREEN.
"""

import uuid
from decimal import Decimal

from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.checkout.schemas import BuyerInfo, OpenTicketingPurchaseCreate, ProductLine
from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.schemas import PaymentCreate, PaymentProductRequest
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from tests._flow_helpers import (
    application_flow_id,
    default_flow_id,
    seed_default_steps,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_direct_popup_with_default_flow(
    db: Session, tenant: Tenants, *, slug_prefix: str
) -> tuple[Popups, SalesFlows]:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Restriction Gate Popup {slug_prefix}",
        slug=f"{slug_prefix}-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.direct.value,
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.flush()
    seed_default_steps(db, popup)
    flow = sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant.id, sale_type=SaleType.direct.value
    )
    db.flush()
    return popup, flow


def _make_application_popup_with_default_flow(
    db: Session, tenant: Tenants, *, slug_prefix: str
) -> tuple[Popups, SalesFlows]:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Restriction Gate App Popup {slug_prefix}",
        slug=f"{slug_prefix}-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.flush()
    seed_default_steps(db, popup)
    flow = sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant.id, sale_type=SaleType.application.value
    )
    db.flush()
    return popup, flow


def _make_product(
    db: Session,
    popup: Popups,
    *,
    price: str = "0",
    stock: int | None = None,
    category: str = "ticket",
) -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"Product {uuid.uuid4().hex[:6]}",
        slug=f"prod-{uuid.uuid4().hex[:8]}",
        price=Decimal(price),
        category=category,
        is_active=True,
        total_stock_cap=stock,
        total_stock_remaining=stock,
    )
    db.add(product)
    db.flush()
    return product


def _make_vip_code_field(db: Session, popup: Popups) -> None:
    """A registered custom buyer field named 'vip_code', so
    `_validate_open_ticketing_form_data` accepts it in `form_data`."""
    section = FormSections(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=default_flow_id(db, popup.id),
        label="Buyer Info",
        order=0,
        kind="standard",
    )
    db.add(section)
    db.flush()
    field = FormFields(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=default_flow_id(db, popup.id),
        section_id=section.id,
        name="vip_code",
        label="VIP Code",
        field_type="text",
        required=False,
        position=0,
    )
    db.add(field)
    db.flush()


def _make_human(
    db: Session, tenant: Tenants, *, residence: str | None = None
) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"restrict-{uuid.uuid4().hex[:8]}@test.com",
        residence=residence,
    )
    db.add(human)
    db.flush()
    return human


def _make_application(
    db: Session, popup: Popups, human: Humans, flow: SalesFlows
) -> Applications:
    application = Applications(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        sales_flow_id=flow.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.flush()
    attendee = Attendees(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        application_id=application.id,
        name="Restriction Gate Attendee",
        email=human.email,
        category="main",
    )
    db.add(attendee)
    db.flush()
    return application


def _purchase_create(
    *, email: str, products: list[Products], form_data: dict | None = None
) -> OpenTicketingPurchaseCreate:
    return OpenTicketingPurchaseCreate(
        products=[ProductLine(product_id=p.id, quantity=1) for p in products],
        buyer=BuyerInfo(
            email=email, first_name="Test", last_name="Buyer", form_data=form_data or {}
        ),
    )


# ---------------------------------------------------------------------------
# Anonymous purchase path — create_open_ticketing_payment
# ---------------------------------------------------------------------------


class TestOpenTicketingRestrictionGate:
    def test_restriction_rule_blocks_before_find_or_create(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup, flow = _make_direct_popup_with_default_flow(
            db, tenant_a, slug_prefix="rg"
        )
        flow.restriction_rule = {
            "kind": "form_answer",
            "field_name": "vip_code",
            "op": "eq",
            "value": "secret",
        }
        db.add(flow)
        product = _make_product(db, popup)
        db.commit()

        buyer_email = f"blocked-{uuid.uuid4().hex[:8]}@test.com"
        obj = _purchase_create(email=buyer_email, products=[product])

        import pytest
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            payments_crud.create_open_ticketing_payment(
                db, obj=obj, popup=popup, tenant=tenant_a
            )
        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == {"code": "flow_restriction_violated"}

        # Ordering proof: rejected before humans_crud.find_or_create — no
        # Humans row was created for this buyer.
        created_human = db.exec(
            select(Humans).where(Humans.email == buyer_email)
        ).first()
        assert created_human is None

    def test_restriction_rule_passing_allows_purchase(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup, flow = _make_direct_popup_with_default_flow(
            db, tenant_a, slug_prefix="rg"
        )
        flow.restriction_rule = {
            "kind": "form_answer",
            "field_name": "vip_code",
            "op": "eq",
            "value": "secret",
        }
        db.add(flow)
        product = _make_product(db, popup)
        _make_vip_code_field(db, popup)
        db.commit()

        obj = _purchase_create(
            email=f"allowed-{uuid.uuid4().hex[:8]}@test.com",
            products=[product],
            form_data={"vip_code": "secret"},
        )

        payment, _checkout_url, _redirect = payments_crud.create_open_ticketing_payment(
            db, obj=obj, popup=popup, tenant=tenant_a
        )
        assert payment.id is not None
        assert payment.sales_flow_id == flow.id

    def test_product_no_step_offers_is_rejected_403(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup, default_flow = _make_direct_popup_with_default_flow(
            db, tenant_a, slug_prefix="rg"
        )
        # No seeded step has product_category="sponsorship", so a direct
        # POST for it must be refused even though it is a real, active
        # product of the same popup.
        product = _make_product(db, popup, category="sponsorship")
        db.commit()

        obj = _purchase_create(
            email=f"excl-{uuid.uuid4().hex[:8]}@test.com", products=[product]
        )

        import pytest
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            payments_crud.create_open_ticketing_payment(
                db, obj=obj, popup=popup, tenant=tenant_a
            )
        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == {"code": "product_not_in_flow"}

    def test_no_restriction_rule_does_not_affect_purchase(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup, flow = _make_direct_popup_with_default_flow(
            db, tenant_a, slug_prefix="rg"
        )
        product = _make_product(db, popup)
        db.commit()

        obj = _purchase_create(
            email=f"norule-{uuid.uuid4().hex[:8]}@test.com", products=[product]
        )
        payment, _checkout_url, _redirect = payments_crud.create_open_ticketing_payment(
            db, obj=obj, popup=popup, tenant=tenant_a
        )
        assert payment.sales_flow_id == flow.id


# ---------------------------------------------------------------------------
# Authenticated purchase path — create_payment
# ---------------------------------------------------------------------------


class TestAuthenticatedPaymentRestrictionGate:
    def test_restriction_rule_blocks_before_stock_decrement(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup, flow = _make_application_popup_with_default_flow(
            db, tenant_a, slug_prefix="rg-app"
        )
        flow.restriction_rule = {
            "kind": "human_profile_field",
            "field": "residence",
            "op": "eq",
            "value": "AR",
        }
        db.add(flow)
        human = _make_human(db, tenant_a, residence="US")
        application = _make_application(db, popup, human, flow)
        product = _make_product(db, popup, stock=5)
        db.commit()

        obj = PaymentCreate(
            application_id=application.id,
            products=[
                PaymentProductRequest(
                    product_id=product.id,
                    attendee_id=application.attendees[0].id,
                    quantity=1,
                )
            ],
        )

        import pytest
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            payments_crud.create_payment(db, obj)
        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == {"code": "flow_restriction_violated"}

        db.refresh(product)
        assert product.total_stock_remaining == 5, (
            "Stock must not be decremented — the restriction gate runs "
            "before any side effect."
        )

    def test_restriction_rule_passing_allows_payment(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup, flow = _make_application_popup_with_default_flow(
            db, tenant_a, slug_prefix="rg-app"
        )
        flow.restriction_rule = {
            "kind": "human_profile_field",
            "field": "residence",
            "op": "eq",
            "value": "AR",
        }
        db.add(flow)
        human = _make_human(db, tenant_a, residence="AR")
        application = _make_application(db, popup, human, flow)
        product = _make_product(db, popup)
        db.commit()

        obj = PaymentCreate(
            application_id=application.id,
            products=[
                PaymentProductRequest(
                    product_id=product.id,
                    attendee_id=application.attendees[0].id,
                    quantity=1,
                )
            ],
        )

        payment, _preview = payments_crud.create_payment(db, obj)
        assert payment.sales_flow_id == flow.id

    def test_product_no_step_offers_is_rejected_403(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup, default_flow = _make_application_popup_with_default_flow(
            db, tenant_a, slug_prefix="rg-app"
        )
        human = _make_human(db, tenant_a)
        application = _make_application(db, popup, human, default_flow)
        product = _make_product(db, popup, category="sponsorship")
        db.commit()

        obj = PaymentCreate(
            application_id=application.id,
            products=[
                PaymentProductRequest(
                    product_id=product.id,
                    attendee_id=application.attendees[0].id,
                    quantity=1,
                )
            ],
        )

        import pytest
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            payments_crud.create_payment(db, obj)
        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == {"code": "product_not_in_flow"}

    def test_payment_carries_the_application_flow(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """A payment inherits the flow of the application it settles.

        This used to be the popup-without-a-default-flow escape hatch, where
        enforcement was skipped and `sales_flow_id` stayed NULL. Since
        sdd/sales-flows-rediseno F4 an application cannot exist without a
        flow, so there is nothing left to skip.
        """
        popup = Popups(
            tenant_id=tenant_a.id,
            name="Directly Built Popup",
            slug=f"direct-{uuid.uuid4().hex[:8]}",
            sale_type=SaleType.application.value,
            status="active",
            currency="USD",
        )
        db.add(popup)
        db.flush()
        seed_default_steps(db, popup)
        human = _make_human(db, tenant_a)
        application = Applications(
            sales_flow_id=application_flow_id(db, popup.id),
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            human_id=human.id,
            status=ApplicationStatus.ACCEPTED.value,
        )
        db.add(application)
        db.flush()
        attendee = Attendees(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            human_id=human.id,
            application_id=application.id,
            name="Direct Attendee",
            email=human.email,
            category="main",
        )
        db.add(attendee)
        db.flush()
        product = _make_product(db, popup)
        db.commit()

        obj = PaymentCreate(
            application_id=application.id,
            products=[
                PaymentProductRequest(
                    product_id=product.id, attendee_id=attendee.id, quantity=1
                )
            ],
        )
        payment, _preview = payments_crud.create_payment(db, obj)
        assert payment.sales_flow_id == application.sales_flow_id
