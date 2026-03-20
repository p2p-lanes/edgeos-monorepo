import uuid

from pydantic import BaseModel, ConfigDict
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
    display_variant: str | None = Field(default=None, nullable=True)


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
    display_variant: str | None = None

    model_config = ConfigDict(from_attributes=True)


class TicketingStepCreate(BaseModel):
    popup_id: uuid.UUID
    step_type: str
    title: str
    description: str | None = None
    order: int = 0
    is_enabled: bool = True
    product_category: str | None = None
    display_variant: str | None = None


class TicketingStepUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    order: int | None = None
    is_enabled: bool | None = None
    product_category: str | None = None
    display_variant: str | None = None
