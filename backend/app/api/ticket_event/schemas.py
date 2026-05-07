"""Schemas for ticket_events — event log for per-ticket lifecycle events.

Addendum #12: check_in events are the first type. transfer/refund deferred to
future SDD changes. Payload is discriminated by event_type at the application
layer (not enforced by the DB column itself).
"""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class CheckInPayload(BaseModel):
    """Typed payload for event_type='check_in' rows in ticket_events.

    source is required (discriminates how the scan occurred).
    notes is optional freeform operator annotation.
    """

    source: Literal["qr", "manual"]
    notes: str | None = None


class TicketEventBase(BaseModel):
    """Base fields shared by all ticket event schemas."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    attendee_product_id: uuid.UUID
    event_type: str
    occurred_at: datetime
    actor_user_id: uuid.UUID | None = None
    payload: dict[str, Any] | None = None
    created_at: datetime


class TicketEventPublic(TicketEventBase):
    """Full public representation of a ticket_events row for API responses."""

    model_config = ConfigDict(from_attributes=True)


class TicketEventListItem(BaseModel):
    """Enriched ticket event row for the backoffice scan-history table.

    Eager-loads attendee + product data so the table renders without N+1
    fetches. source is extracted from payload["source"] for check_in events.
    """

    id: uuid.UUID
    attendee_product_id: uuid.UUID
    event_type: str
    occurred_at: datetime
    source: str | None = None  # extracted from payload["source"] for check_in events
    attendee_name: str | None = None
    attendee_email: str | None = None
    product_name: str | None = None
    actor_user_id: uuid.UUID | None = None
    actor_user_name: str | None = None
    actor_user_email: str | None = None
    payload: dict | None = None  # full payload for expandable detail view

    model_config = ConfigDict(from_attributes=True)
