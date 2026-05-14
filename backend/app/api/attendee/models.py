import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship, func

from app.api.attendee.schemas import AttendeeBase, AttendeeProductsBase

if TYPE_CHECKING:
    from app.api.application.models import Applications
    from app.api.human.models import Humans
    from app.api.payment.models import PaymentProducts
    from app.api.popup.models import Popups
    from app.api.product.models import Products
    from app.api.tenant.models import Tenants


class AttendeeProducts(AttendeeProductsBase, table=True):
    """Link table for attendee products with quantity."""

    __tablename__ = "attendee_products"

    # Relationships
    attendee: "Attendees" = Relationship(back_populates="attendee_products")
    product: "Products" = Relationship(back_populates="attendee_products")


class Attendees(AttendeeBase, table=True):
    """Attendee model - people attending an event via an application."""

    __table_args__ = (
        Index("ix_attendees_popup_id", "popup_id"),
        # ix_attendees_category_id is created by the migration
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            UUID(as_uuid=True),
            primary_key=True,
        ),
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            server_default=func.now(),
            onupdate=func.now(),
            nullable=False,
        ),
    )

    # Relationships
    tenant: "Tenants" = Relationship(back_populates="attendees")
    application: Optional["Applications"] = Relationship(back_populates="attendees")
    popup: "Popups" = Relationship(back_populates="attendees")
    human: "Humans" = Relationship(
        back_populates="attendees",
        sa_relationship_kwargs={"lazy": "selectin"},
    )
    attendee_products: list["AttendeeProducts"] = Relationship(
        back_populates="attendee",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    payment_products: list["PaymentProducts"] = Relationship(back_populates="attendee")

    @property
    def category(self) -> str:
        """Backwards-compat accessor: return the category key from the FK relationship.

        Reads category_id → AttendeeCategories.key if the relationship is
        loaded. Falls back to "main" when the relationship is not loaded or
        the category is missing (direct-sale attendee without a category).
        """
        from app.api.attendee_category.models import (
            AttendeeCategories as ACModel,  # noqa: PLC0415
        )

        if self.category_id is None:
            return "main"
        # If SQLAlchemy has already resolved the relationship, read from it.
        # This avoids an extra query when the session is not available.
        # AttendeeCategories is accessed via the FK — note: this is a lazy
        # lookup that requires a live session. For schemas that need the full
        # nested object, use the category_id FK directly via relationship.
        from sqlalchemy.orm import object_session  # noqa: PLC0415

        sess = object_session(self)
        if sess is None:
            return "unknown"
        cat = sess.get(ACModel, self.category_id)
        return cat.key if cat else "unknown"

    @property
    def products(self) -> list["Products"]:
        """Get products through the link table."""
        return [ap.product for ap in self.attendee_products]

    def get_product_quantity(self, product_id: uuid.UUID) -> int:
        """Get quantity of a specific product for this attendee (count of ticket rows)."""
        return sum(1 for ap in self.attendee_products if ap.product_id == product_id)

    def has_products(self) -> bool:
        """Check if attendee has any products."""
        return len(self.attendee_products) > 0
