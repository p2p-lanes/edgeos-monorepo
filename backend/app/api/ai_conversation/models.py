import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Index,
    SmallInteger,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlmodel import Column, DateTime, Field, SQLModel, func


class AIConversations(SQLModel, table=True):
    __tablename__ = "ai_conversations"
    __table_args__ = (
        CheckConstraint(
            "jsonb_typeof(messages) = 'array'",
            name="ck_ai_conversations_messages_array",
        ),
        Index(
            "ix_ai_conversations_owner_updated",
            "owner_user_id",
            "updated_at",
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    owner_user_id: uuid.UUID = Field(foreign_key="users.id")
    title: str = Field(max_length=120)
    messages: list[dict] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False),
    )
    schema_version: int = Field(
        default=1, sa_column=Column(SmallInteger, nullable=False)
    )
    revision: int = Field(default=1)
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
        default_factory=lambda: datetime.now(UTC) + timedelta(days=30),
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True),
    )


class AIConversationUsage(SQLModel, table=True):
    __tablename__ = "ai_conversation_usage"
    __table_args__ = (
        UniqueConstraint(
            "conversation_id",
            "event_id",
            name="uq_ai_conversation_usage_event",
        ),
        CheckConstraint(
            "input_tokens >= 0 AND cached_input_tokens >= 0 "
            "AND output_tokens >= 0 AND reasoning_tokens >= 0",
            name="ck_ai_conversation_usage_nonnegative",
        ),
        Index(
            "ix_ai_conversation_usage_conversation_created",
            "conversation_id",
            "created_at",
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    conversation_id: uuid.UUID = Field(foreign_key="ai_conversations.id")
    event_id: uuid.UUID
    provider: str = Field(max_length=32)
    model: str = Field(max_length=120)
    input_tokens: int = Field(default=0, sa_column=Column(BigInteger, nullable=False))
    cached_input_tokens: int = Field(
        default=0, sa_column=Column(BigInteger, nullable=False)
    )
    output_tokens: int = Field(default=0, sa_column=Column(BigInteger, nullable=False))
    reasoning_tokens: int = Field(
        default=0, sa_column=Column(BigInteger, nullable=False)
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )
