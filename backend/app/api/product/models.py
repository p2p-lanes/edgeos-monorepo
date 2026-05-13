import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Index, text
from sqlalchemy import Numeric as SaNumerical
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship

from app.api.product.schemas import ProductBase

if TYPE_CHECKING:
    from app.api.attendee.models import AttendeeProducts
    from app.api.payment.models import PaymentProducts
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants


# ---------------------------------------------------------------------------
# Products model
# ---------------------------------------------------------------------------


class Products(ProductBase, table=True):
    """Product model for tickets, passes, and other purchasable items."""

    __table_args__ = (
        Index(
            "uq_product_slug_popup_id_active",
            "slug",
            "popup_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_products_popup_active", "popup_id", "is_active"),
        Index(
            "ix_products_active_lookup",
            "popup_id",
            "category",
            postgresql_where=text("is_active = true"),
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            UUID(as_uuid=True),
            primary_key=True,
        ),
    )

    # Soft-delete marker. When set, the row is hidden from all user-facing queries
    # and its slug is released by the partial unique index above.
    deleted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    # Deprecated: product-level insurance percentage, kept in DB for one release window.
    # The authoritative source is popup.insurance_percentage + product.insurance_eligible.
    # Will be dropped in a future migration after release N+1.
    insurance_percentage: Decimal | None = Field(
        default=None, sa_column=Column(SaNumerical(5, 2), nullable=True)
    )

    tenant: "Tenants" = Relationship(back_populates="products")
    popup: "Popups" = Relationship(back_populates="products")

    # Relationships
    attendee_products: list["AttendeeProducts"] = Relationship(back_populates="product")
    payment_products: list["PaymentProducts"] = Relationship(back_populates="product")
