import uuid
from datetime import UTC, datetime

from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlmodel import Column, DateTime, Field, SQLModel


class PopupPublishableKeys(SQLModel, table=True):
    """Non-secret, browser-safe key that resolves a TENANT for an externally
    hosted checkout UI. Guarded by an origin allowlist, not secrecy.

    Minted at the tenant level (``popup_id`` is None) — a client reuses one key
    across all the tenant's popups; the URL slug picks the popup and the
    resolver maps the key to its tenant. ``popup_id`` may still be set to record
    a legacy per-popup binding, but it is not enforced.
    """

    __tablename__ = "popup_publishable_keys"
    __table_args__ = (
        Index("ix_popup_publishable_keys_popup_revoked", "popup_id", "revoked_at"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID | None = Field(
        default=None, foreign_key="popups.id", index=True
    )
    name: str = Field(max_length=100)
    key_prefix: str = Field(max_length=20)
    key_hash: str = Field(max_length=64, unique=True)
    allowed_origins: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default="[]"),
    )
    last_used_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    revoked_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC), sa_type=DateTime(timezone=True)
    )
