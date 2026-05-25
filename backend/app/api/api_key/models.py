import uuid
from datetime import UTC, datetime

from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlmodel import Column, DateTime, Field, SQLModel


class ApiKeys(SQLModel, table=True):
    """Access token owned by a Human (portal PAT) or a User (admin key).

    Exactly one of ``human_id`` / ``user_id`` must be non-null; this is
    enforced at the DB level by the ``api_keys_owner_check`` CHECK constraint
    added in migration ``<hash>_third_party_otp_scoped_auth``.

    The raw secret never lives in the DB — only ``key_hash`` (sha256 of
    ``SECRET_KEY + raw_token``). ``prefix`` is a non-secret display fragment
    so users can tell their keys apart in lists.
    """

    __tablename__ = "api_keys"
    __table_args__ = (
        Index("ix_api_keys_human_revoked", "human_id", "revoked_at"),
        Index("ix_api_keys_user_revoked", "user_id", "revoked_at"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    # Human-owned (portal PAT) — nullable to support admin-owned keys.
    human_id: uuid.UUID | None = Field(
        default=None,
        foreign_key="humans.id",
        index=True,
    )
    # Admin-owned key — nullable to support human-owned keys.
    user_id: uuid.UUID | None = Field(
        default=None,
        foreign_key="users.id",
        index=True,
    )
    name: str = Field(max_length=100)
    key_hash: str = Field(max_length=64, unique=True)
    prefix: str = Field(max_length=20)
    scopes: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default="[]"),
    )
    last_used_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    revoked_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    expires_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC), sa_type=DateTime(timezone=True)
    )
