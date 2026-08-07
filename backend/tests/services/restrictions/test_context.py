"""Slice 14 backlog — DB-level coverage for `PurchaseContext.has_product`
(`_holds_product`/`_holds_category`). Slice 12 shipped these
with only pure unit coverage (schemas/evaluator) plus indirect exercise
through the HTTP purchase-gate tests; this fills the gap the orchestrator's
brief called out explicitly: product + category, positive + negative,
through the application-attributed leg (the direct/attendee-only leg is
already covered by the catalog-filter integration tests).
"""

import uuid
from decimal import Decimal

from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.human.schemas import HumanPublic
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from app.services.restrictions.context import build_context


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Has Purchased Popup {uuid.uuid4().hex[:8]}",
        slug=f"has-purchased-{uuid.uuid4().hex[:8]}",
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_flow(db: Session, tenant: Tenants, popup: Popups) -> SalesFlows:
    return sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant.id, sale_type="application"
    )


def _make_product(db: Session, popup: Popups, *, category: str = "ticket") -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"Product {uuid.uuid4().hex[:6]}",
        slug=f"prod-{uuid.uuid4().hex[:8]}",
        price=Decimal("10"),
        category=category,
        is_active=True,
    )
    db.add(product)
    db.flush()
    return product


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"has-purchased-{uuid.uuid4().hex[:8]}@test.com",
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
    return application


def _make_attendee(
    db: Session, popup: Popups, human: Humans, application: Applications | None
) -> Attendees:
    attendee = Attendees(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        application_id=application.id if application is not None else None,
        name="Has Purchased Attendee",
        email=human.email,
        category="main",
    )
    db.add(attendee)
    db.flush()
    return attendee


def _make_approved_payment(
    db: Session,
    popup: Popups,
    application: Applications,
    attendee: Attendees,
    product: Products,
    *,
    status: str = PaymentStatus.APPROVED.value,
) -> Payments:
    payment = Payments(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        application_id=application.id,
        status=status,
        amount=product.price,
    )
    db.add(payment)
    db.flush()
    db.add(
        PaymentProducts(
            tenant_id=popup.tenant_id,
            payment_id=payment.id,
            product_id=product.id,
            attendee_id=attendee.id,
            product_name=product.name,
            product_price=product.price,
            product_category=product.category,
        )
    )
    if status == PaymentStatus.APPROVED.value:
        # Approval materialises the holding rows in production — every
        # approval path in PaymentsCRUD calls _add_products_to_attendees —
        # and since slice 5 that is what the predicate reads.
        _grant_product(db, popup, attendee, product, payment_id=payment.id)
    db.flush()
    return payment


def _grant_product(
    db: Session,
    popup: Popups,
    attendee: Attendees,
    product: Products,
    *,
    payment_id=None,
) -> None:
    """Hold a product. `payment_id=None` is the admin grant: no payment
    ever existed."""
    from app.api.attendee.models import AttendeeProducts

    db.add(
        AttendeeProducts(
            tenant_id=popup.tenant_id,
            attendee_id=attendee.id,
            product_id=product.id,
            payment_id=payment_id,
            check_in_code=uuid.uuid4().hex[:10],
        )
    )
    db.flush()


class TestHoldsProduct:
    def test_true_for_an_approved_purchase(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        application = _make_application(db, popup, human, flow)
        attendee = _make_attendee(db, popup, human, application)
        product = _make_product(db, popup)
        _make_approved_payment(db, popup, application, attendee, product)

        context = build_context(
            db, popup, flow, human=HumanPublic.model_validate(human)
        )

        assert context.has_product("product", str(product.id)) is True

    def test_true_for_an_admin_granted_product(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """F1: a product handed over by an organizer counts. The checkout
        gate always said so; this predicate used to disagree, and the two
        surfaces contradicting each other is what emptied the catalog."""
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        attendee = _make_attendee(db, popup, human, None)
        product = _make_product(db, popup)
        _grant_product(db, popup, attendee, product)

        context = build_context(
            db, popup, flow, human=HumanPublic.model_validate(human)
        )

        assert context.has_product("product", str(product.id)) is True

    def test_negative_returns_false_when_nothing_is_held(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        product = _make_product(db, popup)

        context = build_context(
            db, popup, flow, human=HumanPublic.model_validate(human)
        )

        assert context.has_product("product", str(product.id)) is False

    def test_negative_when_payment_is_not_approved(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        application = _make_application(db, popup, human, flow)
        attendee = _make_attendee(db, popup, human, application)
        product = _make_product(db, popup)
        _make_approved_payment(
            db,
            popup,
            application,
            attendee,
            product,
            status=PaymentStatus.PENDING.value,
        )

        context = build_context(
            db, popup, flow, human=HumanPublic.model_validate(human)
        )

        assert context.has_product("product", str(product.id)) is False


class TestHoldsCategory:
    def test_true_for_an_approved_purchase_in_category(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        application = _make_application(db, popup, human, flow)
        attendee = _make_attendee(db, popup, human, application)
        product = _make_product(db, popup, category="merch")
        _make_approved_payment(db, popup, application, attendee, product)

        context = build_context(
            db, popup, flow, human=HumanPublic.model_validate(human)
        )

        assert context.has_product("category", "merch") is True

    def test_negative_returns_false_for_a_different_category(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        application = _make_application(db, popup, human, flow)
        attendee = _make_attendee(db, popup, human, application)
        product = _make_product(db, popup, category="merch")
        _make_approved_payment(db, popup, application, attendee, product)

        context = build_context(
            db, popup, flow, human=HumanPublic.model_validate(human)
        )

        assert context.has_product("category", "ticket") is False


class TestHoldsMemoization:
    def test_result_is_cached_across_repeated_calls(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Same (scope, value) pair must hit the memoization cache, not
        re-run the query — asserted indirectly via a stable, repeatable
        result across calls (design D8's memoized-on-context contract)."""
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        application = _make_application(db, popup, human, flow)
        attendee = _make_attendee(db, popup, human, application)
        product = _make_product(db, popup)
        _make_approved_payment(db, popup, application, attendee, product)

        context = build_context(
            db, popup, flow, human=HumanPublic.model_validate(human)
        )

        first = context.has_product("product", str(product.id))
        second = context.has_product("product", str(product.id))
        assert first is True
        assert second is True
        assert context._has_product_cache[("product", str(product.id))] is True
