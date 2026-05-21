"""Schemas for the ThirdPartyApps admin CRUD surface.

Slice 3 ships:
  ThirdPartyAppCreate    — POST body; validates name + scope subsets.
  ThirdPartyAppUpdate    — PATCH body; all fields optional, same validation.
  ThirdPartyAppPublic    — Safe representation — never includes key_hash.
  ThirdPartyAppCreated   — Extends Public with raw_key (shown once at creation).
  AvailableScopes        — Static platform MAX constants response.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.security import (
    THIRD_PARTY_API_KEY_SCOPES_MAX,
    THIRD_PARTY_TOKEN_SCOPES_MAX,
    ApiKeyScope,
    HumanScope,
)


class ThirdPartyAppCreate(BaseModel):
    """Request body for creating a third-party app."""

    name: str = Field(min_length=1, max_length=100)
    allowed_token_scopes: list[HumanScope] = Field(default_factory=list)
    allowed_api_key_scopes: list[ApiKeyScope] = Field(default_factory=list)

    @field_validator("allowed_token_scopes")
    @classmethod
    def _token_subset(cls, v: list[str]) -> list[str]:
        invalid = set(v) - set(THIRD_PARTY_TOKEN_SCOPES_MAX)
        if invalid:
            raise ValueError(
                f"Scopes not in THIRD_PARTY_TOKEN_SCOPES_MAX: {sorted(invalid)}"
            )
        return v

    @field_validator("allowed_api_key_scopes")
    @classmethod
    def _api_key_subset(cls, v: list[str]) -> list[str]:
        invalid = set(v) - set(THIRD_PARTY_API_KEY_SCOPES_MAX)
        if invalid:
            raise ValueError(
                f"Scopes not in THIRD_PARTY_API_KEY_SCOPES_MAX: {sorted(invalid)}"
            )
        return v


class ThirdPartyAppUpdate(BaseModel):
    """Request body for PATCH /third-party-apps/{id}.

    All fields are optional. Scope validators only fire when the field is
    provided (not-None).
    """

    name: str | None = Field(default=None, min_length=1, max_length=100)
    allowed_token_scopes: list[HumanScope] | None = None
    allowed_api_key_scopes: list[ApiKeyScope] | None = None

    @field_validator("allowed_token_scopes")
    @classmethod
    def _token_subset(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        invalid = set(v) - set(THIRD_PARTY_TOKEN_SCOPES_MAX)
        if invalid:
            raise ValueError(
                f"Scopes not in THIRD_PARTY_TOKEN_SCOPES_MAX: {sorted(invalid)}"
            )
        return v

    @field_validator("allowed_api_key_scopes")
    @classmethod
    def _api_key_subset(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        invalid = set(v) - set(THIRD_PARTY_API_KEY_SCOPES_MAX)
        if invalid:
            raise ValueError(
                f"Scopes not in THIRD_PARTY_API_KEY_SCOPES_MAX: {sorted(invalid)}"
            )
        return v


class ThirdPartyAppPublic(BaseModel):
    """Safe public representation of a ThirdPartyApps row.

    NEVER includes key_hash or any raw key material.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    name: str
    prefix: str
    allowed_token_scopes: list[str]
    allowed_api_key_scopes: list[str]
    active: bool
    last_used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ThirdPartyAppCreated(ThirdPartyAppPublic):
    """Response returned ONCE at app creation (and at key rotation).

    ``raw_key`` is the cleartext token; never stored, shown once only.
    """

    raw_key: str


class AvailableScopes(BaseModel):
    """Static response for GET /third-party-apps/available-scopes.

    Returns the platform MAX constants so the frontend create modal can
    populate its multi-select options without hardcoding scope strings.
    """

    token_scopes: list[str]
    api_key_scopes: list[str]
