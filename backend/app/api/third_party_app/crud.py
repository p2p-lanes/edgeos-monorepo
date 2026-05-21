"""CRUD helpers for ThirdPartyApps.

Slice 1 ships:
  validate_third_party_key — resolves (Tenants, ThirdPartyApps) from a raw key.
  touch_last_used          — bumps last_used_at on successful authenticate.

Full admin CRUD (create, list, patch, rotate, soft_delete) ships in slice 3.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.api.api_key.crud import hash_key as hash_api_key
from app.api.third_party_app.models import ThirdPartyApps

if TYPE_CHECKING:
    from app.api.tenant.models import Tenants

_INVALID_CREDENTIALS = "Invalid third-party credentials"


def validate_third_party_key(
    session: Session,
    raw_key: str,
) -> tuple[Tenants, ThirdPartyApps]:
    """Resolve (tenant, app) from a third-party raw key.

    Single-401 contract: callers cannot distinguish unknown key, revoked app,
    inactive app, or missing tenant from each other.
    """
    from app.api.tenant.models import Tenants

    key_hash = hash_api_key(raw_key)

    app = session.exec(
        select(ThirdPartyApps).where(
            ThirdPartyApps.key_hash == key_hash,
            ThirdPartyApps.active.is_(True),
            ThirdPartyApps.revoked_at.is_(None),
        )
    ).first()

    if app is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_INVALID_CREDENTIALS,
        )

    # Defensive constant-time compare on the hash (timing parity with v1).
    if not secrets.compare_digest(key_hash, app.key_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_INVALID_CREDENTIALS,
        )

    tenant = session.get(Tenants, app.tenant_id)
    if tenant is None or tenant.deleted:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_INVALID_CREDENTIALS,
        )

    return tenant, app


def touch_last_used(session: Session, app: ThirdPartyApps) -> None:
    """Bump last_used_at to now. Call only on successful authenticate, not login."""
    app.last_used_at = datetime.now(UTC)
    session.add(app)
    session.commit()
