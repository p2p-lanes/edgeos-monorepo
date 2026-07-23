import uuid

from pydantic import EmailStr
from sqlmodel import Field, SQLModel


class TrialCreate(SQLModel):
    """Body for POST /trials — start a self-serve trial signup."""

    gathering_name: str = Field(min_length=1, max_length=255)
    email: EmailStr = Field(max_length=255)


class TrialVerify(SQLModel):
    """Body for POST /trials/verify — redeem the emailed OTP."""

    email: EmailStr = Field(max_length=255)
    code: str = Field(min_length=6, max_length=6)


class TrialCodeSentResponse(SQLModel):
    message: str
    email: str
    expires_in_minutes: int


class TrialProvisionedResponse(SQLModel):
    """Returned by POST /trials/verify on successful provisioning.

    access_token has the same shape as /auth/user/authenticate (user JWT),
    so the frontend can store it and land directly in the backoffice.
    """

    access_token: str
    token_type: str = "bearer"
    tenant_id: uuid.UUID
    popup_id: uuid.UUID
    backoffice_url: str
