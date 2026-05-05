import uuid

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

    def get_by_popup_id(
        self, session: Session, popup_id: uuid.UUID
    ) -> EventSettings | None:
        statement = select(EventSettings).where(EventSettings.popup_id == popup_id)
        return session.exec(statement).first()


event_settings_crud = EventSettingsCRUD()
