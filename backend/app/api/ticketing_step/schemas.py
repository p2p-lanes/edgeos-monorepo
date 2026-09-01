import uuid
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, model_validator
from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class TicketSelectSection(BaseModel):
    """Typed representation of a single section inside ticket-select template_config.sections."""

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


class MealPlanMenuOption(BaseModel):
    """One menu choice within a meal-plan product's weekly menu."""

    key: str
    icon: str | None = None
    title: str
    description: str | None = None
    tags: list[str] = []

    model_config = ConfigDict(extra="allow")


class MealPlanSectionProduct(BaseModel):
    """One product entry inside a meal_plan_select section.

    Carries the product reference, its weekday coverage range, and the menu
    options the buyer can pick per day.
    """

    product_id: uuid.UUID
    coverage_start: date
    coverage_end: date
    menu_options: list[MealPlanMenuOption] = []

    model_config = ConfigDict(extra="allow")

    @model_validator(mode="after")
    def _validate(self) -> "MealPlanSectionProduct":
        if self.coverage_start > self.coverage_end:
            raise ValueError(
                "meal_plan_select product.coverage_start must be <= coverage_end"
            )
        keys = [o.key for o in self.menu_options]
        if len(keys) != len(set(keys)):
            raise ValueError(
                "meal_plan_select product.menu_options[].key must be unique within a product"
            )
        if "chef" in keys:
            raise ValueError(
                "meal_plan_select product.menu_options[].key='chef' is reserved for chef's choice"
            )
        return self


class MealPlanSection(BaseModel):
    """One section inside meal_plan_select template_config.sections."""

    key: str
    label: str
    order: int = 0
    description: str | None = None
    products: list[MealPlanSectionProduct] = []

    model_config = ConfigDict(extra="allow")


class MealPlanChefChoiceOption(BaseModel):
    """Step-level chef's choice fallback option.

    The `key` is hard-coded to "chef" in v0 — the cart/reducer logic uses the
    literal string. v1 may make it configurable.
    """

    key: str = "chef"
    icon: str | None = None
    title: str = "Chef's choice"
    description: str | None = None

    model_config = ConfigDict(extra="allow")

    @model_validator(mode="after")
    def _validate(self) -> "MealPlanChefChoiceOption":
        if self.key != "chef":
            raise ValueError(
                "meal_plan_select chef_choice_option.key must equal 'chef' in v0"
            )
        return self


def _validate_sections_in_template_config(
    template: str | None,
    template_config: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Validate sections inside template_config when template == 'ticket-select'.

    No-ops for other templates or when template_config is absent/has no sections.
    Raises ValueError on invalid section data (FastAPI converts to HTTP 422).
    """
    if template != "ticket-select" or not template_config:
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


def _validate_meal_plan_select_template_config(
    template: str | None,
    template_config: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Validate template_config when template == 'meal-plan-select'.

    Validates sections (each with products carrying coverage dates + menu_options)
    and the step-level chef_choice_option. No-op for other templates.
    """
    if template != "meal-plan-select" or not template_config:
        return template_config

    out: dict[str, Any] = dict(template_config)

    sections = template_config.get("sections")
    if sections is not None:
        if not isinstance(sections, list):
            raise ValueError("meal_plan_select template_config.sections must be a list")
        validated_sections = [MealPlanSection.model_validate(s) for s in sections]
        out["sections"] = [s.model_dump(mode="json") for s in validated_sections]

    chef = template_config.get("chef_choice_option")
    if chef is not None:
        validated_chef = MealPlanChefChoiceOption.model_validate(chef)
        out["chef_choice_option"] = validated_chef.model_dump(mode="json")

    return out


class AccommodationBookingConfig(BaseModel):
    """Typed template_config for the ``accommodation-booking`` step.

    Deliberately small. This step only decides **how accommodation is offered
    in this checkout**: which properties, how they are laid out, whether guest
    names are collected, and the copy of the payment notice. The inventory
    itself — rooms, units, nightly prices, photos, the booking calendar —
    lives in the Accommodations section and is shared across steps (and, once
    sales flows land, across flows).

    ``property_ids`` empty means "every visible property", so a step works the
    moment it is enabled instead of showing an empty screen until an admin
    ticks boxes.
    """

    property_ids: list[uuid.UUID] = []
    layout: Literal["grid", "list"] = "grid"
    show_property_headers: bool = True
    require_guest_names: bool = True
    notice_text: str | None = None

    model_config = ConfigDict(extra="allow")

    @model_validator(mode="after")
    def _validate(self) -> "AccommodationBookingConfig":
        if len(set(self.property_ids)) != len(self.property_ids):
            raise ValueError(
                "accommodation-booking template_config.property_ids must be unique"
            )
        return self


def _validate_accommodation_booking_template_config(
    template: str | None,
    template_config: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Validate template_config when template == 'accommodation-booking'.

    Structural validation only (shape, uniqueness). Checking that each
    property actually belongs to the popup is an FK question and lives in the
    router, following the same split as ticket-select.
    """
    # `is None` rather than falsy: an explicit ``{}`` means "configured with
    # nothing", and filling it with defaults makes the stored row say what the
    # step actually offers instead of leaving that to whoever reads it.
    if template != "accommodation-booking" or template_config is None:
        return template_config

    validated = AccommodationBookingConfig.model_validate(template_config)
    return {**template_config, **validated.model_dump(mode="json")}


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
    emoji: str | None = Field(default=None, nullable=True, max_length=32)


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
        self.template_config = _validate_meal_plan_select_template_config(
            self.template, self.template_config
        )
        self.template_config = _validate_accommodation_booking_template_config(
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
        # A PATCH that never mentioned template_config must not be written to
        # here. Assigning to the attribute — even the same value back — puts it
        # in model_fields_set, and BaseCRUD.update dumps with exclude_unset=True:
        # a payload as small as {"order": 2} would then carry
        # template_config=None and blank the column. Reordering steps, renaming
        # one inline, or toggling one on and off all send exactly that.
        # An explicit {"template_config": null} still clears it, as before.
        if "template_config" not in self.model_fields_set:
            return self

        # Note: when template is None (PATCH without template field), validation is skipped.
        # To trigger validation, send both template and template_config in the same request.
        self.template_config = _validate_sections_in_template_config(
            self.template, self.template_config
        )
        self.template_config = _validate_meal_plan_select_template_config(
            self.template, self.template_config
        )
        self.template_config = _validate_accommodation_booking_template_config(
            self.template, self.template_config
        )
        return self
