import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlmodel import Session, select

from app.api.event_settings.models import EventSettings
from app.api.event_settings.schemas import EventSettingsCreate, EventSettingsUpdate
from app.api.shared.crud import BaseCRUD


class EventSettingsCRUD(
    BaseCRUD[EventSettings, EventSettingsCreate, EventSettingsUpdate]
):
    """CRUD operations for EventSettings."""

    def __init__(self) -> None:
        super().__init__(EventSettings)

    def create_for_popup(
        self, session: Session, *, popup_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> EventSettings:
        """Seed a new popup's settings; the popup creation transaction commits."""
        settings = EventSettings(popup_id=popup_id, tenant_id=tenant_id)
        session.add(settings)
        session.flush()
        return settings

    def get_by_popup_id(
        self, session: Session, popup_id: uuid.UUID
    ) -> EventSettings | None:
        statement = select(EventSettings).where(EventSettings.popup_id == popup_id)
        return session.exec(statement).first()

    def get_popup_timezone(self, session: Session, popup_id: uuid.UUID) -> str:
        """Return the popup's configured time zone, with UTC as fallback."""
        settings = self.get_by_popup_id(session, popup_id)
        if settings and settings.timezone:
            try:
                ZoneInfo(settings.timezone)
                return settings.timezone
            except (ZoneInfoNotFoundError, ValueError):
                pass
        return "UTC"


event_settings_crud = EventSettingsCRUD()
