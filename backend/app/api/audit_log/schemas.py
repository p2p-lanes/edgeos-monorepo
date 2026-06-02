"""Pydantic schemas for the audit log read API."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class AuditLogPublic(BaseModel):
    """A single audit log entry returned to the backoffice."""

    id: uuid.UUID
    source: str
    actor_type: str
    actor_id: uuid.UUID | None = None
    actor_email: str | None = None
    actor_name: str | None = None
    request_id: str | None = None
    action: str
    entity_type: str
    entity_id: uuid.UUID | None = None
    entity_label: str | None = None
    popup_id: uuid.UUID | None = None
    details: dict[str, Any] | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
