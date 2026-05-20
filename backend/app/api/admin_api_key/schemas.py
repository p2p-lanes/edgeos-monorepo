import uuid
from datetime import UTC, datetime, timedelta
from typing import get_args

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.security import ApiKeyScope

# All scope values valid in the ApiKeyScope Literal — used for schema-level
# validation (unknown scope string → 422 before router-level universe check).
_ALL_API_KEY_SCOPES: frozenset[str] = frozenset(get_args(ApiKeyScope))

MAX_WRITE_SCOPE_LIFETIME_DAYS = 30


class AdminApiKeyCreate(BaseModel):
    """Request body for minting a new admin API key."""

    name: str = Field(min_length=1, max_length=100)
    scopes: list[ApiKeyScope] = Field(min_length=1)
    expires_at: datetime | None = None

    @field_validator("scopes")
    @classmethod
    def validate_scopes_universe(cls, scopes: list[str]) -> list[str]:
        if not scopes:
            raise ValueError("At least one scope is required")
        normalized = list(dict.fromkeys(scopes))
        # First wall: reject anything not in the global ApiKeyScope Literal.
        invalid = [s for s in normalized if s not in _ALL_API_KEY_SCOPES]
        if invalid:
            raise ValueError(f"Unknown scopes: {', '.join(sorted(invalid))}")
        return normalized

    @field_validator("expires_at")
    @classmethod
    def validate_expiry(cls, expires_at: datetime | None) -> datetime | None:
        if expires_at is None:
            return None
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        now = datetime.now(UTC)
        if expires_at <= now:
            raise ValueError("API key expiry must be in the future")
        max_expiry = now + timedelta(days=MAX_WRITE_SCOPE_LIFETIME_DAYS)
        if expires_at > max_expiry:
            raise ValueError(
                f"API key expiry cannot be more than {MAX_WRITE_SCOPE_LIFETIME_DAYS} days ahead"
            )
        return expires_at

    @model_validator(mode="after")
    def require_expiry_for_write_scope(self) -> "AdminApiKeyCreate":
        write_scopes = {s for s in self.scopes if s.endswith(":write")}
        if write_scopes and self.expires_at is None:
            raise ValueError("Write-capable API keys require an expiry date")
        return self


class AdminApiKeyPublic(BaseModel):
    """Safe representation of an admin API key — never includes the raw secret."""

    id: uuid.UUID
    name: str
    prefix: str
    scopes: list[ApiKeyScope]
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime | None = None
    revoked_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AdminApiKeyCreated(AdminApiKeyPublic):
    """Response returned only at creation.

    ``raw_key`` is the cleartext token shown once and never stored.
    """

    raw_key: str
