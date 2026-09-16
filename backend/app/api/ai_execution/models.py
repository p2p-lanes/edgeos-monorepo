import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import CheckConstraint, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlmodel import Column, DateTime, Field, SQLModel, func


class AIExecutions(SQLModel, table=True):
    """Durable idempotency records for approved AI write operations."""

    __tablename__ = "ai_executions"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "owner_user_id",
            "execution_id",
            name="uq_ai_executions_owner_execution",
        ),
        CheckConstraint(
            "state IN ('pending', 'completed')",
            name="ck_ai_executions_state",
        ),
        Index(
            "ix_ai_executions_owner_expires",
            "owner_user_id",
            "expires_at",
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    owner_user_id: uuid.UUID = Field(foreign_key="users.id")
    execution_id: str = Field(max_length=64)
    fingerprint: str = Field(max_length=64)
    state: str = Field(max_length=16)
    result: Any | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )
    expires_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC) + timedelta(hours=1),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
