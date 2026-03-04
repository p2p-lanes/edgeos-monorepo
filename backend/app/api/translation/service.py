import uuid

from sqlmodel import Session, select

from app.api.translation.models import Translations

TRANSLATABLE_FIELDS: dict[str, list[str]] = {
    "popup": ["name", "tagline", "location"],
    "product": ["name", "description"],
    "group": ["name", "description", "welcome_message"],
    "form_field": ["label", "placeholder", "help_text", "options"],
    "form_section": ["label", "description"],
}


def get_translations_for_entity(
    session: Session,
    entity_type: str,
    entity_id: uuid.UUID,
    language: str,
) -> dict | None:
    """Fetch translation data for a single entity+language."""
    statement = select(Translations).where(
        Translations.entity_type == entity_type,
        Translations.entity_id == entity_id,
        Translations.language == language,
    )
    translation = session.exec(statement).first()
    return translation.data if translation else None


def get_translations_bulk(
    session: Session,
    entity_type: str,
    entity_ids: list[uuid.UUID],
    language: str,
) -> dict[uuid.UUID, dict]:
    """Fetch translations for multiple entities of the same type."""
    if not entity_ids:
        return {}

    statement = select(Translations).where(
        Translations.entity_type == entity_type,
        Translations.entity_id.in_(entity_ids),  # type: ignore[union-attr]
        Translations.language == language,
    )
    results = session.exec(statement).all()
    return {t.entity_id: t.data for t in results}


def apply_translation_overlay(
    data: dict,
    translation: dict | None,
    translatable_fields: list[str],
) -> dict:
    """Overlay translated fields onto entity data."""
    if not translation:
        return data
    result = dict(data)
    for field in translatable_fields:
        if field in translation:
            result[field] = translation[field]
    return result


def delete_translations_for_entity(
    session: Session,
    entity_type: str,
    entity_id: uuid.UUID,
) -> int:
    """Delete all translations for an entity. Returns count deleted."""
    statement = select(Translations).where(
        Translations.entity_type == entity_type,
        Translations.entity_id == entity_id,
    )
    translations = list(session.exec(statement).all())
    count = len(translations)
    for t in translations:
        session.delete(t)
    return count
