import uuid
from datetime import UTC, datetime

from sqlalchemy import UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlmodel import Column, DateTime, Field, SQLModel, func


class SavedViews(SQLModel, table=True):
    """A team-shared saved view: a named list configuration for a popup entity."""

    __tablename__ = "saved_views"
    __table_args__ = (
        UniqueConstraint(
            "popup_id", "entity", "name", name="uq_saved_view_popup_entity_name"
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    entity: str = Field(index=True)
    name: str
    config: dict = Field(sa_column=Column(JSONB, nullable=False))
    created_by: uuid.UUID = Field(foreign_key="users.id", index=True)

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )
