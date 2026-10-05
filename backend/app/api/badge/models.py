import uuid

from sqlalchemy import CheckConstraint, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship

from app.api.badge.schemas import (
    BadgeAwardBase,
    BadgeBase,
    BadgeImageBase,
    BadgeStyleBase,
)


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
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    badge: Badges = Relationship(sa_relationship_kwargs={"lazy": "joined"})
