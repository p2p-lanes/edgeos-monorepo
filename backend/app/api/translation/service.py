import uuid
from typing import Any

from sqlmodel import Session, select

from app.api.translation.models import Translations

TRANSLATABLE_FIELDS: dict[str, list[str]] = {
    "popup": ["name", "tagline", "location"],
    "product": ["name", "description"],
    "group": ["name", "description", "welcome_message"],
    "form_field": ["label", "placeholder", "help_text", "options"],
    "form_section": ["label", "description"],
    "ticketing_step": ["title", "description"],
}


def parse_accept_language(accept_language: str | None) -> str | None:
    """Extract the primary language subtag from an Accept-Language header.

    Returns the base subtag ("es-AR" -> "es") of the first listed language,
    or None when the header is absent or empty. This is default-agnostic on
    purpose: it never special-cases English. When the requested language
    matches the entity's default, the overlay lookup simply finds no rows and
    the untranslated source is returned.
    """
    if not accept_language:
        return None
    lang = accept_language.split(",")[0].split("-")[0].strip()
    return lang or None


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


def deep_merge_translation(source: Any, overlay: Any) -> Any:
    """Recursively overlay translated text over a source structure.

    Used for nested config such as a ticketing step's ``template_config``: the
    translation stores a partial mirror holding only the translated text
    leaves, and everything it omits (ids, prices, flags, icons) is preserved
    from the source. Dicts merge key-wise, lists merge element-wise by index,
    and a non-empty string leaf in the overlay replaces the source value.
    """
    if isinstance(source, dict) and isinstance(overlay, dict):
        merged = dict(source)
        for key, ov in overlay.items():
            merged[key] = deep_merge_translation(source.get(key), ov)
        return merged
    if isinstance(source, list) and isinstance(overlay, list):
        merged = list(source)
        for index, ov in enumerate(overlay):
            if index < len(merged):
                merged[index] = deep_merge_translation(merged[index], ov)
            else:
                merged.append(ov)
        return merged
    if isinstance(overlay, str):
        return overlay if overlay.strip() else source
    return source


def apply_ticketing_step_overlay(data: dict, translation: dict | None) -> dict:
    """Overlay a ticketing step's translated flat fields and nested config.

    Title/description use the flat overlay; ``template_config`` is deep-merged
    so translated labels replace their source text while non-text config is
    preserved. A no-op when ``translation`` is None.
    """
    if not translation:
        return data
    result = apply_translation_overlay(
        data, translation, TRANSLATABLE_FIELDS["ticketing_step"]
    )
    config_overlay = translation.get("template_config")
    source_config = result.get("template_config")
    if isinstance(config_overlay, dict) and isinstance(source_config, dict):
        result = dict(result)
        result["template_config"] = deep_merge_translation(
            source_config, config_overlay
        )
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
