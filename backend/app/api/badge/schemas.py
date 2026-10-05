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
    # The issuer policy a peer award was given under; its allowance counts
    # this award (until an admin revokes it).
    policy_id: uuid.UUID | None = Field(
        default=None, foreign_key="badge_issuer_policies.id", ondelete="SET NULL"
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
    # Who gave it (a peer's name or the admin's), shown to the recipient only.
    issuer_name: str | None = None


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


# ---------------------------------------------------------------------------
# Issuer policies (phase 2): who besides admins can give which badges
# ---------------------------------------------------------------------------


class BadgeAudienceType(StrEnum):
    """Who a policy lets give badges."""

    # An explicit list of people (e.g. a dozen sauna regulars).
    HUMANS = "humans"
    # Every ticket holder of the policy's popup.
    POPUP_ATTENDEES = "popup_attendees"
    # Every human of the tenant.
    TENANT = "tenant"


class AllowanceWindow(StrEnum):
    """Period an allowance resets on.

    ``day`` and ``week`` (ISO, Monday start) follow the calendar of the popup
    the badge is given in; ``popup`` counts everything given within the
    policy's popup; ``lifetime`` never resets.
    """

    DAY = "day"
    WEEK = "week"
    POPUP = "popup"
    LIFETIME = "lifetime"


class BadgeIssuerPolicyBase(SQLModel):
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    name: str = Field(max_length=255)
    audience_type: str = Field(max_length=32)
    # Scopes the policy to one popup: required for popup_attendees audiences
    # and the popup window, optional otherwise.
    popup_id: uuid.UUID | None = Field(
        default=None, foreign_key="popups.id", ondelete="CASCADE"
    )
    # NULL = unlimited.
    allowance_quantity: int | None = None
    allowance_window: str = Field(default=AllowanceWindow.DAY.value, max_length=16)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC), sa_type=DateTime(timezone=True)
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC), sa_type=DateTime(timezone=True)
    )


class BadgeIssuerPolicyHuman(BaseModel):
    id: uuid.UUID
    email: str
    first_name: str | None = None
    last_name: str | None = None


class BadgeIssuerPolicyPublic(BaseModel):
    id: uuid.UUID
    name: str
    audience_type: BadgeAudienceType
    popup_id: uuid.UUID | None = None
    allowance_quantity: int | None = None
    allowance_window: AllowanceWindow
    is_active: bool
    badges: list[BadgeSummary]
    humans: list[BadgeIssuerPolicyHuman]
    created_at: datetime
    updated_at: datetime


def check_policy_shape(
    audience_type: BadgeAudienceType | None,
    popup_id: uuid.UUID | None,
    window: AllowanceWindow | None,
) -> None:
    if audience_type == BadgeAudienceType.POPUP_ATTENDEES and not popup_id:
        raise ValueError("A popup attendees audience needs a popup_id")
    if window == AllowanceWindow.POPUP and not popup_id:
        raise ValueError("A per-popup allowance needs a popup_id")


class BadgeIssuerPolicyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    audience_type: BadgeAudienceType
    popup_id: uuid.UUID | None = None
    allowance_quantity: int | None = Field(default=None, ge=1)
    allowance_window: AllowanceWindow = AllowanceWindow.DAY
    is_active: bool = True
    badge_ids: list[uuid.UUID] = Field(min_length=1)
    # Only used by the humans audience.
    human_ids: list[uuid.UUID] = []

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def _shape(self) -> "BadgeIssuerPolicyCreate":
        check_policy_shape(self.audience_type, self.popup_id, self.allowance_window)
        return self


class BadgeIssuerPolicyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    audience_type: BadgeAudienceType | None = None
    popup_id: uuid.UUID | None = None
    allowance_quantity: int | None = Field(default=None, ge=1)
    allowance_window: AllowanceWindow | None = None
    is_active: bool | None = None
    badge_ids: list[uuid.UUID] | None = Field(default=None, min_length=1)
    human_ids: list[uuid.UUID] | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


class IssuableBadge(BaseModel):
    """A badge the caller may give in a popup right now, and how many more."""

    badge: BadgeSummary
    policy_id: uuid.UUID
    # NULL = unlimited.
    allowance: int | None = None
    remaining: int | None = None
    window: AllowanceWindow
    # When the allowance refills; NULL for windows that never reset.
    resets_at: datetime | None = None


class PortalBadgeAwardCreate(BaseModel):
    badge_id: uuid.UUID
    popup_id: uuid.UUID
    # Directory entries expose attendee ids, never human ids.
    attendee_id: uuid.UUID
    message: str | None = Field(default=None, max_length=500)

    model_config = ConfigDict(str_strip_whitespace=True)


class SentBadgeAward(BaseModel):
    id: uuid.UUID
    badge: BadgeSummary
    recipient_name: str | None = None
    popup_id: uuid.UUID | None = None
    message: str | None = None
    awarded_at: datetime
    revoked_at: datetime | None = None
