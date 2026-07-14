import json

from fastapi import HTTPException
from google import genai

from app.core.config import settings

# Stable (GA) flash model: production rate limits, unlike the preview variants
# whose separate, tighter quotas were causing 429s. Swap to a *-flash-lite id
# for higher throughput at a small quality cost.
TRANSLATION_MODEL = "gemini-3.5-flash"

LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "es": "Spanish (Latin America)",
    "zh": "Simplified Chinese",
    "is": "Icelandic",
}


def _map_translation_response(
    raw_map: dict, real_by_token: dict[str, str]
) -> dict[str, str]:
    """Map opaque-token keys from the model response back to real field keys.

    Only string values for known tokens are kept, so a malformed or partial
    response degrades gracefully instead of leaking tokens or nested objects.
    """
    return {
        real_by_token[token]: value
        for token, value in raw_map.items()
        if token in real_by_token and isinstance(value, str)
    }


def _field_hint(key: str) -> str:
    """Human-readable context for a field key, used to guide the model.

    Numeric path indices are dropped ("sections.0.label" -> "sections label",
    "insurance.card_title" -> "insurance card title"), giving tone/register
    context without exposing the opaque-token scheme.
    """
    segments = [seg for seg in key.split(".") if not seg.isdigit()]
    return " ".join(segments).replace("_", " ")


async def translate_fields(
    fields: dict[str, str],
    target_language: str,
    entity_type: str,
) -> dict[str, str]:
    """Translate entity fields using Gemini. Returns a dict of field_name→translated_value.

    Field keys can be nested config paths ("sections.0.label"). Those are mapped
    to opaque tokens ("t0", "t1", ...) before hitting the model so it cannot
    "helpfully" restructure a dotted key into nested JSON, which would otherwise
    drop the field on the way back. Tokens are mapped back to real keys after.
    """
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=400, detail="GEMINI_API_KEY is not configured")

    lang_name = LANGUAGE_NAMES.get(target_language, target_language)

    ordered = [(key, value) for key, value in fields.items() if value and value.strip()]
    if not ordered:
        return {}

    real_by_token = {f"t{i}": key for i, (key, _) in enumerate(ordered)}
    fields_text = "\n".join(
        f"- t{i} ({_field_hint(key)}): {value}"
        for i, (key, value) in enumerate(ordered)
    )

    prompt = (
        f"You are a professional translator for an event management platform. "
        f"Translate the following {entity_type} field values to {lang_name}.\n\n"
        f"Each line has the form `- <key> (<field context>): <text to translate>`. "
        f"The context in parentheses tells you what the field is, to help you "
        f"choose the right tone and register; it is not part of the text.\n\n"
        f"Fields to translate:\n{fields_text}\n\n"
        f"Rules:\n"
        f"- Return ONLY a valid JSON object mapping each key to its translated value.\n"
        f"- Use the exact same keys (t0, t1, ...) as given. Do NOT nest or rename them.\n"
        f"- Translate only the text values, never the keys or the context hints.\n"
        f"- Preserve any HTML tags, URLs, emojis, or special formatting.\n"
        f"- Use natural, culturally appropriate language (not literal word-for-word).\n"
        f"- Do NOT add any explanation or markdown formatting.\n"
    )

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    response = await client.aio.models.generate_content(
        model=TRANSLATION_MODEL,
        contents=prompt,
    )
    if not response.text:
        raise HTTPException(status_code=500, detail="No response from Gemini")

    raw = response.text.strip()
    # Strip markdown code fence if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3].strip()

    return _map_translation_response(json.loads(raw), real_by_token)
