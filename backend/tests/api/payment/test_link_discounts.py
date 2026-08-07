"""Integration tests: invite/referral discounts reach the money path.

_apply_discounts is best-of-N (group, coupon, invite, referral, scholarship);
each candidate competes against the undiscounted standard amount and only the
single largest discount wins. These tests exercise create_payment end to end
(mocked payment provider) so the branches are covered against real rows, not
arithmetic mocks.
"""

import uuid
from decimal import Decimal
from unittest.mock import MagicMock, patch

from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.group.models import Groups
from app.api.human.models import Humans
from app.api.invite.models import Invites
from app.api.payment.crud import payments_crud
from app.api.payment.schemas import PaymentCreate, PaymentProductRequest
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.referral.models import Referrals
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from tests._flow_helpers import application_flow_id

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Link Discount Popup {uuid.uuid4().hex[:6]}",
        slug=f"linkdisc-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
        simplefi_api_key="fake-simplefi-key",
        invites_enabled=True,
        referrals_enabled=True,
    )
    db.add(popup)
    db.flush()
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    suffix = uuid.uuid4().hex[:8]
    human = Humans(
        tenant_id=tenant.id,
        email=f"linkdisc-{suffix}@test.com",
        first_name="Link",
        last_name="Discount",
    )
    db.add(human)
    db.flush()
    return human


def _make_invite(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    created_by: uuid.UUID,
    *,
    discount_percentage: Decimal,
) -> Invites:
    invite = Invites(
        tenant_id=tenant.id,
        popup_id=popup.id,
        token=f"tok-{uuid.uuid4().hex[:10]}",
        discount_percentage=discount_percentage,
        created_by=created_by,
    )
    db.add(invite)
    db.flush()
    return invite


def _make_referral(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    referrer: Humans,
    *,
    discount_percentage: Decimal,
    is_disabled: bool = False,
) -> Referrals:
    referral = Referrals(
        tenant_id=tenant.id,
        popup_id=popup.id,
        referrer_human_id=referrer.id,
        code=f"ref{uuid.uuid4().hex[:8]}",
        discount_percentage=discount_percentage,
        is_disabled=is_disabled,
    )
    db.add(referral)
    db.flush()
    return referral


def _make_group(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    discount_percentage: Decimal,
) -> Groups:
    suffix = uuid.uuid4().hex[:6]
    group = Groups(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Disc Group {suffix}",
        slug=f"disc-group-{suffix}",
        discount_percentage=discount_percentage,
    )
    db.add(group)
    db.flush()
    return group


def _make_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    invite_id: uuid.UUID | None = None,
    referral_id: uuid.UUID | None = None,
    group_id: uuid.UUID | None = None,
) -> Applications:
    application = Applications(
        sales_flow_id=application_flow_id(db, popup.id),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
        invite_id=invite_id,
        referral_id=referral_id,
        group_id=group_id,
    )
    db.add(application)
    db.flush()
    return application


def _make_attendee(
    db: Session, tenant: Tenants, popup: Popups, application: Applications
) -> Attendees:
    suffix = uuid.uuid4().hex[:6]
    attendee = Attendees(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        name=f"Attendee {suffix}",
        category="main",
        email=f"att-{suffix}@test.com",
    )
    db.add(attendee)
    db.flush()
    return attendee


def _make_product(
    db: Session, tenant: Tenants, popup: Popups, *, price: Decimal
) -> Products:
    slug = uuid.uuid4().hex[:8]
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Week Pass {slug[:4]}",
        slug=slug,
        price=price,
        currency="USD",
        category="ticket",
        duration_type="week",
        discountable=True,
    )
    db.add(product)
    db.flush()
    return product


def _fake_simplefi_response() -> MagicMock:
    resp = MagicMock()
    resp.id = f"sf-{uuid.uuid4().hex[:8]}"
    resp.status = "pending"
    resp.checkout_url = "https://simplefi.co/checkout/test"
    resp.is_installment_plan = False
    return resp


def _create_payment(db: Session, application: Applications, product, attendee):
    obj = PaymentCreate(
        application_id=application.id,
        products=[
            PaymentProductRequest(
                product_id=product.id, attendee_id=attendee.id, quantity=1
            )
        ],
    )
    fake_resp = _fake_simplefi_response()
    with patch("app.services.simplefi.get_simplefi_client") as factory:
        factory.return_value.create_payment.return_value = fake_resp
        payment, _preview = payments_crud.create_payment(db, obj, attribution=None)
    db.refresh(payment)
    return payment


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestInviteDiscountAtPayment:
    def test_invite_discount_applies_without_scholarship(
        self,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Invite 30% on a $100 cart charges $70 with no scholarship involved."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        invite = _make_invite(
            db,
            tenant_a,
            popup,
            admin_user_tenant_a.id,
            discount_percentage=Decimal("30"),
        )
        application = _make_application(db, tenant_a, popup, human, invite_id=invite.id)
        attendee = _make_attendee(db, tenant_a, popup, application)
        product = _make_product(db, tenant_a, popup, price=Decimal("100"))

        payment = _create_payment(db, application, product, attendee)

        assert payment.amount == Decimal("70.00")
        assert application.scholarship_status is None
        assert application.discount_percentage is None

    def test_zero_percent_invite_charges_full_price(
        self,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        invite = _make_invite(
            db,
            tenant_a,
            popup,
            admin_user_tenant_a.id,
            discount_percentage=Decimal("0"),
        )
        application = _make_application(db, tenant_a, popup, human, invite_id=invite.id)
        attendee = _make_attendee(db, tenant_a, popup, application)
        product = _make_product(db, tenant_a, popup, price=Decimal("100"))

        payment = _create_payment(db, application, product, attendee)

        assert payment.amount == Decimal("100.00")

    def test_invite_beats_smaller_group_discount(
        self,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Best-of-N: invite 30% wins over group 10%; group marker cleared."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup, discount_percentage=Decimal("10"))
        invite = _make_invite(
            db,
            tenant_a,
            popup,
            admin_user_tenant_a.id,
            discount_percentage=Decimal("30"),
        )
        application = _make_application(
            db, tenant_a, popup, human, invite_id=invite.id, group_id=group.id
        )
        attendee = _make_attendee(db, tenant_a, popup, application)
        product = _make_product(db, tenant_a, popup, price=Decimal("100"))

        payment = _create_payment(db, application, product, attendee)

        assert payment.amount == Decimal("70.00")
        assert payment.group_id is None

    def test_group_beats_smaller_invite_discount(
        self,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup, discount_percentage=Decimal("50"))
        invite = _make_invite(
            db,
            tenant_a,
            popup,
            admin_user_tenant_a.id,
            discount_percentage=Decimal("20"),
        )
        application = _make_application(
            db, tenant_a, popup, human, invite_id=invite.id, group_id=group.id
        )
        attendee = _make_attendee(db, tenant_a, popup, application)
        product = _make_product(db, tenant_a, popup, price=Decimal("100"))

        payment = _create_payment(db, application, product, attendee)

        assert payment.amount == Decimal("50.00")
        assert payment.group_id == group.id


class TestReferralDiscountAtPayment:
    def test_referral_discount_applies(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Referral 20% on a $100 cart charges $80."""
        popup = _make_popup(db, tenant_a)
        referrer = _make_human(db, tenant_a)
        buyer = _make_human(db, tenant_a)
        referral = _make_referral(
            db, tenant_a, popup, referrer, discount_percentage=Decimal("20")
        )
        application = _make_application(
            db, tenant_a, popup, buyer, referral_id=referral.id
        )
        attendee = _make_attendee(db, tenant_a, popup, application)
        product = _make_product(db, tenant_a, popup, price=Decimal("100"))

        payment = _create_payment(db, application, product, attendee)

        assert payment.amount == Decimal("80.00")

    def test_disabled_referral_grants_no_discount(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """An admin-disabled referral stops discounting immediately."""
        popup = _make_popup(db, tenant_a)
        referrer = _make_human(db, tenant_a)
        buyer = _make_human(db, tenant_a)
        referral = _make_referral(
            db,
            tenant_a,
            popup,
            referrer,
            discount_percentage=Decimal("20"),
            is_disabled=True,
        )
        application = _make_application(
            db, tenant_a, popup, buyer, referral_id=referral.id
        )
        attendee = _make_attendee(db, tenant_a, popup, application)
        product = _make_product(db, tenant_a, popup, price=Decimal("100"))

        payment = _create_payment(db, application, product, attendee)

        assert payment.amount == Decimal("100.00")
