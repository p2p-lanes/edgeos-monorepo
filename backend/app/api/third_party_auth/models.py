"""Revocable third-party grants and hashed, single-use refresh credentials.

Consumed refresh rows are retained until the grant expires, so replay of any
ancestor can revoke the entire family. These tables are backend-private.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import CheckConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, DateTime, Field, SQLModel


class ThirdPartyGrants(SQLModel, table=True):
    __tablename__ = "third_party_grants"
    __table_args__ = (
        CheckConstraint(
            "(origin = 'otp' AND popup_id IS NULL AND redirect_uri IS NULL) OR "
            "(origin = 'sso' AND popup_id IS NOT NULL AND redirect_uri IS NOT NULL)",
            name="third_party_grant_origin_check",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(
        foreign_key="tenants.id", ondelete="CASCADE", index=True
    )
    human_id: uuid.UUID = Field(foreign_key="humans.id", ondelete="CASCADE", index=True)
    app_id: uuid.UUID = Field(
        foreign_key="third_party_apps.id", ondelete="CASCADE", index=True
    )
    popup_id: uuid.UUID | None = Field(
        default=None, foreign_key="popups.id", ondelete="CASCADE"
    )
    origin: str = Field(max_length=3)
    redirect_uri: str | None = Field(default=None, max_length=2048)
    scopes: list[str] = Field(sa_column=Column(JSONB, nullable=False))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC), sa_type=DateTime(timezone=True)
    )
    expires_at: datetime = Field(sa_type=DateTime(timezone=True), index=True)
    revoked_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))


class ThirdPartyRefreshTokens(SQLModel, table=True):
    __tablename__ = "third_party_refresh_tokens"

    token_hash: str = Field(primary_key=True, max_length=64)
    grant_id: uuid.UUID = Field(
        foreign_key="third_party_grants.id", ondelete="CASCADE", index=True
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC), sa_type=DateTime(timezone=True)
    )
    expires_at: datetime = Field(sa_type=DateTime(timezone=True))
    consumed_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
