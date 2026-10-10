"""Schemas for the check_ins event log — one row per scan."""

import uuid
from datetime import datetime
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict
from pydantic import Field as PydanticField

from app.core.filters import FilterCondition, FilterField, FilterGroup, parse_filters


class CheckInPayload(BaseModel):
    """Typed payload stored in the check_ins.payload JSONB column.

    `source` discriminates how the scan occurred. `notes` is an optional
    free-form operator annotation.
    """

    source: Literal["qr", "manual", "self_service"]
    human_id: uuid.UUID | None = None
    notes: str | None = None


class SelfCheckInPopup(BaseModel):
    id: uuid.UUID
    name: str
    slug: str


class SelfCheckInTicket(BaseModel):
    attendee_product_id: uuid.UUID
    attendee_name: str | None = None
    attendee_category: str | None = None
    product_name: str
    product_category: str | None = None
    duration_type: str | None = None
    checked_in: bool
    first_check_in_at: datetime | None = None


class SelfCheckInOptions(BaseModel):
    popup: SelfCheckInPopup
    tickets: list[SelfCheckInTicket]


class SelfCheckInRequest(BaseModel):
    attendee_product_id: uuid.UUID


class SelfCheckInResult(BaseModel):
    attendee_product_id: uuid.UUID
    attendee_name: str | None = None
    attendee_category: str | None = None
    product_name: str
    product_category: str | None = None
    duration_type: str | None = None
    checked_in: bool
    checked_in_at: datetime


class CheckInBase(BaseModel):
    """Base fields shared by all check-in schemas."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    popup_id: uuid.UUID
    attendee_product_id: uuid.UUID
    occurred_at: datetime
    actor_user_id: uuid.UUID | None = None
    payload: dict[str, Any] | None = None
    created_at: datetime


class CheckInPublic(CheckInBase):
    """Full public representation of a check_ins row for API responses."""

    model_config = ConfigDict(from_attributes=True)


class CheckInListItem(BaseModel):
    """Enriched check-in row for the backoffice scan-history table.

    Eager-loads attendee + product data so the table renders without N+1
    fetches. `source` is extracted from payload["source"].
    """

    id: uuid.UUID
    attendee_product_id: uuid.UUID
    occurred_at: datetime
    source: str | None = None
    attendee_name: str | None = None
    attendee_email: str | None = None
    product_name: str | None = None
    actor_user_id: uuid.UUID | None = None
    actor_user_name: str | None = None
    actor_user_email: str | None = None
    payload: dict | None = None  # full payload for expandable detail view
    # Unit context. Ownerless units (merch with no participant) have no
    # attendee, so the buyer is what identifies who the unit belongs to.
    check_in_code: str | None = None
    product_category: str | None = None
    unit_index: int | None = None  # 0-based position within the order line
    unit_count: int | None = None  # quantity of the order line
    buyer_name: str | None = None
    buyer_email: str | None = None
    sales_flow_id: uuid.UUID | None = None
    sales_flow_name: str | None = None

    model_config = ConfigDict(from_attributes=True)


# Complex list filters (BO scan history), built on the shared engine in
# app.core.filters. Every field is resolved through joins in the router:
# product_category reads the unit's immutable snapshot, sales_flow_id the
# purchasing payment's flow (falling back to the attendee's application).
CHECK_IN_PRODUCT_CATEGORIES = frozenset({"ticket", "housing", "merch", "patreon"})

CHECK_IN_FILTER_FIELDS: dict[str, FilterField] = {
    "sales_flow_id": FilterField(
        "uuid", frozenset({"eq", "neq", "is_empty", "not_empty"})
    ),
    "product_id": FilterField("uuid", frozenset({"eq", "neq"})),
    "product_category": FilterField(
        "select",
        frozenset({"eq", "neq"}),
        CHECK_IN_PRODUCT_CATEGORIES | {"other"},
    ),
    "source": FilterField(
        "select", frozenset({"eq", "neq"}), frozenset({"qr", "manual", "self_service"})
    ),
    "has_attendee": FilterField("boolean", frozenset({"eq"})),
    "occurred_at": FilterField("date", frozenset({"before", "after"})),
}


class CheckInFilterCondition(FilterCondition):
    """One condition of the scan-history filter group."""

    field_registry: ClassVar[dict[str, FilterField]] = CHECK_IN_FILTER_FIELDS


class CheckInFilters(FilterGroup):
    """Filter group for the BO scan-history list."""

    conditions: list[CheckInFilterCondition] = PydanticField(default_factory=list)


def parse_check_in_filters(raw: str | None) -> CheckInFilters | None:
    """Parse the ``filters`` query param JSON into CheckInFilters (422 on bad input)."""
    return parse_filters(raw, CheckInFilters)
