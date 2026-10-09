import uuid

from pydantic import BaseModel, Field


class PopupAppUpdate(BaseModel):
    enabled: bool


class PopupAppPublic(BaseModel):
    app_id: uuid.UUID
    name: str
    enabled: bool
    sso_configured: bool
    launch_path: str


class SSOLaunchPublic(BaseModel):
    app_name: str
    start_url: str


class AuthorizationCodeRequest(BaseModel):
    state: str = Field(min_length=16, max_length=512, pattern=r"^[A-Za-z0-9._~-]+$")
    code_challenge: str = Field(
        min_length=43, max_length=43, pattern=r"^[A-Za-z0-9_-]+$"
    )
    code_challenge_method: str = Field(pattern=r"^S256$")


class AuthorizationCodePublic(BaseModel):
    redirect_url: str


class SSOExchangeRequest(BaseModel):
    code: str = Field(min_length=43, max_length=43, pattern=r"^[A-Za-z0-9_-]+$")
    redirect_uri: str = Field(max_length=2048)
    code_verifier: str = Field(
        min_length=43, max_length=128, pattern=r"^[A-Za-z0-9._~-]+$"
    )


class SSOExchangePublic(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
