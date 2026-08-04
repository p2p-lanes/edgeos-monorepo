import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict
from sqlmodel import Field, SQLModel


class PopupReviewerBase(SQLModel):
    """Base schema for popup reviewers.

    A PopupReviewer designates a user as a reviewer for a specific popup's applications.
    """

    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    # sdd/sales-flows slice 7 (D4: reviewer tri-state). NULL = popup-shared
    # tier (the reviewer list every flow inherits by default), non-NULL =
    # owned exclusively by that flow — only meaningful once the flow's
    # `reviewers_mode` is 'override'. Mirrors FormFieldBase.sales_flow_id.
    flow_id: uuid.UUID | None = Field(
        default=None, foreign_key="sales_flows.id", nullable=True, index=True
    )

    # Per-reviewer settings
    is_required: bool = Field(
        default=False
    )  # For ALL_REVIEWERS: must this user review?
    weight_multiplier: float = Field(default=1.0)  # For WEIGHTED: multiply vote weight


class PopupReviewerCreate(BaseModel):
    """Schema for adding a reviewer to a popup.

    `flow_id` omitted (None) adds a popup-shared reviewer; providing it adds
    a reviewer scoped exclusively to that flow (sdd/sales-flows D4) and
    switches the flow's `reviewers_mode` to 'override'.
    """

    user_id: uuid.UUID
    flow_id: uuid.UUID | None = None
    is_required: bool = False
    weight_multiplier: float = 1.0


class PopupReviewerUpdate(BaseModel):
    """Schema for updating a popup reviewer."""

    is_required: bool | None = None
    weight_multiplier: float | None = None


class PopupReviewerPublic(BaseModel):
    """PopupReviewer schema for API responses."""

    id: uuid.UUID
    popup_id: uuid.UUID
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    flow_id: uuid.UUID | None = None
    is_required: bool
    weight_multiplier: float
    created_at: datetime | None = None

    # Include user details
    user_email: str | None = None
    user_full_name: str | None = None

    model_config = ConfigDict(from_attributes=True)
