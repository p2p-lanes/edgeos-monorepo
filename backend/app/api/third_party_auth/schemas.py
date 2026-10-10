import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ThirdPartyTokenPair(BaseModel):
    access_token: str = Field(repr=False)
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    refresh_token: str = Field(repr=False)
    refresh_expires_in: int
    grant_id: uuid.UUID
    grant_expires_at: datetime


class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(
        min_length=50, max_length=50, pattern=r"^eos_rt_[A-Za-z0-9_-]{43}$", repr=False
    )


class ThirdPartyGrantPublic(BaseModel):
    id: uuid.UUID
    app_id: uuid.UUID
    app_name: str
    popup_id: uuid.UUID | None
    origin: Literal["sso", "otp"]
    scopes: list[str]
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
