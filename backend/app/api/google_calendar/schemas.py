from datetime import datetime

from pydantic import BaseModel


class GoogleAuthUrlResponse(BaseModel):
    url: str
    state: str


class GoogleConnectionStatus(BaseModel):
    configured: bool
    connected: bool
    calendar_id: str | None = None
    connected_at: datetime | None = None


class GoogleConnectionPublic(BaseModel):
    connected: bool
    calendar_id: str | None = None
