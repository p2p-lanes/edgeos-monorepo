"""Checkout regression coverage for fully discounted Parking units."""

import uuid
from decimal import Decimal

from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts
from app.api.coupon.models import Coupons
from app.api.human.models import Humans
from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts
from app.api.payment.schemas import PaymentCreate, PaymentProductRequest, PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from tests._flow_helpers import offer_category, seed_default_steps


def test_authenticated_full_coupon_parking_materializes_one_ownerless_unit(
    db: Session, tenant_a: Tenants
) -> None:
    popup = Popups(
        tenant_id=tenant_a.id,
        name=f"Parking coupon {uuid.uuid4().hex[:6]}",
        slug=f"parking-coupon-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
        allows_coupons=True,
    )
    db.add(popup)
    db.flush()
    flow = seed_default_steps(db, popup, sale_type=SaleType.application.value)
    offer_category(db, popup, "parking")
    human = Humans(
        tenant_id=tenant_a.id,
        email=f"parking-coupon-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Parking",
        last_name="Buyer",
    )
    db.add(human)
    db.flush()
    application = Applications(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        human_id=human.id,
        sales_flow_id=flow.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    product = Products(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        name="Parking",
        slug=f"parking-{uuid.uuid4().hex[:8]}",
        price=Decimal("75.00"),
        currency="USD",
        category="parking",
        requires_check_in=True,
        discountable=True,
        is_active=True,
    )
    db.add(application)
    db.add(product)
    db.flush()
    coupon = Coupons(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        code="FREEPARKING",
        discount_value=100,
        is_active=True,
    )
    db.add(coupon)
    db.commit()

    payment, preview = payments_crud.create_payment(
        db,
        PaymentCreate(
            application_id=application.id,
            products=[PaymentProductRequest(product_id=product.id, quantity=1)],
            coupon_code=coupon.code,
        ),
    )

    assert payment.status == PaymentStatus.APPROVED.value
    assert preview.status == PaymentStatus.APPROVED.value
    assert payment.amount == Decimal("0.00")
    assert payment.coupon_id == coupon.id
    assert payment.discount_value == Decimal("100")

    line = db.exec(
        select(PaymentProducts).where(PaymentProducts.payment_id == payment.id)
    ).one()
    units = list(
        db.exec(
            select(AttendeeProducts).where(AttendeeProducts.payment_id == payment.id)
        ).all()
    )
    assert len(units) == 1
    unit = units[0]
    assert unit.attendee_id is None
    assert unit.product_id == product.id
    assert unit.payment_product_id == line.id
    assert unit.unit_index == 0
    assert unit.check_in_code
    assert unit.revoked_at is None
    assert unit.product_category_snapshot == "parking"
    assert unit.requires_check_in_snapshot is True

    db.expire(coupon)
    db.refresh(coupon)
    assert coupon.current_uses == 1
