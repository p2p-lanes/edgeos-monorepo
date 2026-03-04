import json

from fastapi import HTTPException
from google import genai

from app.core.config import settings

LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "es": "Spanish (Latin America)",
    "zh": "Simplified Chinese",
}


async def translate_fields(
    fields: dict[str, str],
    target_language: str,
    entity_type: str,
) -> dict[str, str]:
    """Translate entity fields using Gemini. Returns a dict of field_name→translated_value."""
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=400, detail="GEMINI_API_KEY is not configured")

    lang_name = LANGUAGE_NAMES.get(target_language, target_language)

    fields_text = "\n".join(
        f"- {key}: {value}" for key, value in fields.items() if value
    )
    if not fields_text:
        return {}

    prompt = (
        f"You are a professional translator for an event management platform. "
        f"Translate the following {entity_type} fields to {lang_name}.\n\n"
        f"Fields to translate:\n{fields_text}\n\n"
        f"Rules:\n"
        f"- Return ONLY a valid JSON object mapping field names to translated values.\n"
        f"- Keep the same field names (keys) in English.\n"
        f"- Preserve any HTML tags, URLs, or special formatting.\n"
        f"- Use natural, culturally appropriate language (not literal word-for-word).\n"
        f"- Do NOT add any explanation or markdown formatting.\n"
    )

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    response = await client.aio.models.generate_content(
        model="gemini-3-flash-preview",
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

    return json.loads(raw)
