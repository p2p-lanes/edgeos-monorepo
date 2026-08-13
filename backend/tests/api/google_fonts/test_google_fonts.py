"""Google Fonts catalog endpoint.

Covers the three ways this endpoint can produce a payload — Redis cache, live
Google fetch, curated fallback — plus the trimming that keeps the response
from being a megabyte, and the auth gate.

Every test patches Redis so it never depends on a live cache: without that,
the first test to populate `google_fonts:catalog:v1` would silently change the
outcome of the others.
"""

import json
from unittest.mock import MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api.google_fonts.router import FALLBACK_FONTS, _trim
from app.core.config import settings

CATALOG_URL = "/api/v1/google-fonts"

# A Google response entry, complete with the fields we drop.
GOOGLE_ITEM = {
    "family": "Inter",
    "category": "sans-serif",
    "variants": ["regular", "700"],
    "subsets": ["latin", "cyrillic"],
    "version": "v18",
    "lastModified": "2024-09-04",
    "files": {"regular": "https://fonts.gstatic.com/s/inter/v18/regular.woff2"},
    "menu": "https://fonts.gstatic.com/s/inter/v18/menu.woff2",
    "kind": "webfonts#webfont",
}


def _auth(superadmin_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {superadmin_token}"}


def _no_redis():
    """Patch get_redis to None in both places the router reaches for it."""
    return patch("app.api.google_fonts.router.get_redis", return_value=None)


def _google_response(items: list[dict]) -> MagicMock:
    response = MagicMock()
    response.json.return_value = {"items": items}
    response.raise_for_status.return_value = None
    return response


def _patch_httpx(response_or_exc):
    """Patch the AsyncClient used by the router.

    `httpx.AsyncClient` is used as an async context manager, so the mock has
    to satisfy `__aenter__` rather than being a plain return value.
    """
    client = MagicMock()
    if isinstance(response_or_exc, Exception):

        async def _get(*_args, **_kwargs):
            raise response_or_exc
    else:

        async def _get(*_args, **_kwargs):
            return response_or_exc

    client.get = _get

    async def _aenter(_self):
        return client

    async def _aexit(_self, *_args):
        return False

    ctx = MagicMock()
    ctx.__aenter__ = _aenter
    ctx.__aexit__ = _aexit
    return patch("app.api.google_fonts.router.httpx.AsyncClient", return_value=ctx)


# ---------------------------------------------------------------------------
# Trimming
# ---------------------------------------------------------------------------


def test_trim_drops_the_heavy_fields():
    """`files`/`menu`/`version` are ~80% of the payload and go unused."""
    [trimmed] = _trim([GOOGLE_ITEM])

    assert trimmed == {
        "family": "Inter",
        "category": "sans-serif",
        "variants": ["regular", "700"],
        "subsets": ["latin", "cyrillic"],
    }


def test_trim_skips_families_with_an_unmodelled_category():
    """One odd family must not 500 the whole catalog."""
    odd = {**GOOGLE_ITEM, "family": "Weird", "category": "not-a-category"}

    trimmed = _trim([odd, GOOGLE_ITEM])

    assert [font["family"] for font in trimmed] == ["Inter"]


def test_trim_defaults_missing_variants_and_subsets():
    """Both fields are non-optional in the schema, so a sparse entry would
    otherwise 500 the whole catalog on validation."""
    bare = {"family": "Inter", "category": "serif"}

    [trimmed] = _trim([bare])

    assert trimmed["variants"] == ["regular"]
    assert trimmed["subsets"] == ["latin"]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


def test_requires_authentication(client: TestClient):
    response = client.get(CATALOG_URL)

    assert response.status_code in (401, 403)


def test_serves_the_cache_without_calling_google(
    client: TestClient, superadmin_token: str
):
    cached = [
        {
            "family": "Cached Sans",
            "category": "sans-serif",
            "variants": ["regular"],
            "subsets": ["latin"],
        }
    ]
    redis = MagicMock()
    redis.get.return_value = json.dumps(cached)

    with (
        patch("app.api.google_fonts.router.get_redis", return_value=redis),
        _patch_httpx(AssertionError("Google must not be called on a cache hit")),
    ):
        response = client.get(CATALOG_URL, headers=_auth(superadmin_token))

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "google"
    assert [font["family"] for font in body["fonts"]] == ["Cached Sans"]


def test_fetches_from_google_and_writes_the_cache(
    client: TestClient, superadmin_token: str
):
    redis = MagicMock()
    redis.get.return_value = None

    with (
        patch("app.api.google_fonts.router.get_redis", return_value=redis),
        patch.object(
            settings,
            "GOOGLE_FONTS_API_KEY",
            "test-key",
        ),
        _patch_httpx(_google_response([GOOGLE_ITEM])),
    ):
        response = client.get(CATALOG_URL, headers=_auth(superadmin_token))

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "google"
    assert body["fonts"] == [
        {
            "family": "Inter",
            "category": "sans-serif",
            "variants": ["regular", "700"],
            "subsets": ["latin", "cyrillic"],
        }
    ]

    # Cached trimmed, not raw — otherwise the saving is only on the wire.
    redis.setex.assert_called_once()
    key, ttl, payload = redis.setex.call_args.args
    assert key == "google_fonts:catalog:v1"
    assert ttl == 60 * 60 * 24
    assert "files" not in json.loads(payload)[0]


def test_falls_back_when_the_api_key_is_missing(
    client: TestClient, superadmin_token: str
):
    """No key configured must still give the admin a usable picker."""
    with (
        _no_redis(),
        patch.object(
            settings,
            "GOOGLE_FONTS_API_KEY",
            None,
        ),
    ):
        response = client.get(CATALOG_URL, headers=_auth(superadmin_token))

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "fallback"
    assert len(body["fonts"]) == len(FALLBACK_FONTS)


@pytest.mark.parametrize(
    "failure",
    [
        httpx.ConnectError("boom"),
        httpx.ReadTimeout("slow"),
    ],
    ids=["connect-error", "timeout"],
)
def test_falls_back_when_google_fails(
    client: TestClient, superadmin_token: str, failure: Exception
):
    with (
        _no_redis(),
        patch.object(
            settings,
            "GOOGLE_FONTS_API_KEY",
            "test-key",
        ),
        _patch_httpx(failure),
    ):
        response = client.get(CATALOG_URL, headers=_auth(superadmin_token))

    assert response.status_code == 200
    assert response.json()["source"] == "fallback"


def test_falls_back_when_google_returns_no_items(
    client: TestClient, superadmin_token: str
):
    with (
        _no_redis(),
        patch.object(
            settings,
            "GOOGLE_FONTS_API_KEY",
            "test-key",
        ),
        _patch_httpx(_google_response([])),
    ):
        response = client.get(CATALOG_URL, headers=_auth(superadmin_token))

    assert response.status_code == 200
    assert response.json()["source"] == "fallback"


def test_fallback_entries_are_valid_catalog_rows(
    client: TestClient, superadmin_token: str
):
    """The curated list must survive the same schema as the live catalog.

    It is hand-maintained, so a typo in a category would otherwise only show
    up in production the day Google goes down.
    """
    with (
        _no_redis(),
        patch.object(
            settings,
            "GOOGLE_FONTS_API_KEY",
            None,
        ),
    ):
        response = client.get(CATALOG_URL, headers=_auth(superadmin_token))

    fonts = response.json()["fonts"]
    assert all(font["variants"] for font in fonts)
    assert all(font["subsets"] for font in fonts)
    # Families are the cache key for the portal's css2 URL — duplicates would
    # mean the picker shows the same option twice.
    families = [font["family"] for font in fonts]
    assert len(families) == len(set(families))
