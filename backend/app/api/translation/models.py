import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlmodel import Column, DateTime, Field, Relationship, func

from app.api.translation.schemas import TranslationBase

if TYPE_CHECKING:
    from app.api.tenant.models import Tenants


class Translations(TranslationBase, table=True):
    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            UUID(as_uuid=True),
            primary_key=True,
        ),
    )

    data: dict = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False),
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )
    updated_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    tenant: "Tenants" = Relationship(back_populates="translations")

    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "entity_type",
            "entity_id",
            "language",
            name="uq_translation_entity_language",
        ),
        Index(
            "ix_translation_entity_lookup",
            "entity_type",
            "entity_id",
            "language",
        ),
    )
