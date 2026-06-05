import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship, SQLModel, func

if TYPE_CHECKING:
    from app.api.human.models import Humans
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants


class Referrals(SQLModel, table=True):
    """Human-driven ambassador code for referral-based access to a popup.

    A human creates a referral code and shares it with others. When someone
    uses the code to apply, the referral's attribution and discount settings
    are applied to their application.
    """

    __tablename__ = "referrals"
    __table_args__ = (
        UniqueConstraint("popup_id", "code", name="uq_referrals_popup_code"),
        Index("ix_referrals_referrer_human_id", "referrer_human_id"),
        Index("ix_referrals_tenant_id", "tenant_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id")
    popup_id: uuid.UUID = Field(foreign_key="popups.id")
    referrer_human_id: uuid.UUID = Field(foreign_key="humans.id")
    code: str = Field(max_length=32)
    discount_percentage: Decimal = Field(
        default=Decimal("0"),
        sa_column=Column(
            "discount_percentage",
            type_=__import__("sqlalchemy").Numeric(5, 2),
            nullable=False,
            server_default="0",
        ),
    )
    auto_approve: bool = Field(default=False)
    max_uses: int | None = Field(default=None, nullable=True)
    current_uses: int = Field(default=0)
    expires_at: datetime | None = Field(
        default=None, nullable=True, sa_type=DateTime(timezone=True)
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
    tenant: "Tenants" = Relationship()
    popup: "Popups" = Relationship()
    referrer_human: "Humans" = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[Referrals.referrer_human_id]"},
    )
