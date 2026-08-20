"""Google Fonts catalog router.

Proxies the Google Fonts Developer API so the API key stays server-side and the
~1MB catalog is fetched once a day instead of once per admin who opens the
theme editor.
"""

import json

import httpx
from fastapi import APIRouter
from loguru import logger
from redis import RedisError

from app.api.google_fonts.schemas import GoogleFont, GoogleFontsCatalog
from app.core.config import settings
from app.core.dependencies.users import CurrentUser
from app.core.redis import get_redis

router = APIRouter(prefix="/google-fonts", tags=["google-fonts"])

GOOGLE_FONTS_URL = "https://www.googleapis.com/webfonts/v1/webfonts"
CACHE_KEY = "google_fonts:catalog:v1"
CACHE_TTL_SECONDS = 60 * 60 * 24  # The catalog changes a few times a year.
REQUEST_TIMEOUT_SECONDS = 10.0

VALID_CATEGORIES = {
    "sans-serif",
    "serif",
    "display",
    "handwriting",
    "monospace",
}

# Served when the API key is missing or Google is unreachable. `variants` here
# is informational only — the portal always asks `css2` for 400;500;600;700 and
# Google silently clamps to what the family publishes (verified: Amarante, a
# regular-only family, returns 200 and serves just 400). So an inaccurate entry
# degrades the picker's metadata, never the stylesheet.
FALLBACK_FONTS: list[dict] = [
    {"family": f, "category": c, "variants": v, "subsets": ["latin"]}
    for f, c, v in [
        ("Inter", "sans-serif", ["regular", "500", "600", "700"]),
        ("Roboto", "sans-serif", ["regular", "500", "700"]),
        ("Open Sans", "sans-serif", ["regular", "500", "600", "700"]),
        ("Lato", "sans-serif", ["regular", "700"]),
        ("Montserrat", "sans-serif", ["regular", "500", "600", "700"]),
        ("Poppins", "sans-serif", ["regular", "500", "600", "700"]),
        ("Raleway", "sans-serif", ["regular", "500", "600", "700"]),
        ("Nunito", "sans-serif", ["regular", "500", "600", "700"]),
        ("Nunito Sans", "sans-serif", ["regular", "600", "700"]),
        ("Work Sans", "sans-serif", ["regular", "500", "600", "700"]),
        ("Rubik", "sans-serif", ["regular", "500", "600", "700"]),
        ("Karla", "sans-serif", ["regular", "500", "600", "700"]),
        ("Manrope", "sans-serif", ["regular", "500", "600", "700"]),
        ("DM Sans", "sans-serif", ["regular", "500", "700"]),
        ("Figtree", "sans-serif", ["regular", "500", "600", "700"]),
        ("Outfit", "sans-serif", ["regular", "500", "600", "700"]),
        ("Plus Jakarta Sans", "sans-serif", ["regular", "500", "600", "700"]),
        ("Space Grotesk", "sans-serif", ["regular", "500", "600", "700"]),
        ("Playfair Display", "serif", ["regular", "500", "600", "700"]),
        ("Merriweather", "serif", ["regular", "700"]),
        ("Lora", "serif", ["regular", "500", "600", "700"]),
        ("Libre Baskerville", "serif", ["regular", "700"]),
        ("EB Garamond", "serif", ["regular", "500", "600", "700"]),
        ("Cormorant Garamond", "serif", ["regular", "500", "600", "700"]),
        ("Bitter", "serif", ["regular", "500", "600", "700"]),
        ("Oswald", "sans-serif", ["regular", "500", "600", "700"]),
        ("Bebas Neue", "display", ["regular"]),
        ("Anton", "display", ["regular"]),
        ("Abril Fatface", "display", ["regular"]),
        ("Dancing Script", "handwriting", ["regular", "500", "600", "700"]),
        ("Pacifico", "handwriting", ["regular"]),
        ("Caveat", "handwriting", ["regular", "500", "600", "700"]),
        ("JetBrains Mono", "monospace", ["regular", "500", "600", "700"]),
        ("IBM Plex Mono", "monospace", ["regular", "500", "600", "700"]),
        ("Space Mono", "monospace", ["regular", "700"]),
        ("Source Code Pro", "monospace", ["regular", "500", "600", "700"]),
    ]
]


def _trim(items: list[dict]) -> list[dict]:
    """Drop everything the picker doesn't render.

    Google's entries carry a `files` map (one CDN URL per variant) plus
    `version`, `lastModified`, `menu` and `kind`. Keeping only four fields
    takes the response from ~1MB to ~150KB, which matters because this crosses
    the wire to every admin who opens the theme editor.
    """
    trimmed: list[dict] = []
    for item in items:
        family = item.get("family")
        category = item.get("category")
        # Google occasionally ships a category we don't model. Skipping is
        # better than 500ing the whole catalog on one unexpected family.
        if not family or category not in VALID_CATEGORIES:
            continue
        trimmed.append(
            {
                "family": family,
                "category": category,
                "variants": item.get("variants") or ["regular"],
                "subsets": item.get("subsets") or ["latin"],
            }
        )
    return trimmed


async def _fetch_from_google() -> list[dict] | None:
    """Fetch and trim the live catalog. Returns None on any failure."""
    if not settings.GOOGLE_FONTS_API_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.get(
                GOOGLE_FONTS_URL,
                params={
                    "key": settings.GOOGLE_FONTS_API_KEY,
                    # WOFF2 is the only format the portal loads, and sorting by
                    # popularity means the picker's default order is useful
                    # before the admin types anything.
                    "capability": "WOFF2",
                    "sort": "popularity",
                },
            )
            response.raise_for_status()
            items = response.json().get("items")
    except (httpx.HTTPError, ValueError) as exc:
        # Never surface the exception text: it can echo back the API key that
        # was in the request URL.
        logger.warning(f"Google Fonts catalog fetch failed: {type(exc).__name__}")
        return None

    if not isinstance(items, list) or not items:
        logger.warning("Google Fonts catalog returned no items")
        return None
    return _trim(items)


def _read_cache() -> list[dict] | None:
    client = get_redis()
    if client is None:
        return None
    try:
        cached = client.get(CACHE_KEY)
    except RedisError as exc:
        logger.warning(f"Redis read failed for the fonts catalog: {exc}")
        return None
    if not cached:
        return None
    try:
        parsed = json.loads(cached)  # type: ignore[arg-type]
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, list) and parsed else None


def _write_cache(fonts: list[dict]) -> None:
    client = get_redis()
    if client is None:
        return
    try:
        client.setex(CACHE_KEY, CACHE_TTL_SECONDS, json.dumps(fonts))
    except RedisError as exc:
        logger.warning(f"Redis write failed for the fonts catalog: {exc}")


@router.get("", response_model=GoogleFontsCatalog)
async def list_google_fonts(_: CurrentUser) -> GoogleFontsCatalog:
    """Return the Google Fonts catalog for the backoffice font picker.

    Degrades instead of failing: a missing API key, a Google outage or a Redis
    outage each fall through to a small curated list, so the picker is never
    empty. The `source` field tells the caller which one it got.
    """
    cached = _read_cache()
    if cached is not None:
        return GoogleFontsCatalog(
            source="google",
            fonts=[GoogleFont(**font) for font in cached],
        )

    fonts = await _fetch_from_google()
    if fonts:
        _write_cache(fonts)
        return GoogleFontsCatalog(
            source="google",
            fonts=[GoogleFont(**font) for font in fonts],
        )

    return GoogleFontsCatalog(
        source="fallback",
        fonts=[GoogleFont(**font) for font in FALLBACK_FONTS],
    )
