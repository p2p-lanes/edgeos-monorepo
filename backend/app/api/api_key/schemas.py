import uuid
from datetime import UTC, datetime, timedelta
from typing import get_args

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.security import ApiKeyScope

# Derived from the ApiKeyScope Literal so it stays in sync automatically.
# Any new scope added to ApiKeyScope is immediately accepted here.
ALLOWED_API_KEY_SCOPES: frozenset[str] = frozenset(get_args(ApiKeyScope))
DEFAULT_API_KEY_SCOPES: list[ApiKeyScope] = ["events:read"]
# Single source of truth for the maximum (and default) lifetime of any
# write-capable API key. ``admin_api_key.schemas`` re-uses this constant
# so the limit lives in one place.
MAX_WRITE_SCOPE_LIFETIME_DAYS = 90


class ApiKeyCreate(BaseModel):
    """Request body for creating a new API key."""

    name: str = Field(min_length=1, max_length=100)
    # Popup the key is bound to. Human-owned keys are attendee keys: the key
    # only works against this popup's portal routes.
    popup_id: uuid.UUID
    expires_at: datetime | None = None
    scopes: list[ApiKeyScope] = Field(
        default_factory=lambda: list(DEFAULT_API_KEY_SCOPES)
    )

    @field_validator("scopes")
    @classmethod
    def validate_scopes(cls, scopes: list[str]) -> list[str]:
        if not scopes:
            raise ValueError("At least one API key scope is required")
        normalized = list(dict.fromkeys(scopes))
        invalid = [scope for scope in normalized if scope not in ALLOWED_API_KEY_SCOPES]
        if invalid:
            raise ValueError(f"Invalid API key scopes: {', '.join(invalid)}")
        return normalized

    @field_validator("expires_at")
    @classmethod
    def validate_expiry(cls, expires_at: datetime | None) -> datetime | None:
        if expires_at is None:
            return None
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        now = datetime.now(UTC)
        max_expiry = now + timedelta(days=MAX_WRITE_SCOPE_LIFETIME_DAYS)
        if expires_at <= now:
            raise ValueError("API key expiry must be in the future")
        if expires_at > max_expiry:
            raise ValueError(
                f"API key expiry cannot be more than {MAX_WRITE_SCOPE_LIFETIME_DAYS} days ahead"
            )
        return expires_at

    @model_validator(mode="after")
    def default_expiry_for_write_scope(self) -> "ApiKeyCreate":
        # Any scope ending in :write is considered a write scope. The server
        # is the source of truth for the lifetime: when the caller omits
        # ``expires_at``, default to ``now + MAX_WRITE_SCOPE_LIFETIME_DAYS``
        # so frontends don't need to duplicate the constant or fight clock
        # drift against the field validator above.
        write_scopes = {s for s in self.scopes if s.endswith(":write")}
        if write_scopes and self.expires_at is None:
            self.expires_at = datetime.now(UTC) + timedelta(
                days=MAX_WRITE_SCOPE_LIFETIME_DAYS
            )
        return self


class ApiKeyPublic(BaseModel):
    """Safe representation of an API key — never includes the raw secret."""

    id: uuid.UUID
    name: str
    prefix: str
    # None only for legacy rows created before popup scoping (all revoked).
    popup_id: uuid.UUID | None = None
    scopes: list[ApiKeyScope]
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime | None = None
    revoked_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ApiKeyCreated(ApiKeyPublic):
    """Response returned only at creation. ``key`` is the raw token; it is
    shown to the user exactly once and never persisted in plaintext."""

    key: str
