import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator
from sqlmodel import DateTime, Field, SQLModel

from app.api.shared.enums import HumanRating


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
    rating: str = Field(default=HumanRating.SIN_CALIFICAR.value, max_length=20)

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
    rating: HumanRating = HumanRating.SIN_CALIFICAR
    # Derived from rating (rating == RED_FLAG). Kept so existing callers that
    # gate on the blocking state (api keys, group join, application submit)
    # keep working unchanged.
    red_flag: bool = False

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
