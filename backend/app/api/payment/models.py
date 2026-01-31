import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship, func

from app.api.payment.schemas import PaymentBase, PaymentProductBase

if TYPE_CHECKING:
    from app.api.application.models import Applications
    from app.api.attendee.models import Attendees
    from app.api.coupon.models import Coupons
    from app.api.group.models import Groups
    from app.api.product.models import Products
    from app.api.tenant.models import Tenants


class PaymentProducts(PaymentProductBase, table=True):
    """Link table for payment products with snapshot of product at purchase time."""

    __tablename__ = "payment_products"

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )

    # Relationships
    payment: "Payments" = Relationship(back_populates="products_snapshot")
    product: "Products" = Relationship(back_populates="payment_products")
    attendee: "Attendees" = Relationship(back_populates="payment_products")


class Payments(PaymentBase, table=True):
    """Payment model for tracking purchases."""

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            UUID(as_uuid=True),  # type: ignore[no-matching-overload]
            primary_key=True,
        ),
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
        ),
    )

    # Relationships
    tenant: "Tenants" = Relationship(back_populates="payments")
    application: "Applications" = Relationship(back_populates="payments")
    products_snapshot: list["PaymentProducts"] = Relationship(
        back_populates="payment",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    coupon: Optional["Coupons"] = Relationship(back_populates="payments")
    group: Optional["Groups"] = Relationship(back_populates="payments")

    def get_total_products(self) -> int:
        """Get total number of products in this payment."""
        return sum(pp.quantity for pp in self.products_snapshot)

    def get_products_by_attendee(
        self, attendee_id: uuid.UUID
    ) -> list["PaymentProducts"]:
        """Get products for a specific attendee."""
        return [pp for pp in self.products_snapshot if pp.attendee_id == attendee_id]
