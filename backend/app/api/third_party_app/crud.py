"""CRUD helpers for ThirdPartyApps.

Slice 1 ships:
  validate_third_party_key — resolves (Tenants, ThirdPartyApps) from a raw key.
  touch_last_used          — bumps last_used_at on successful authenticate.

Slice 2 adds:
  get_for_authorization    — loads an active, non-revoked app by id for scope
                             enforcement at api-key minting and self-discovery.

Slice 3 adds:
  create                   — mint raw key, hash, persist row; returns (app, raw_key).
  list_for_tenant          — all rows (active + revoked) for a tenant.
  get                      — single row by id scoped to tenant.
  update                   — apply ThirdPartyAppUpdate fields.
  rotate_key               — replace key_hash + prefix; returns (app, new_raw_key).
  soft_revoke              — set revoked_at = now(), active = False.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.api.api_key.crud import hash_key as hash_api_key
from app.api.third_party_app.models import ThirdPartyApps

if TYPE_CHECKING:
    from app.api.tenant.models import Tenants
    from app.api.third_party_app.schemas import ThirdPartyAppUpdate

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


def get_for_authorization(
    session: Session,
    app_id: uuid.UUID,
) -> ThirdPartyApps | None:
    """Load an active, non-revoked ThirdPartyApps row by id.

    Used at api-key minting and self-discovery to enforce per-app scope
    subsets. Returns None when the app has been deleted or revoked after
    the JWT was minted — callers should treat None as a 401.
    """
    return session.exec(
        select(ThirdPartyApps).where(
            ThirdPartyApps.id == app_id,
            ThirdPartyApps.active.is_(True),
            ThirdPartyApps.revoked_at.is_(None),
        )
    ).first()


# ---------------------------------------------------------------------------
# Slice 3 — Admin CRUD helpers
# ---------------------------------------------------------------------------


def _generate_raw_key() -> str:
    """Mint a 32-byte URL-safe random key for a third-party app."""
    return secrets.token_urlsafe(32)


def create(
    session: Session,
    tenant_id: uuid.UUID,
    *,
    name: str,
    allowed_token_scopes: list[str],
    allowed_api_key_scopes: list[str],
) -> tuple[ThirdPartyApps, str]:
    """Mint a raw key, hash it, persist the app row.

    Returns (ThirdPartyApps row, raw_key). The raw key is shown once — the
    caller is responsible for returning it to the client; it is not stored.
    """
    raw_key = _generate_raw_key()
    key_hash = hash_api_key(raw_key)
    prefix = raw_key[:8]

    app = ThirdPartyApps(
        tenant_id=tenant_id,
        name=name,
        key_hash=key_hash,
        prefix=prefix,
        allowed_token_scopes=allowed_token_scopes,
        allowed_api_key_scopes=allowed_api_key_scopes,
    )
    session.add(app)
    session.commit()
    session.refresh(app)
    return app, raw_key


def list_for_tenant(session: Session, tenant_id: uuid.UUID) -> list[ThirdPartyApps]:
    """All rows (active + revoked) for the given tenant, newest first."""
    return list(
        session.exec(
            select(ThirdPartyApps)
            .where(ThirdPartyApps.tenant_id == tenant_id)
            .order_by(ThirdPartyApps.created_at.desc())
        ).all()
    )


def get(
    session: Session,
    app_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> ThirdPartyApps | None:
    """Single row by id scoped to tenant. Returns None when not found or wrong tenant."""
    return session.exec(
        select(ThirdPartyApps).where(
            ThirdPartyApps.id == app_id,
            ThirdPartyApps.tenant_id == tenant_id,
        )
    ).first()


def update(
    session: Session,
    app: ThirdPartyApps,
    data: ThirdPartyAppUpdate,
) -> ThirdPartyApps:
    """Apply ThirdPartyAppUpdate fields. Only provided (non-None) fields are changed."""
    if data.name is not None:
        app.name = data.name
    if data.allowed_token_scopes is not None:
        app.allowed_token_scopes = data.allowed_token_scopes
    if data.allowed_api_key_scopes is not None:
        app.allowed_api_key_scopes = data.allowed_api_key_scopes
    app.updated_at = datetime.now(UTC)
    session.add(app)
    session.commit()
    session.refresh(app)
    return app


def rotate_key(
    session: Session,
    app: ThirdPartyApps,
) -> tuple[ThirdPartyApps, str]:
    """Replace key_hash and prefix atomically. Returns (app, new_raw_key).

    The new raw key is shown once — old key is invalid immediately after.
    """
    raw_key = _generate_raw_key()
    app.key_hash = hash_api_key(raw_key)
    app.prefix = raw_key[:8]
    app.updated_at = datetime.now(UTC)
    session.add(app)
    session.commit()
    session.refresh(app)
    return app, raw_key


def soft_revoke(session: Session, app: ThirdPartyApps) -> None:
    """Soft-delete: set revoked_at = now() and active = False.

    Does NOT hard-delete the row — preserves audit trail and allows in-flight
    JWTs referencing issued_by_app_id to surface useful error messages.
    """
    app.revoked_at = datetime.now(UTC)
    app.active = False
    app.updated_at = datetime.now(UTC)
    session.add(app)
    session.commit()
