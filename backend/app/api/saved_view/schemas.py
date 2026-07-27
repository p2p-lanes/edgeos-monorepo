import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

# Lists that support saved views. Grows as more backoffice lists adopt them.
SAVED_VIEW_ENTITIES = frozenset({"applications"})

MAX_SAVED_VIEW_NAME_LENGTH = 100
MAX_SAVED_VIEW_CONFIG_CHARS = 10000


class SavedViewPublic(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    popup_id: uuid.UUID
    entity: str
    name: str
    config: dict
    created_by: uuid.UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SavedViewCreate(BaseModel):
    popup_id: uuid.UUID
    entity: str
    name: str
    config: dict


class SavedViewUpdate(BaseModel):
    name: str | None = None
    config: dict | None = None
