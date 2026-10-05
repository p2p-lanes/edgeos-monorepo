import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship, SQLModel

from app.api.badge.schemas import (
    BadgeAwardBase,
    BadgeBase,
    BadgeImageBase,
    BadgeIssuerPolicyBase,
    BadgeRuleBase,
    BadgeStyleBase,
)

if TYPE_CHECKING:
    from app.api.human.models import Humans


class BadgeStyles(BadgeStyleBase, table=True):
    __tablename__ = "badge_styles"
    __table_args__ = (
        UniqueConstraint("tenant_id", "key", name="uq_badge_styles_tenant_key"),
        # At most one default style per tenant.
        Index(
            "uq_badge_styles_tenant_default",
            "tenant_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )


class Badges(BadgeBase, table=True):
    __tablename__ = "badges"
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_badges_tenant_slug"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    images: list["BadgeImages"] = Relationship(
        sa_relationship_kwargs={"cascade": "all, delete-orphan", "lazy": "selectin"},
    )


class BadgeImages(BadgeImageBase, table=True):
    __tablename__ = "badge_images"
    __table_args__ = (
        UniqueConstraint("badge_id", "style_id", name="uq_badge_images_badge_style"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )


class BadgeAwards(BadgeAwardBase, table=True):
    __tablename__ = "badge_awards"
    __table_args__ = (
        CheckConstraint(
            "issuer_type IN ('admin', 'human', 'rule')",
            name="ck_badge_awards_issuer_type",
        ),
        CheckConstraint(
            "issuer_type <> 'admin' OR issuer_user_id IS NOT NULL",
            name="ck_badge_awards_admin_issuer",
        ),
        CheckConstraint(
            "issuer_type <> 'human' OR issuer_human_id IS NOT NULL",
            name="ck_badge_awards_human_issuer",
        ),
        # A non-repeatable badge has at most one active award per recipient.
        # Revoked awards drop out, so the badge can be given again.
        Index(
            "uq_badge_awards_active_unique",
            "badge_id",
            "recipient_human_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL AND is_unique"),
        ),
        Index("ix_badge_awards_recipient", "recipient_human_id", "revoked_at"),
        Index("ix_badge_awards_issuer_human", "issuer_human_id", "awarded_at"),
        Index("ix_badge_awards_badge", "badge_id"),
        # Allowance counting: an issuer's awards under one policy since T.
        # A rule awards each person at most once, ever: revoked rows count,
        # so an admin's revoke is not undone by the next check-in.
        Index(
            "uq_badge_awards_rule_recipient",
            "rule_id",
            "recipient_human_id",
            unique=True,
            postgresql_where=text("rule_id IS NOT NULL"),
        ),
        Index(
            "ix_badge_awards_policy_issuer",
            "policy_id",
            "issuer_human_id",
            "awarded_at",
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    badge: Badges = Relationship(sa_relationship_kwargs={"lazy": "joined"})


class BadgeIssuerPolicyBadges(SQLModel, table=True):
    """Badges a policy lets its audience give (sharing one allowance)."""

    __tablename__ = "badge_issuer_policy_badges"

    policy_id: uuid.UUID = Field(
        foreign_key="badge_issuer_policies.id", primary_key=True, ondelete="CASCADE"
    )
    badge_id: uuid.UUID = Field(
        foreign_key="badges.id", primary_key=True, ondelete="CASCADE"
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)


class BadgeIssuerPolicyHumans(SQLModel, table=True):
    """The people of a ``humans`` audience."""

    __tablename__ = "badge_issuer_policy_humans"

    policy_id: uuid.UUID = Field(
        foreign_key="badge_issuer_policies.id", primary_key=True, ondelete="CASCADE"
    )
    human_id: uuid.UUID = Field(
        foreign_key="humans.id", primary_key=True, ondelete="CASCADE"
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)


class BadgeIssuerPolicies(BadgeIssuerPolicyBase, table=True):
    __tablename__ = "badge_issuer_policies"
    __table_args__ = (
        CheckConstraint(
            "audience_type IN ('humans', 'popup_attendees', 'tenant')",
            name="ck_badge_issuer_policies_audience",
        ),
        CheckConstraint(
            "allowance_window IN ('day', 'week', 'popup', 'lifetime')",
            name="ck_badge_issuer_policies_window",
        ),
        CheckConstraint(
            "(audience_type <> 'popup_attendees' AND allowance_window <> 'popup')"
            " OR popup_id IS NOT NULL",
            name="ck_badge_issuer_policies_popup",
        ),
        CheckConstraint(
            "allowance_quantity IS NULL OR allowance_quantity > 0",
            name="ck_badge_issuer_policies_quantity",
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    badges: list[Badges] = Relationship(
        link_model=BadgeIssuerPolicyBadges,
        # Read-only: link rows are written explicitly so they carry tenant_id.
        sa_relationship_kwargs={"lazy": "selectin", "viewonly": True},
    )
    humans: list["Humans"] = Relationship(
        link_model=BadgeIssuerPolicyHumans,
        # Read-only: link rows are written explicitly so they carry tenant_id.
        sa_relationship_kwargs={"lazy": "selectin", "viewonly": True},
    )


class BadgeRules(BadgeRuleBase, table=True):
    """Awards a badge automatically once someone meets its condition."""

    __tablename__ = "badge_rules"
    __table_args__ = (
        CheckConstraint(
            "type IN ('checkins_in_track', 'checkins_in_popup')",
            name="ck_badge_rules_type",
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    badge: Badges = Relationship(sa_relationship_kwargs={"lazy": "joined"})
