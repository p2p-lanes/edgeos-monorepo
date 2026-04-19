import uuid

from pydantic import BaseModel, ConfigDict
from sqlalchemy import String
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Column, Field, SQLModel


class BaseFieldConfigBase(SQLModel):
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    field_name: str = Field(index=True)
    section_id: uuid.UUID | None = Field(
        default=None, nullable=True, foreign_key="formsections.id"
    )
    position: int = Field(default=0)
    required: bool = Field(default=False)
    label: str | None = Field(default=None, nullable=True)
    placeholder: str | None = Field(default=None, nullable=True)
    help_text: str | None = Field(default=None, nullable=True)
    options: list[str] | None = Field(
        default=None, sa_column=Column(ARRAY(String), nullable=True)
    )


class BaseFieldConfigPublic(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    popup_id: uuid.UUID
    field_name: str
    section_id: uuid.UUID | None = None
    position: int = 0
    required: bool = False
    label: str | None = None
    placeholder: str | None = None
    help_text: str | None = None
    options: list[str] | None = None

    model_config = ConfigDict(from_attributes=True)


class BaseFieldConfigUpdate(BaseModel):
    section_id: uuid.UUID | None = None
    position: int | None = None
    required: bool | None = None
    label: str | None = None
    placeholder: str | None = None
    help_text: str | None = None
    options: list[str] | None = None


class CatalogField(BaseModel):
    """A base field from BASE_FIELD_DEFINITIONS that is available to add to a popup."""

    field_name: str
    type: str
    label: str
    required: bool
    target: str
    default_section_key: str | None = None
