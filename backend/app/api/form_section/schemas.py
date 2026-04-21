import uuid
from enum import Enum

from pydantic import BaseModel, ConfigDict
from sqlmodel import Field, SQLModel


class FormSectionKind(str, Enum):
    STANDARD = "standard"
    COMPANIONS = "companions"
    SCHOLARSHIP = "scholarship"


class FormSectionBase(SQLModel):
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    label: str
    description: str | None = Field(default=None, nullable=True)
    order: int = Field(default=0)
    protected: bool = Field(default=False)
    kind: str = Field(default=FormSectionKind.STANDARD.value)


class FormSectionPublic(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    popup_id: uuid.UUID
    label: str
    description: str | None = None
    order: int = 0
    protected: bool = False
    kind: str = FormSectionKind.STANDARD.value

    model_config = ConfigDict(from_attributes=True)


class FormSectionCreate(BaseModel):
    popup_id: uuid.UUID
    label: str
    description: str | None = None
    order: int = 0
    kind: str = FormSectionKind.STANDARD.value


class FormSectionUpdate(BaseModel):
    label: str | None = None
    description: str | None = None
    order: int | None = None
