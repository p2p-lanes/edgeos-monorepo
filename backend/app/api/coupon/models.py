import uuid
from typing import TYPE_CHECKING

from sqlalchemy import UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship

from app.api.coupon.schemas import CouponBase

if TYPE_CHECKING:
    from app.api.payment.models import Payments
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants


class Coupons(CouponBase, table=True):
    """Coupon code model for discounts."""

    __table_args__ = (
        UniqueConstraint("code", "popup_id", name="uq_coupon_code_popup_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            UUID(as_uuid=True),  # type: ignore[no-matching-overload]
            primary_key=True,
        ),
    )

    tenant: "Tenants" = Relationship(back_populates="coupons")
    popup: "Popups" = Relationship(back_populates="coupons")

    # Payments that used this coupon
    payments: list["Payments"] = Relationship(back_populates="coupon")
