import uuid
from datetime import UTC, datetime

from sqlmodel import Session, select

from app.api.translation.models import Translations
from app.api.translation.schemas import TranslationCreate, TranslationUpdate
from app.api.shared.crud import BaseCRUD


class TranslationsCRUD(BaseCRUD[Translations, TranslationCreate, TranslationUpdate]):
    def __init__(self) -> None:
        super().__init__(Translations)

    def find_by_entity(
        self,
        session: Session,
        entity_type: str,
        entity_id: uuid.UUID,
    ) -> list[Translations]:
        statement = select(Translations).where(
            Translations.entity_type == entity_type,
            Translations.entity_id == entity_id,
        )
        return list(session.exec(statement).all())

    def upsert(
        self,
        session: Session,
        tenant_id: uuid.UUID,
        obj_in: TranslationCreate,
    ) -> Translations:
        """Create or update a translation."""
        statement = select(Translations).where(
            Translations.tenant_id == tenant_id,
            Translations.entity_type == obj_in.entity_type,
            Translations.entity_id == obj_in.entity_id,
            Translations.language == obj_in.language,
        )
        existing = session.exec(statement).first()

        if existing:
            existing.data = obj_in.data
            existing.updated_at = datetime.now(UTC)
            session.add(existing)
            session.commit()
            session.refresh(existing)
            return existing

        db_obj = Translations(
            tenant_id=tenant_id,
            entity_type=obj_in.entity_type,
            entity_id=obj_in.entity_id,
            language=obj_in.language,
            data=obj_in.data,
        )
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj


translations_crud = TranslationsCRUD()
