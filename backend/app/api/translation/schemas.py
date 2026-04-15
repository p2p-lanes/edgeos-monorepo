import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from sqlmodel import Field, SQLModel


class TranslationBase(SQLModel):
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    entity_type: str = Field(max_length=50, index=True)
    entity_id: uuid.UUID = Field(index=True)
    language: str = Field(max_length=10)
    data: dict = Field(default_factory=dict, sa_column_kwargs={"nullable": False})


class TranslationPublic(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID
    language: str
    data: dict
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class TranslationCreate(BaseModel):
    entity_type: str
    entity_id: uuid.UUID
    language: str
    data: dict


class TranslationUpdate(BaseModel):
    data: dict
