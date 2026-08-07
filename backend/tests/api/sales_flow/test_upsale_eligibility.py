"""Task 13.1/13.2 — upsale eligibility (`has_approved_payment`,
`has_popup_products`, `is_upsale_eligible`) and the flow-aware catalog
resolution (`ApplicationsCRUD.resolve_upsale_catalog`).

Design: sdd/sales-flows D8, G0 #2/#3, amended by product-owner decision —
eligibility for an upsale-type flow is "any product assigned OR any
APPROVED payment anywhere in the popup", evaluated live, never a snapshot.
Admin-granted attendee products (no payment) qualify; an
accepted-but-unpaid application without granted products does NOT.

TDD: RED -> GREEN.
"""

import uuid
from decimal import Decimal

from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.eligibility import (
    has_approved_payment,
    has_popup_products,
    is_upsale_eligible,
)
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(db: Session, tenant: Tenants, *, suffix: str) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Upsale Eligibility Popup {suffix}",
        slug=f"upsale-elig-{suffix}-{uuid.uuid4().hex[:6]}",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"upsale-elig-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.flush()
    return human


def _make_application(
    db: Session, tenant: Tenants, popup: Popups, human: Humans, *, status: str
) -> Applications:
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=status,
    )
    db.add(application)
    db.flush()
    return application


def _make_application_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    application: Applications,
    *,
    payment_status: str,
) -> Payments:
    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        status=payment_status,
        amount=Decimal("100"),
        currency="USD",
    )
    db.add(payment)
    db.flush()
    return payment


def _make_direct_purchase(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    payment_status: str,
) -> Payments:
    """Direct-sale leg: attendee (no application) + a payment product snapshot."""
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name="GA Ticket",
        slug=f"ga-ticket-{uuid.uuid4().hex[:6]}",
        price=Decimal("50"),
    )
    db.add(product)
    db.flush()

    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=None,
        popup_id=popup.id,
        human_id=human.id,
        name="Direct Attendee",
        category="main",
    )
    db.add(attendee)
    db.flush()

    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=None,
        popup_id=popup.id,
        status=payment_status,
        amount=Decimal("50"),
        currency="USD",
    )
    db.add(payment)
    db.flush()

    payment_product = PaymentProducts(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        payment_id=payment.id,
        product_id=product.id,
        attendee_id=attendee.id,
        quantity=1,
        product_name=product.name,
        product_price=product.price,
        product_category="ticket",
        product_currency="USD",
    )
    db.add(payment_product)
    db.flush()
    return payment


def _grant_admin_products(
    db: Session, tenant: Tenants, popup: Popups, human: Humans
) -> None:
    """Admin-granted ticket: attendee_products row with NO payment at all."""
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name="Granted Ticket",
        slug=f"granted-{uuid.uuid4().hex[:6]}",
        price=Decimal("50"),
    )
    db.add(product)
    db.flush()

    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=None,
        popup_id=popup.id,
        human_id=human.id,
        name="Granted Attendee",
        category="main",
    )
    db.add(attendee)
    db.flush()

    db.add(
        AttendeeProducts(
            id=uuid.uuid4(),
            tenant_id=tenant.id,
            attendee_id=attendee.id,
            product_id=product.id,
            check_in_code=f"GRANT-{uuid.uuid4().hex[:8]}",
            payment_id=None,
        )
    )
    db.flush()


def _make_upsale_flow(
    db: Session, popup: Popups, *, slug: str, visibility: str = "portal_listed"
) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=slug,
        name=f"Upsale {slug}",
        type="upsale",
        visibility=visibility,
    )
    db.add(flow)
    db.flush()
    return flow


# ---------------------------------------------------------------------------
# has_approved_payment
# ---------------------------------------------------------------------------


class TestHasApprovedPayment:
    def test_no_payment_not_eligible(self, db: Session, tenant_a: Tenants) -> None:
        popup = _make_popup(db, tenant_a, suffix="none")
        human = _make_human(db, tenant_a, suffix="none")
        db.commit()

        assert has_approved_payment(db, human.id, popup.id) is False

    def test_accepted_unpaid_application_not_eligible(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """G0 scenario: an accepted application with NO payment must not
        qualify — eligibility is about payment, not application status."""
        popup = _make_popup(db, tenant_a, suffix="unpaid")
        human = _make_human(db, tenant_a, suffix="unpaid")
        _make_application(
            db, tenant_a, popup, human, status=ApplicationStatus.ACCEPTED.value
        )
        db.commit()

        assert has_approved_payment(db, human.id, popup.id) is False

    def test_application_leg_approved_payment_is_eligible(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="app-approved")
        human = _make_human(db, tenant_a, suffix="app-approved")
        application = _make_application(
            db, tenant_a, popup, human, status=ApplicationStatus.ACCEPTED.value
        )
        _make_application_payment(
            db,
            tenant_a,
            popup,
            application,
            payment_status=PaymentStatus.APPROVED.value,
        )
        db.commit()

        assert has_approved_payment(db, human.id, popup.id) is True

    def test_application_leg_pending_payment_not_eligible(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="app-pending")
        human = _make_human(db, tenant_a, suffix="app-pending")
        application = _make_application(
            db, tenant_a, popup, human, status=ApplicationStatus.ACCEPTED.value
        )
        _make_application_payment(
            db,
            tenant_a,
            popup,
            application,
            payment_status=PaymentStatus.PENDING.value,
        )
        db.commit()

        assert has_approved_payment(db, human.id, popup.id) is False

    def test_direct_leg_approved_payment_is_eligible(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="direct-approved")
        human = _make_human(db, tenant_a, suffix="direct-approved")
        _make_direct_purchase(
            db, tenant_a, popup, human, payment_status=PaymentStatus.APPROVED.value
        )
        db.commit()

        assert has_approved_payment(db, human.id, popup.id) is True

    def test_direct_leg_pending_payment_not_eligible(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="direct-pending")
        human = _make_human(db, tenant_a, suffix="direct-pending")
        _make_direct_purchase(
            db, tenant_a, popup, human, payment_status=PaymentStatus.PENDING.value
        )
        db.commit()

        assert has_approved_payment(db, human.id, popup.id) is False

    def test_payment_in_different_popup_not_eligible(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="pop-a")
        other_popup = _make_popup(db, tenant_a, suffix="pop-b")
        human = _make_human(db, tenant_a, suffix="cross-popup")
        _make_direct_purchase(
            db,
            tenant_a,
            other_popup,
            human,
            payment_status=PaymentStatus.APPROVED.value,
        )
        db.commit()

        assert has_approved_payment(db, human.id, popup.id) is False


# ---------------------------------------------------------------------------
# has_popup_products / is_upsale_eligible
# ---------------------------------------------------------------------------


class TestHasPopupProducts:
    def test_admin_granted_products_detected(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="granted")
        human = _make_human(db, tenant_a, suffix="granted")
        _grant_admin_products(db, tenant_a, popup, human)
        db.commit()

        assert has_popup_products(db, human.id, popup.id) is True

    def test_no_products_not_detected(self, db: Session, tenant_a: Tenants) -> None:
        popup = _make_popup(db, tenant_a, suffix="no-products")
        human = _make_human(db, tenant_a, suffix="no-products")
        db.commit()

        assert has_popup_products(db, human.id, popup.id) is False

    def test_products_in_different_popup_not_detected(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="prod-pop-a")
        other_popup = _make_popup(db, tenant_a, suffix="prod-pop-b")
        human = _make_human(db, tenant_a, suffix="prod-cross-popup")
        _grant_admin_products(db, tenant_a, other_popup, human)
        db.commit()

        assert has_popup_products(db, human.id, popup.id) is False


class TestIsUpsaleEligible:
    def test_admin_granted_products_zero_payments_is_eligible(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Product-owner amendment: granted products qualify without any
        payment ever existing."""
        popup = _make_popup(db, tenant_a, suffix="elig-granted")
        human = _make_human(db, tenant_a, suffix="elig-granted")
        _grant_admin_products(db, tenant_a, popup, human)
        db.commit()

        assert is_upsale_eligible(db, human.id, popup.id) is True

    def test_approved_payment_without_granted_products_is_eligible(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="elig-payment")
        human = _make_human(db, tenant_a, suffix="elig-payment")
        application = _make_application(
            db, tenant_a, popup, human, status=ApplicationStatus.ACCEPTED.value
        )
        _make_application_payment(
            db,
            tenant_a,
            popup,
            application,
            payment_status=PaymentStatus.APPROVED.value,
        )
        db.commit()

        assert is_upsale_eligible(db, human.id, popup.id) is True

    def test_no_products_no_payment_not_eligible(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="elig-none")
        human = _make_human(db, tenant_a, suffix="elig-none")
        _make_application(
            db, tenant_a, popup, human, status=ApplicationStatus.ACCEPTED.value
        )
        db.commit()

        assert is_upsale_eligible(db, human.id, popup.id) is False


# ---------------------------------------------------------------------------
# resolve_upsale_catalog
# ---------------------------------------------------------------------------


class TestResolveUpsaleCatalog:
    def test_eligible_human_sees_upsale_catalog(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        from app.api.application.crud import applications_crud

        popup = _make_popup(db, tenant_a, suffix="catalog-eligible")
        human = _make_human(db, tenant_a, suffix="catalog-eligible")
        _make_direct_purchase(
            db, tenant_a, popup, human, payment_status=PaymentStatus.APPROVED.value
        )
        flow = _make_upsale_flow(db, popup, slug="addon")
        db.commit()

        catalog = applications_crud.resolve_upsale_catalog(db, human.id, popup.id)

        assert [f.id for f in catalog] == [flow.id]

    def test_admin_granted_products_human_sees_upsale_catalog(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        from app.api.application.crud import applications_crud

        popup = _make_popup(db, tenant_a, suffix="catalog-granted")
        human = _make_human(db, tenant_a, suffix="catalog-granted")
        _grant_admin_products(db, tenant_a, popup, human)
        flow = _make_upsale_flow(db, popup, slug="addon")
        db.commit()

        catalog = applications_crud.resolve_upsale_catalog(db, human.id, popup.id)

        assert [f.id for f in catalog] == [flow.id]

    def test_ineligible_human_sees_empty_catalog(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        from app.api.application.crud import applications_crud

        popup = _make_popup(db, tenant_a, suffix="catalog-ineligible")
        human = _make_human(db, tenant_a, suffix="catalog-ineligible")
        _make_upsale_flow(db, popup, slug="addon")
        db.commit()

        catalog = applications_crud.resolve_upsale_catalog(db, human.id, popup.id)

        assert catalog == []

    def test_accepted_unpaid_application_sees_empty_catalog(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        from app.api.application.crud import applications_crud

        popup = _make_popup(db, tenant_a, suffix="catalog-unpaid")
        human = _make_human(db, tenant_a, suffix="catalog-unpaid")
        _make_application(
            db, tenant_a, popup, human, status=ApplicationStatus.ACCEPTED.value
        )
        _make_upsale_flow(db, popup, slug="addon")
        db.commit()

        catalog = applications_crud.resolve_upsale_catalog(db, human.id, popup.id)

        assert catalog == []

    def test_direct_url_only_upsale_excluded_from_catalog(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        from app.api.application.crud import applications_crud

        popup = _make_popup(db, tenant_a, suffix="catalog-unlisted")
        human = _make_human(db, tenant_a, suffix="catalog-unlisted")
        _make_direct_purchase(
            db, tenant_a, popup, human, payment_status=PaymentStatus.APPROVED.value
        )
        _make_upsale_flow(db, popup, slug="hidden-addon", visibility="direct_url_only")
        db.commit()

        catalog = applications_crud.resolve_upsale_catalog(db, human.id, popup.id)

        assert catalog == []

    def test_application_type_flow_excluded_from_catalog(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        from app.api.application.crud import applications_crud

        popup = _make_popup(db, tenant_a, suffix="catalog-app-type")
        human = _make_human(db, tenant_a, suffix="catalog-app-type")
        _make_direct_purchase(
            db, tenant_a, popup, human, payment_status=PaymentStatus.APPROVED.value
        )
        sales_flows_crud.provision_default_flow(
            db, popup_id=popup.id, tenant_id=tenant_a.id, sale_type="application"
        )
        db.commit()

        catalog = applications_crud.resolve_upsale_catalog(db, human.id, popup.id)

        assert catalog == []
