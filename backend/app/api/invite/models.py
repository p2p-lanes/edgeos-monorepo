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
    """A shareable access link to a popup, carrying an access policy.

    One entity, two issuers. An ADMIN link is created from the backoffice and
    may be bound to a single recipient_email. A PORTAL link (what used to be a
    Referral) is created by an attendee to share around, and is subject to the
    popup's max_referrals_per_attendee quota. Tell them apart with
    ``is_portal_created`` / ``referrer_human_id``; everything else -- discount,
    auto-approve, express checkout, use limits, expiry -- behaves identically.

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
        Index("ix_invites_referrer_human_id", "referrer_human_id"),
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
    redeemed_by_human_id: uuid.UUID | None = Field(
        default=None, foreign_key="humans.id", nullable=True
    )
    legacy_migrated_from_group_id: uuid.UUID | None = Field(
        default=None, foreign_key="groups.id", nullable=True
    )
    # Admin force-disable: a disabled link stops granting access and discounts
    # immediately, without deleting its attribution history.
    is_disabled: bool = Field(default=False)
    # Exactly one issuer is set. created_by for backoffice links,
    # referrer_human_id for links an attendee created from the portal.
    created_by: uuid.UUID | None = Field(
        default=None, foreign_key="users.id", nullable=True
    )
    referrer_human_id: uuid.UUID | None = Field(
        default=None, foreign_key="humans.id", nullable=True
    )
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
    redeemed_by_human: Optional["Humans"] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[Invites.redeemed_by_human_id]"},
    )
    legacy_group: Optional["Groups"] = Relationship(
        sa_relationship_kwargs={
            "foreign_keys": "[Invites.legacy_migrated_from_group_id]"
        },
    )
    created_by_user: Optional["Users"] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[Invites.created_by]"},
    )
    referrer_human: Optional["Humans"] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[Invites.referrer_human_id]"},
    )

    @property
    def is_portal_created(self) -> bool:
        """True when an attendee created this link from the portal."""
        return self.referrer_human_id is not None

    @property
    def code(self) -> str:
        """Alias for ``token``.

        Portal-created links were called referrals and addressed their token as
        ``code``. The public /r/{code} URLs and the referral response schemas
        still speak that name.
        """
        return self.token
