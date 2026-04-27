import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ApiKeyCreate(BaseModel):
    """Request body for creating a new API key."""

    name: str = Field(min_length=1, max_length=100)
    expires_at: datetime | None = None


class ApiKeyPublic(BaseModel):
    """Safe representation of an API key — never includes the raw secret."""

    id: uuid.UUID
    name: str
    prefix: str
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime | None = None
    revoked_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ApiKeyCreated(ApiKeyPublic):
    """Response returned only at creation. ``key`` is the raw token; it is
    shown to the user exactly once and never persisted in plaintext."""

    key: str
