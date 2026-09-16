import uuid
from enum import Enum

from pydantic import BaseModel, ConfigDict
from sqlmodel import Field, SQLModel


class FormSectionKind(str, Enum):
    STANDARD = "standard"
    SCHOLARSHIP = "scholarship"


class FormSectionBase(SQLModel):
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    # sdd/sales-flows-rediseno slice 3: belongs to exactly one flow.
    # There is no popup-shared tier and nothing is inherited.
    sales_flow_id: uuid.UUID = Field(
        foreign_key="sales_flows.id", nullable=False, index=True
    )
    label: str
    description: str | None = Field(default=None, nullable=True)
    order: int = Field(default=0)
    protected: bool = Field(default=False)
    hidden: bool = Field(default=False)
    kind: str = Field(default=FormSectionKind.STANDARD.value)


class FormSectionPublic(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    popup_id: uuid.UUID
    sales_flow_id: uuid.UUID
    label: str
    description: str | None = None
    order: int = 0
    protected: bool = False
    hidden: bool = False
    kind: str = FormSectionKind.STANDARD.value

    model_config = ConfigDict(from_attributes=True)


class FormSectionCreate(BaseModel):
    popup_id: uuid.UUID
    # The flow whose form this section joins (slice 3).
    sales_flow_id: uuid.UUID
    label: str
    description: str | None = None
    order: int = 0
    kind: FormSectionKind = FormSectionKind.STANDARD


class FormSectionUpdate(BaseModel):
    label: str | None = None
    description: str | None = None
    order: int | None = None
    hidden: bool | None = None
