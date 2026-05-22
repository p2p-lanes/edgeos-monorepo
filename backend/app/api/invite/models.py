import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship, SQLModel, func

if TYPE_CHECKING:
    from app.api.group.models import Groups
    from app.api.human.models import Humans
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants
    from app.api.user.models import Users


class Invites(SQLModel, table=True):
    """Token-based admin offer for invite-only access to a popup.

    An invite is created by an admin and shared via a URL. A human redeems it
    to create an application with the invite's discount and approval settings.

    Email stored lowercase via validator when setting recipient_email.
    """

    __tablename__ = "invites"
    __table_args__ = (
        UniqueConstraint("popup_id", "token", name="uq_invites_popup_token"),
        Index(
            "uq_invites_legacy_group_id",
            "legacy_migrated_from_group_id",
            unique=True,
            postgresql_where=text("legacy_migrated_from_group_id IS NOT NULL"),
        ),
        Index("ix_invites_tenant_id", "tenant_id"),
        Index("ix_invites_popup_recipient_email", "popup_id", "recipient_email"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id")
    popup_id: uuid.UUID = Field(foreign_key="popups.id")
    token: str = Field(max_length=64)
    recipient_email: str | None = Field(default=None, nullable=True)
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
    express_checkout: bool = Field(default=False)
    max_uses: int | None = Field(default=None, nullable=True)
    current_uses: int = Field(default=0)
    used_at: datetime | None = Field(
        default=None, nullable=True, sa_type=DateTime(timezone=True)
    )
    recipient_human_id: uuid.UUID | None = Field(
        default=None, foreign_key="humans.id", nullable=True
    )
    redeemed_by_human_id: uuid.UUID | None = Field(
        default=None, foreign_key="humans.id", nullable=True
    )
    legacy_migrated_from_group_id: uuid.UUID | None = Field(
        default=None, foreign_key="groups.id", nullable=True
    )
    created_by: uuid.UUID = Field(foreign_key="users.id")
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
    recipient_human: Optional["Humans"] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[Invites.recipient_human_id]"},
    )
    redeemed_by_human: Optional["Humans"] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[Invites.redeemed_by_human_id]"},
    )
    legacy_group: Optional["Groups"] = Relationship(
        sa_relationship_kwargs={
            "foreign_keys": "[Invites.legacy_migrated_from_group_id]"
        },
    )
    created_by_user: "Users" = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[Invites.created_by]"},
    )
