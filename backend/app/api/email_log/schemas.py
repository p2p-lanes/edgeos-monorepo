"""Pydantic/SQLModel schemas for the email log."""

import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict


class EmailLogStatus(StrEnum):
    """Delivery outcome recorded for a dispatched email."""

    SENT = "sent"
    FAILED = "failed"


class EmailLogPublic(BaseModel):
    """A single email log entry returned to the backoffice."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    popup_id: uuid.UUID | None = None
    template_type: str
    to_email: str
    application_id: uuid.UUID | None = None
    payment_id: uuid.UUID | None = None
    human_id: uuid.UUID | None = None
    subject: str | None = None
    status: str
    error: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
