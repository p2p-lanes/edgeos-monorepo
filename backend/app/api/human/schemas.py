import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, DateTime, Field, SQLModel

from app.api.shared.enums import EnrichmentSource, HumanRating


class HumanBase(SQLModel):
    """Base schema for humans (citizens).

    A Human represents a real person identified by their email.
    Profile data is filled progressively as they interact with the platform.
    """

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    email: str = Field(index=True)

    # Profile fields (can be updated anytime)
    first_name: str | None = Field(default=None, max_length=255)
    last_name: str | None = Field(default=None, max_length=255)
    telegram: str | None = Field(default=None, max_length=255)
    gender: str | None = Field(default=None, max_length=50)
    age: str | None = Field(default=None, max_length=50)
    residence: str | None = Field(default=None, max_length=255)

    # Platform fields
    picture_url: str | None = Field(default=None, max_length=500)
    # Admin assessment of the human (see HumanRating). Stored as the enum's
    # string value; replaces the legacy red_flag boolean.
    rating: str = Field(default=HumanRating.UNRATED.value, max_length=20)

    # Curated profile maintained by the enrichment agent (see EnrichedProfile
    # for the expected shape). Free-form JSONB so the agent can evolve it
    # without migrations; NULL = never enriched. Backoffice-only: rendered as
    # rich HTML and filtered on; humans may also edit it by hand. The raw
    # provenance lives in human_enrichment_facts.
    enriched_profile: dict | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )

    # Auth fields
    auth_code: str | None = Field(default=None, max_length=6)
    code_expiration: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)
    )
    auth_attempts: int = Field(default=0)
    # NULL = legacy/portal-origin; otherwise tags the flow that emitted the
    # current OTP so the verify path can reject cross-flow redemption.
    auth_code_origin: str | None = Field(default=None, max_length=20)

    @field_validator("email", mode="after")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.lower().strip()


class HumanPublic(BaseModel):
    """Human schema for API responses."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    email: str

    # Profile
    first_name: str | None = None
    last_name: str | None = None
    telegram: str | None = None
    gender: str | None = None
    age: str | None = None
    residence: str | None = None

    picture_url: str | None = None
    rating: HumanRating = HumanRating.UNRATED
    # Derived from rating (rating == RED_FLAG). Kept so existing callers that
    # gate on the blocking state (api keys, group join, application submit)
    # keep working unchanged.
    red_flag: bool = False
    # Curated profile maintained by the enrichment agent (NULL = never enriched).
    enriched_profile: dict | None = None

    model_config = ConfigDict(from_attributes=True)


class HumanPortalPublic(BaseModel):
    """Slim human profile for portal-facing pickers (event host, mentions…).

    Intentionally excludes email and contact fields: portal-authenticated
    callers can already see other humans' names in event participant lists,
    so name + avatar is the same privacy bar without leaking emails.
    """

    id: uuid.UUID
    first_name: str | None = None
    last_name: str | None = None
    picture_url: str | None = None

    model_config = ConfigDict(from_attributes=True)


class HumanCreate(BaseModel):
    """Human schema for creation."""

    email: str

    # Profile fields
    first_name: str | None = None
    last_name: str | None = None
    telegram: str | None = None
    gender: str | None = None
    age: str | None = None
    residence: str | None = None

    picture_url: str | None = None

    @field_validator("email")
    @classmethod
    def clean_email(cls, v: str) -> str:
        return v.lower().strip()


class HumanProfileUpdate(BaseModel):
    """Schema for humans updating their own profile."""

    first_name: str | None = None
    last_name: str | None = None
    telegram: str | None = None
    gender: str | None = None
    age: str | None = None
    residence: str | None = None
    picture_url: str | None = None

    @field_validator("telegram", mode="before")
    @classmethod
    def strip_strings(cls, v: str | None) -> str | None:
        if v is not None:
            return v.strip() or None
        return v


class HumanUpdate(BaseModel):
    """Human schema for profile updates."""

    first_name: str | None = None
    last_name: str | None = None
    telegram: str | None = None
    gender: str | None = None
    age: str | None = None
    residence: str | None = None
    picture_url: str | None = None
    rating: HumanRating | None = None
    # Admin hand-edit of the curated enriched profile. Omitted = unchanged;
    # the enrichment agent writes this field too (no review queue).
    enriched_profile: dict | None = None

    @field_validator("telegram", mode="before")
    @classmethod
    def strip_strings(cls, v: str | None) -> str | None:
        if v is not None:
            return v.strip() or None
        return v


class HumanProfileStatsPopup(BaseModel):
    """Single popup entry in a human's profile stats."""

    popup_id: uuid.UUID
    popup_name: str
    start_date: datetime | None = None
    end_date: datetime | None = None
    location: str | None = None
    image_url: str | None = None
    total_days: int

    model_config = ConfigDict(from_attributes=True)


class HumanProfileStats(BaseModel):
    """Aggregate stats for the current human's profile page."""

    popups: list[HumanProfileStatsPopup]
    total_days: int


# --------------------------------------------------------------------------- #
# Comments — justify a human's rating; mirrors the task comments model.
# --------------------------------------------------------------------------- #
class HumanCommentCreate(BaseModel):
    body: str = Field(min_length=1)


class HumanCommentUpdate(BaseModel):
    body: str = Field(min_length=1)


class HumanCommentPublic(BaseModel):
    id: uuid.UUID
    human_id: uuid.UUID
    author_user_id: uuid.UUID | None = None
    author_name: str | None = None
    author_email: str | None = None
    body: str
    created_at: datetime
    edited_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------- #
# Rich Profiles — curated enriched profile + provenance facts.
# `humans.enriched_profile` is stored as free-form JSONB; this model documents
# the shape the enrichment agent is expected to converge to and can validate
# the curated payload at the API boundary. Extra keys are allowed so the agent
# can evolve the profile without a migration.
# --------------------------------------------------------------------------- #
class EnrichedProfile(BaseModel):
    """Expected shape of ``humans.enriched_profile`` (the curated summary)."""

    model_config = ConfigDict(extra="allow")

    headline: str | None = None  # one-line "who they are"
    bio: str | None = None  # short curated paragraph
    organization: str | None = None  # current org / company
    role: str | None = None  # role/title
    tags: list[str] = Field(default_factory=list)  # filterable labels
    interests: list[str] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)  # subjects they speak/build on
    links: list[str] = Field(default_factory=list)  # social / web links


class HumanEnrichmentFactCreate(BaseModel):
    """One atomic fact the enrichment agent extracted from a source."""

    field: str = Field(min_length=1, max_length=100)
    value: str = Field(min_length=1)
    source: EnrichmentSource
    evidence: str | None = None  # permalink / event id / org URL
    confidence: float | None = None  # 0..1, optional
    raw: dict | None = None  # structured payload (msg/chat/event ids)


class HumanEnrichmentFactPublic(BaseModel):
    id: uuid.UUID
    human_id: uuid.UUID
    field: str
    value: str
    source: EnrichmentSource
    evidence: str | None = None
    confidence: float | None = None
    raw: dict | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
