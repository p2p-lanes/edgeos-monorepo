import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PublishableKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    allowed_origins: list[str] = Field(default_factory=list)


class PublishableKeyPublic(BaseModel):
    id: uuid.UUID
    popup_id: uuid.UUID | None = None
    name: str
    key_prefix: str
    allowed_origins: list[str]
    created_at: datetime
    last_used_at: datetime | None = None
    revoked_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class PublishableKeyCreated(PublishableKeyPublic):
    """Returned only at creation — carries the raw browser-safe token once."""

    key: str
