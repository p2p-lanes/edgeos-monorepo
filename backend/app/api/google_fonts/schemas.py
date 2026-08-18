"""Schemas for the Google Fonts catalog endpoint."""

from typing import Literal

from pydantic import BaseModel

FontCategory = Literal["sans-serif", "serif", "display", "handwriting", "monospace"]


class GoogleFont(BaseModel):
    """A single family, trimmed to what the picker actually renders.

    Google's payload carries a `files` map with one CDN URL per variant, which
    is ~80% of the response weight and useless to us — the portal loads fonts
    through the `css2` stylesheet endpoint, not the raw files.
    """

    family: str
    category: FontCategory
    variants: list[str]
    subsets: list[str]


class GoogleFontsCatalog(BaseModel):
    """Catalog response.

    `source` lets the backoffice tell a real catalog from the degraded one and
    surface a hint to the admin rather than silently offering 40 fonts when
    1800 were expected.
    """

    source: Literal["google", "fallback"]
    fonts: list[GoogleFont]
