import uuid
from datetime import datetime

from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlmodel import Column, DateTime, Field, SQLModel


class ApiKeys(SQLModel, table=True):
    """Personal access token owned by a Human, scoped to a tenant.

    The raw secret never lives in the DB — only ``key_hash`` (sha256 of
    ``SECRET_KEY + raw_token``). ``prefix`` is a non-secret display fragment
    so users can tell their keys apart in lists.
    """

    __tablename__ = "api_keys"
    __table_args__ = (Index("ix_api_keys_human_revoked", "human_id", "revoked_at"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    human_id: uuid.UUID = Field(foreign_key="humans.id", index=True)
    name: str = Field(max_length=100)
    key_hash: str = Field(max_length=64, unique=True)
    prefix: str = Field(max_length=20)
    scopes: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default="[]"),
    )
    last_used_at: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)
    )
    revoked_at: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)
    )
    expires_at: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True)
    )
    created_at: datetime = Field(
        default_factory=datetime.utcnow, sa_type=DateTime(timezone=True)
    )
