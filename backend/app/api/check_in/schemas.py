"""Schemas for the check_ins event log — one row per scan."""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class CheckInPayload(BaseModel):
    """Typed payload stored in the check_ins.payload JSONB column.

    `source` discriminates how the scan occurred. `notes` is an optional
    free-form operator annotation.
    """

    source: Literal["qr", "manual"]
    notes: str | None = None


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

    model_config = ConfigDict(from_attributes=True)
