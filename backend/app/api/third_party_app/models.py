"""ThirdPartyApps SQLModel — per-tenant third-party integration credential.

Replaces the v1 tenants.third_party_api_key_hash single-key model with N rows
per tenant. Each app carries its own subset of the platform MAX scopes:
  allowed_token_scopes  ⊆ THIRD_PARTY_TOKEN_SCOPES_MAX
  allowed_api_key_scopes ⊆ THIRD_PARTY_API_KEY_SCOPES_MAX

The partial functional unique index on (tenant_id, lower(name)) WHERE revoked_at
IS NULL lives in the migration DDL — SQLAlchemy's declarative UniqueConstraint
cannot express a functional WHERE clause portably.
"""

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlmodel import Column, DateTime, Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.api.tenant.models import Tenants


class ThirdPartyApps(SQLModel, table=True):
    """A per-tenant third-party integration credential."""

    __tablename__ = "third_party_apps"
    __table_args__ = (
        # Partial index on tenant_id for active (non-revoked) rows — used by
        # tenant-scoped list queries. The partial *unique* index on
        # (tenant_id, lower(name)) is DDL-only (see migration).
        Index(
            "ix_third_party_apps_tenant_active",
            "tenant_id",
            postgresql_where=text("revoked_at IS NULL"),
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(
        foreign_key="tenants.id",
        index=True,
        nullable=False,
    )
    name: str = Field(max_length=100, nullable=False)
    key_hash: str = Field(max_length=64, unique=True, nullable=False)
    prefix: str = Field(max_length=20, nullable=False)

    allowed_token_scopes: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default="[]"),
    )
    allowed_api_key_scopes: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default="[]"),
    )

    active: bool = Field(default=True, nullable=False)
    last_used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    revoked_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    tenant: "Tenants" = Relationship(back_populates="third_party_apps")
