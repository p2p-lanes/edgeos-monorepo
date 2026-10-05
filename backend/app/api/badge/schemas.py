import uuid
from datetime import UTC, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import Text
from sqlmodel import DateTime, Field, SQLModel


class BadgeIssuerType(StrEnum):
    """Who granted an award.

    Only ``admin`` is issued today; ``human`` (peer sending under an issuer
    policy) and ``rule`` (automatic check-in rules) are reserved for the next
    SIM-108 phases so awards never need a reshape.
    """

    ADMIN = "admin"
    HUMAN = "human"
    RULE = "rule"


# ---------------------------------------------------------------------------
# Table bases
# ---------------------------------------------------------------------------


class BadgeStyleBase(SQLModel):
    """An image set for the badge collection (e.g. "glass", "ceramic")."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    key: str = Field(max_length=64)
    name: str = Field(max_length=255)
    is_default: bool = Field(default=False)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC), sa_type=DateTime(timezone=True)
    )


class BadgeBase(SQLModel):
    """A reusable badge of the tenant's collection."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    slug: str = Field(max_length=100)
    name: str = Field(max_length=255)
    description: str | None = Field(default=None, sa_type=Text())
    category: str | None = Field(default=None, max_length=100)
    # NULL = use the collection's default style.
    style_override_id: uuid.UUID | None = Field(
        default=None, foreign_key="badge_styles.id", ondelete="SET NULL"
    )
    # A repeatable badge (gold star) can be received many times; any other
    # badge has at most one active award per recipient.
    repeatable: bool = Field(default=False)
    archived_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC), sa_type=DateTime(timezone=True)
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC), sa_type=DateTime(timezone=True)
    )


class BadgeImageBase(SQLModel):
    """The artwork of one badge in one style."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    badge_id: uuid.UUID = Field(foreign_key="badges.id", ondelete="CASCADE")
    style_id: uuid.UUID = Field(foreign_key="badge_styles.id", ondelete="CASCADE")
    image_url: str = Field(max_length=500)
    width: int | None = None
    height: int | None = None


class BadgeAwardBase(SQLModel):
    """One badge given to one human."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    badge_id: uuid.UUID = Field(foreign_key="badges.id", ondelete="CASCADE")
    recipient_human_id: uuid.UUID = Field(foreign_key="humans.id", ondelete="CASCADE")
    issuer_type: str = Field(max_length=20)
    # Users are not readable from tenant sessions, so the issuer's name is
    # snapshotted for display instead of being joined.
    issuer_user_id: uuid.UUID | None = None
    issuer_human_id: uuid.UUID | None = Field(
        default=None, foreign_key="humans.id", ondelete="SET NULL"
    )
    issuer_name: str | None = Field(default=None, max_length=255)
    popup_id: uuid.UUID | None = Field(
        default=None, foreign_key="popups.id", ondelete="SET NULL"
    )
    message: str | None = Field(default=None, sa_type=Text())
    # Denormalized NOT badge.repeatable at insert time, so the partial unique
    # index can stop duplicates without reading the badges table.
    is_unique: bool = Field(default=True)
    awarded_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC), sa_type=DateTime(timezone=True)
    )
    revoked_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    revoked_by_user_id: uuid.UUID | None = None
    revoke_reason: str | None = Field(default=None, sa_type=Text())


# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------


class BadgeStylePublic(BaseModel):
    id: uuid.UUID
    key: str
    name: str
    is_default: bool
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


class BadgeStyleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    # Derived from the name when omitted.
    key: str | None = Field(default=None, max_length=64)
    sort_order: int = 0

    model_config = ConfigDict(str_strip_whitespace=True)


class BadgeStyleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    sort_order: int | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


# ---------------------------------------------------------------------------
# Badges
# ---------------------------------------------------------------------------


class BadgeImageIn(BaseModel):
    style_id: uuid.UUID
    image_url: str = Field(min_length=1, max_length=500)
    width: int | None = None
    height: int | None = None


class BadgeImagePublic(BaseModel):
    style_id: uuid.UUID
    image_url: str
    width: int | None = None
    height: int | None = None

    model_config = ConfigDict(from_attributes=True)


class BadgePublic(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    description: str | None = None
    category: str | None = None
    style_override_id: uuid.UUID | None = None
    repeatable: bool
    archived_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    images: list[BadgeImagePublic] = []
    # Resolved artwork: the override style's image, else the default style's,
    # else the first image available.
    image_url: str | None = None
    award_count: int = 0


class BadgeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    # Derived from the name when omitted.
    slug: str | None = Field(default=None, max_length=100)
    description: str | None = None
    category: str | None = Field(default=None, max_length=100)
    style_override_id: uuid.UUID | None = None
    repeatable: bool = False
    images: list[BadgeImageIn] = Field(min_length=1)

    model_config = ConfigDict(str_strip_whitespace=True)


class BadgeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    category: str | None = Field(default=None, max_length=100)
    style_override_id: uuid.UUID | None = None
    repeatable: bool | None = None
    # False restores an archived badge; True archives it.
    archived: bool | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


class BadgeImageUpsert(BaseModel):
    image_url: str = Field(min_length=1, max_length=500)
    width: int | None = None
    height: int | None = None


# ---------------------------------------------------------------------------
# Awards
# ---------------------------------------------------------------------------


class BadgeSummary(BaseModel):
    """The slice of a badge shown next to an award."""

    id: uuid.UUID
    slug: str
    name: str
    description: str | None = None
    category: str | None = None
    repeatable: bool
    image_url: str | None = None


class BadgeAwardRecipient(BaseModel):
    id: uuid.UUID
    email: str
    first_name: str | None = None
    last_name: str | None = None
    picture_url: str | None = None


class BadgeAwardPublic(BaseModel):
    """Administrative view of an award (backoffice and admin API keys)."""

    id: uuid.UUID
    badge: BadgeSummary
    recipient: BadgeAwardRecipient
    issuer_type: BadgeIssuerType
    issuer_name: str | None = None
    popup_id: uuid.UUID | None = None
    message: str | None = None
    awarded_at: datetime
    revoked_at: datetime | None = None
    revoke_reason: str | None = None


class BadgeAwardCreate(BaseModel):
    """Give a badge to a human, identified by id or by email."""

    recipient_human_id: uuid.UUID | None = None
    recipient_email: str | None = None
    popup_id: uuid.UUID | None = None
    message: str | None = Field(default=None, max_length=2000)

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def _one_recipient(self) -> "BadgeAwardCreate":
        if bool(self.recipient_human_id) == bool(self.recipient_email):
            raise ValueError(
                "Provide exactly one of recipient_human_id or recipient_email"
            )
        return self


class BadgeAwardRevoke(BaseModel):
    reason: str | None = Field(default=None, max_length=2000)


# ---------------------------------------------------------------------------
# Portal and public profile
# ---------------------------------------------------------------------------


class MyBadgeAward(BaseModel):
    awarded_at: datetime
    message: str | None = None
    popup_id: uuid.UUID | None = None


class MyBadge(BaseModel):
    """A badge on the caller's own profile, with every active award of it."""

    badge: BadgeSummary
    count: int
    last_awarded_at: datetime
    awards: list[MyBadgeAward]


class PublicProfileBadge(BaseModel):
    name: str
    description: str | None = None
    image_url: str | None = None
    count: int


class PublicProfile(BaseModel):
    """What anyone holding the share link sees. Never add contact fields."""

    display_name: str | None = None
    picture_url: str | None = None
    badges: list[PublicProfileBadge]


class PublicProfileSettings(BaseModel):
    enabled: bool
    token: str


class PublicProfileSettingsUpdate(BaseModel):
    enabled: bool
