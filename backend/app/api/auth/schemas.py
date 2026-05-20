import uuid

from pydantic import BaseModel, EmailStr, Field, field_validator


def _normalize_email(v: str) -> str:
    return v.lower().strip()


# User (backoffice) authentication schemas
class UserAuth(BaseModel):
    """Request to login a user."""

    email: EmailStr

    _normalize_email = field_validator("email", mode="after")(_normalize_email)


class UserVerify(BaseModel):
    """Request to authenticate a user."""

    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")

    _normalize_email = field_validator("email", mode="after")(_normalize_email)


# Human (external app) authentication schemas
class HumanAuth(BaseModel):
    """Request to initiate human authentication."""

    tenant_id: uuid.UUID
    email: str
    picture_url: str | None = None
    red_flag: bool = False

    _normalize_email = field_validator("email", mode="after")(_normalize_email)


class HumanVerify(BaseModel):
    """Request to verify human authentication code."""

    email: str
    tenant_id: uuid.UUID
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")

    _normalize_email = field_validator("email", mode="after")(_normalize_email)


# Third-party OTP authentication schemas
class ThirdPartyHumanLogin(BaseModel):
    """Request body for POST /auth/human/third-party/login.

    The API key comes from the X-Third-Party-Api-Key header; the tenant is
    resolved server-side from the key.
    """

    email: EmailStr


class ThirdPartyHumanVerify(BaseModel):
    """Request body for POST /auth/human/third-party/authenticate.

    The API key comes from the X-Third-Party-Api-Key header; the tenant is
    resolved server-side from the key.
    """

    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


# Response schemas
class AuthTokenResponse(BaseModel):
    """Response containing JWT access token."""

    access_token: str
    token_type: str = "bearer"


class AuthCodeSentResponse(BaseModel):
    """Response after successfully sending auth code."""

    message: str
    email: str
    expires_in_minutes: int = 15
