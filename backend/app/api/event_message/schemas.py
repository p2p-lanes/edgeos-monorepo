import uuid
from datetime import datetime

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class EventMessageCreate(BaseModel):
    id: uuid.UUID = Field(description="Reuse this ID when retrying the same send.")
    body: str = Field(min_length=1, max_length=10000)
    occurrence_start: AwareDatetime | None = None

    model_config = ConfigDict(str_strip_whitespace=True)


class EventMessagePublic(BaseModel):
    id: uuid.UUID
    event_id: uuid.UUID
    author_name: str
    body: str
    occurrence_start: datetime | None
    recipient_count: int
    sent_count: int
    failed_count: int
    created_at: datetime
    completed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)
