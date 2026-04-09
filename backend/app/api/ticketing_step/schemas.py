import uuid

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class TicketingStepBase(SQLModel):
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    step_type: str
    title: str
    description: str | None = Field(default=None, nullable=True)
    order: int = Field(default=0)
    is_enabled: bool = Field(default=True)
    protected: bool = Field(default=False)
    product_category: str | None = Field(default=None, nullable=True)
    template: str | None = Field(default=None, nullable=True)
    template_config: dict | None = Field(
        default=None, sa_column=Column(JSONB, nullable=True)
    )
    watermark: str | None = Field(default=None, nullable=True)
    show_title: bool = Field(default=True)
    show_watermark: bool = Field(default=True)


class TicketingStepPublic(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    popup_id: uuid.UUID
    step_type: str
    title: str
    description: str | None = None
    order: int = 0
    is_enabled: bool = True
    protected: bool = False
    product_category: str | None = None
    template: str | None = None
    template_config: dict | None = None
    watermark: str | None = None
    show_title: bool = True
    show_watermark: bool = True

    model_config = ConfigDict(from_attributes=True)


class TicketingStepCreate(BaseModel):
    popup_id: uuid.UUID
    step_type: str
    title: str
    description: str | None = None
    order: int = 0
    is_enabled: bool = True
    product_category: str | None = None
    template: str | None = None
    template_config: dict | None = None
    watermark: str | None = None
    show_title: bool = True
    show_watermark: bool = True


class TicketingStepUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    order: int | None = None
    is_enabled: bool | None = None
    product_category: str | None = None
    template: str | None = None
    template_config: dict | None = None
    watermark: str | None = None
    show_title: bool | None = None
    show_watermark: bool | None = None
