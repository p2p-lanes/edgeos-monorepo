"""Schemas for /me/access endpoints."""

from __future__ import annotations

from pydantic import BaseModel


class MeAccess(BaseModel):
    """Response shape for GET /me/access."""

    app_name: str
    scopes: list[str]
    api_key_scopes: list[str]
