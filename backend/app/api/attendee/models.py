import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import CheckConstraint, Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship, func

from app.api.attendee.schemas import AttendeeBase, AttendeeProductsBase

if TYPE_CHECKING:
    from app.api.application.models import Applications
    from app.api.attendee_category.models import AttendeeCategories
    from app.api.human.models import Humans
    from app.api.payment.models import PaymentProducts
    from app.api.popup.models import Popups
    from app.api.product.models import Products
    from app.api.tenant.models import Tenants


class AttendeeProducts(AttendeeProductsBase, table=True):
    """Link table for attendee products with quantity."""

    __tablename__ = "attendee_products"
    __table_args__ = (
        CheckConstraint(
            "fulfillment_type IS NULL OR fulfillment_type IN "
            "('access', 'participant', 'order')",
            name="ck_attendee_products_fulfillment_type",
        ),
        Index(
            "ix_attendee_products_attendee_fulfillment_type",
            "attendee_id",
            "fulfillment_type",
        ),
        CheckConstraint(
            "(payment_product_id IS NULL) = (unit_index IS NULL)",
            name="ck_attendee_product_lineage_pair",
        ),
        CheckConstraint(
            "unit_index IS NULL OR unit_index >= 0",
            name="ck_attendee_product_unit_index_nonnegative",
        ),
        Index(
            "ux_attendee_product_payment_product_unit",
            "payment_product_id",
            "unit_index",
            unique=True,
            postgresql_where=text("payment_product_id IS NOT NULL"),
        ),
    )
    fulfillment_type: str | None = Field(default=None, nullable=True)

    # Relationships
    attendee: "Attendees" = Relationship(back_populates="attendee_products")
    product: "Products" = Relationship(back_populates="attendee_products")


class Attendees(AttendeeBase, table=True):
    """Attendee model - people attending an event via an application."""

    __table_args__ = (
        Index("ix_attendees_popup_id", "popup_id"),
        Index("ix_attendees_human_popup", "human_id", "popup_id"),
        Index("ix_attendees_email", "email"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            UUID(as_uuid=True),
            primary_key=True,
        ),
    )
    managed_by_human_id: uuid.UUID | None = Field(
        default=None, foreign_key="humans.id", index=True, nullable=True
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
        sa_relationship_kwargs={
            "lazy": "selectin",
            "foreign_keys": "Attendees.human_id",
        },
    )
    manager: Optional["Humans"] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "Attendees.managed_by_human_id"}
    )
    attendee_products: list["AttendeeProducts"] = Relationship(
        back_populates="attendee",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    payment_products: list["PaymentProducts"] = Relationship(back_populates="attendee")
    category_ref: Optional["AttendeeCategories"] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "Attendees.category_id"},
    )

    @property
    def category(self) -> str:
        """Backwards-compat accessor: return the category key from the FK relationship.

        Listing endpoints must eager-load `category_ref` (selectinload) so this
        access does not trigger an extra query per attendee. When the
        relationship is not loaded SQLAlchemy lazy-loads it via the bound
        session, mirroring the pre-relationship behaviour.
        """
        if self.category_id is None:
            return "main"
        cat = self.category_ref
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
