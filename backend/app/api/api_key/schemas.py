import uuid
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.security import ApiKeyScope

ALLOWED_API_KEY_SCOPES = {"events:read", "events:write", "rsvp:write"}
DEFAULT_API_KEY_SCOPES: list[ApiKeyScope] = ["events:read"]
MAX_WRITE_SCOPE_LIFETIME_DAYS = 30


class ApiKeyCreate(BaseModel):
    """Request body for creating a new API key."""

    name: str = Field(min_length=1, max_length=100)
    expires_at: datetime | None = None
    scopes: list[ApiKeyScope] = Field(default_factory=lambda: list(DEFAULT_API_KEY_SCOPES))

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
    def require_expiry_for_write_scope(self) -> "ApiKeyCreate":
        if "events:write" in self.scopes and self.expires_at is None:
            raise ValueError("Write-capable API keys require an expiry date")
        return self


class ApiKeyPublic(BaseModel):
    """Safe representation of an API key — never includes the raw secret."""

    id: uuid.UUID
    name: str
    prefix: str
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
