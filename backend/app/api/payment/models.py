import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    CheckConstraint,
    ForeignKeyConstraint,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship, SQLModel, func

from app.api.payment.schemas import (
    PaymentBase,
    PaymentProductBase,
    PaymentRecipientBase,
)

if TYPE_CHECKING:
    from app.api.application.models import Applications
    from app.api.attendee.models import Attendees
    from app.api.coupon.models import Coupons
    from app.api.group.models import Groups
    from app.api.popup.models import Popups
    from app.api.product.models import Products
    from app.api.tenant.models import Tenants


class PaymentProducts(PaymentProductBase, table=True):
    """Link table for payment products with snapshot of product at purchase time."""

    __tablename__ = "payment_products"
    __table_args__ = (
        CheckConstraint(
            "fulfillment_type IS NULL OR fulfillment_type IN "
            "('access', 'participant', 'order')",
            name="ck_payment_products_fulfillment_type",
        ),
        Index(
            "ix_payment_products_payment_fulfillment_type",
            "payment_id",
            "fulfillment_type",
        ),
        CheckConstraint(
            "fulfillment_type IS NULL OR fulfillment_type = 'order' OR "
            "(fulfillment_type IN ('access', 'participant') AND "
            "(payment_recipient_id IS NOT NULL OR attendee_id IS NOT NULL))",
            name="ck_payment_product_fulfillment_identity_compatibility",
        ),
        ForeignKeyConstraint(
            ["payment_recipient_id", "payment_id"],
            ["payment_recipients.id", "payment_recipients.payment_id"],
            name="fk_payment_product_recipient_payment",
        ),
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )
    fulfillment_type: str | None = Field(default=None, nullable=True)

    # Relationships
    payment: "Payments" = Relationship(back_populates="products_snapshot")
    product: "Products" = Relationship(back_populates="payment_products")
    attendee: Optional["Attendees"] = Relationship(back_populates="payment_products")
    recipient: Optional["PaymentRecipients"] = Relationship(
        back_populates="products",
        sa_relationship_kwargs={
            "primaryjoin": "PaymentProducts.payment_recipient_id == PaymentRecipients.id",
            "foreign_keys": "PaymentProducts.payment_recipient_id",
        },
    )

    @property
    def attendee_name(self) -> str | None:
        if self.recipient:
            return self.recipient.name
        return self.attendee.name if self.attendee else None

    @property
    def recipient_key(self) -> str | None:
        return self.recipient.recipient_key if self.recipient else None


class PaymentRecipients(PaymentRecipientBase, table=True):
    """Immutable recipient snapshot for one payment attempt."""

    __tablename__ = "payment_recipients"
    __table_args__ = (
        UniqueConstraint(
            "payment_id", "recipient_key", name="uq_payment_recipient_payment_key"
        ),
        UniqueConstraint("id", "payment_id", name="uq_payment_recipient_id_payment"),
        CheckConstraint(
            "recipient_key <> ''", name="ck_payment_recipient_key_nonempty"
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )
    payment: "Payments" = Relationship(back_populates="recipients")
    products: list["PaymentProducts"] = Relationship(
        back_populates="recipient",
        sa_relationship_kwargs={
            "primaryjoin": "PaymentRecipients.id == PaymentProducts.payment_recipient_id",
            "foreign_keys": "PaymentProducts.payment_recipient_id",
        },
    )


class Payments(PaymentBase, table=True):
    """Payment model for tracking purchases."""

    # application_id is nullable (direct-sale payments have no application).
    # ix_payments_application_status is a PARTIAL index — only includes rows
    # where application_id IS NOT NULL.
    __table_args__ = (
        Index(
            "ix_payments_application_status",
            "application_id",
            "status",
            postgresql_where=text("application_id IS NOT NULL"),
        ),
        Index(
            "ix_payments_pending_queue",
            "created_at",
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_payments_popup_id", "popup_id"),
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
    meta_fbc: str | None = Field(
        default=None,
        sa_column=Column(String(512), nullable=True),
    )
    meta_fbp: str | None = Field(
        default=None,
        sa_column=Column(String(512), nullable=True),
    )
    meta_client_ip: str | None = Field(
        default=None,
        sa_column=Column(String(128), nullable=True),
    )
    meta_client_user_agent: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )

    # Relationships
    tenant: "Tenants" = Relationship(back_populates="payments")
    application: Optional["Applications"] = Relationship(back_populates="payments")
    popup: "Popups" = Relationship(back_populates="payments")
    products_snapshot: list["PaymentProducts"] = Relationship(
        back_populates="payment",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    recipients: list["PaymentRecipients"] = Relationship(
        back_populates="payment",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    coupon: Optional["Coupons"] = Relationship(back_populates="payments")
    group: Optional["Groups"] = Relationship(back_populates="payments")
    installments: list["PaymentInstallments"] = Relationship(
        back_populates="payment",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )

    def get_total_products(self) -> int:
        """Get total number of products in this payment."""
        return sum(pp.quantity for pp in self.products_snapshot)

    def get_products_by_attendee(
        self, attendee_id: uuid.UUID
    ) -> list["PaymentProducts"]:
        """Get products for a specific attendee."""
        return [pp for pp in self.products_snapshot if pp.attendee_id == attendee_id]

    def _buyer_attendee(self) -> Optional["Attendees"]:
        """Resolve the attendee that represents the buyer for direct-sale payments.

        Direct sales create a single buyer attendee (human, popup); we take the
        first product's attendee as the purchaser. Returns None when no product
        snapshot carries an attendee.
        """
        for pp in self.products_snapshot:
            if pp.attendee is not None:
                return pp.attendee
        return None

    @property
    def buyer_email(self) -> str | None:
        """Email of the person who paid.

        Application-based payments resolve via application.human; direct-sale
        payments resolve via the buyer attendee's human (falling back to the
        attendee email). Requires the application.human and
        products_snapshot.attendee.human relationships to be loaded.
        """
        if self.application is not None and self.application.human is not None:
            return self.application.human.email
        if self.buyer_snapshot and self.buyer_snapshot.get("buyer_email"):
            return str(self.buyer_snapshot["buyer_email"])
        attendee = self._buyer_attendee()
        if attendee is not None:
            if attendee.human is not None:
                return attendee.human.email
            return attendee.email
        return None

    @property
    def buyer_name(self) -> str | None:
        """Display name of the person who paid (see buyer_email for resolution)."""
        if self.application is not None and self.application.human is not None:
            return self.application.human.display_name
        if self.buyer_snapshot and self.buyer_snapshot.get("buyer_name"):
            return str(self.buyer_snapshot["buyer_name"])
        attendee = self._buyer_attendee()
        if attendee is not None:
            if attendee.human is not None:
                return attendee.human.display_name
            return attendee.name
        return None


class PaymentInstallments(SQLModel, table=True):
    """Individual installment records for installment plan payments."""

    __tablename__ = "payment_installments"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    payment_id: uuid.UUID = Field(foreign_key="payments.id", index=True)
    external_payment_id: str = Field(nullable=False)
    installment_number: int = Field(nullable=False)
    amount: Decimal = Field(sa_column=Column(Numeric(10, 2), nullable=False))
    currency: str = Field(default="USD")
    paid_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )

    # Relationships
    payment: "Payments" = Relationship(back_populates="installments")
