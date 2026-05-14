import uuid
from datetime import datetime

from pydantic import ConfigDict
from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class AttendeeCategoryBase(SQLModel):
    """Base schema for attendee categories."""

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    key: str = Field(max_length=64)
    is_primary: bool = Field(default=False)
    sort_order: int = Field(default=0)
    # NOTE: enabled_in_application_form is deliberately omitted per locked decision #1268
    # (companion step is deleted entirely).
    enabled_in_passes_flow: bool = Field(default=True)
    max_per_application: int | None = Field(default=None, nullable=True)
    required_fields: list[dict] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, server_default="[]"),
    )
    display_meta: dict = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default="{}"),
    )


class AttendeeCategoryPublic(SQLModel):
    """Public read model for attendee categories."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    popup_id: uuid.UUID
    key: str
    is_primary: bool = False
    sort_order: int = 0
    enabled_in_passes_flow: bool = True
    max_per_application: int | None = None
    required_fields: list[dict] = []
    display_meta: dict = {}
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AttendeeCategoryCreate(SQLModel):
    """Schema for creating an attendee category."""

    popup_id: uuid.UUID
    key: str = Field(max_length=64)
    sort_order: int = 0
    enabled_in_passes_flow: bool = True
    max_per_application: int | None = None
    required_fields: list[dict] = []
    display_meta: dict = {}


class AttendeeCategoryUpdate(SQLModel):
    """Schema for updating an attendee category.

    key and is_primary are deliberately not updatable — sending them
    causes a 422 validation error (extra="forbid").
    """

    model_config = ConfigDict(extra="forbid")

    sort_order: int | None = None
    enabled_in_passes_flow: bool | None = None
    max_per_application: int | None = None
    required_fields: list[dict] | None = None
    display_meta: dict | None = None
