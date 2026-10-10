"""Popup launch permissions and short-lived, single-use authorization codes."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, DateTime, Field, SQLModel


class PopupThirdPartyApps(SQLModel, table=True):
    __tablename__ = "popup_third_party_apps"

    popup_id: uuid.UUID = Field(
        foreign_key="popups.id", primary_key=True, ondelete="CASCADE"
    )
    app_id: uuid.UUID = Field(
        foreign_key="third_party_apps.id", primary_key=True, ondelete="CASCADE"
    )
    tenant_id: uuid.UUID = Field(
        foreign_key="tenants.id", index=True, ondelete="CASCADE"
    )
    enabled: bool = Field(default=True)


class ThirdPartyAuthorizationCodes(SQLModel, table=True):
    __tablename__ = "third_party_authorization_codes"

    code_hash: str = Field(primary_key=True, max_length=64)
    tenant_id: uuid.UUID = Field(
        foreign_key="tenants.id", index=True, ondelete="CASCADE"
    )
    human_id: uuid.UUID = Field(foreign_key="humans.id", ondelete="CASCADE")
    app_id: uuid.UUID = Field(foreign_key="third_party_apps.id", ondelete="CASCADE")
    popup_id: uuid.UUID = Field(foreign_key="popups.id", ondelete="CASCADE")
    redirect_uri: str = Field(sa_column=Column(Text(), nullable=False))
    code_challenge: str = Field(max_length=43)
    scopes: list[str] = Field(sa_column=Column(JSONB, nullable=False))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    expires_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True)
    )
    consumed_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
