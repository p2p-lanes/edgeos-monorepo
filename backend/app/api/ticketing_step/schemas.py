import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class TicketSelectSection(BaseModel):
    """Typed representation of a single section inside ticket_select template_config.sections."""

    key: str
    label: str
    order: int = 0
    product_ids: list[uuid.UUID] = []
    description: str | None = None
    image_url: str | None = None
    # Changed from list[AttendeeCategory] to list[uuid.UUID] per ADR-5
    # Pydantic validates UUID structure only here. Router performs FK existence check.
    attendee_categories: list[uuid.UUID] | None = None

    model_config = ConfigDict(extra="allow")


def _validate_sections_in_template_config(
    template: str | None,
    template_config: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Validate sections inside template_config when template == 'ticket_select'.

    No-ops for other templates or when template_config is absent/has no sections.
    Raises ValueError on invalid section data (FastAPI converts to HTTP 422).
    """
    if template != "ticket_select" or not template_config:
        return template_config
    sections = template_config.get("sections")
    if sections is None:
        return template_config
    if not isinstance(sections, list):
        raise ValueError("template_config.sections must be a list")
    validated = [TicketSelectSection.model_validate(s) for s in sections]
    return {
        **template_config,
        "sections": [s.model_dump(mode="json") for s in validated],
    }


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
    show_in_navbar: bool = Field(default=True)
    emoji: str | None = Field(default=None, nullable=True, max_length=8)


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
    show_in_navbar: bool = True
    emoji: str | None = None

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
    show_in_navbar: bool = True
    emoji: str | None = None

    @model_validator(mode="after")
    def _validate_template_config(self) -> "TicketingStepCreate":
        self.template_config = _validate_sections_in_template_config(
            self.template, self.template_config
        )
        return self


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
    show_in_navbar: bool | None = None
    emoji: str | None = None

    @model_validator(mode="after")
    def _validate_template_config(self) -> "TicketingStepUpdate":
        # Note: when template is None (PATCH without template field), validation is skipped.
        # To trigger validation, send both template and template_config in the same request.
        self.template_config = _validate_sections_in_template_config(
            self.template, self.template_config
        )
        return self
