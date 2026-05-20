"""Admin API key CRUD — thin wrappers around app.api.api_key.crud.

Both modules share the underlying ApiKeys table and the primitives
(hash_key, generate_raw_key, display_prefix). This module keeps the
admin-specific DB operations local to the admin_api_key package so
each router's policy stays self-contained.
"""

import uuid
from datetime import datetime

from sqlmodel import Session

from app.api.api_key import crud as _base
from app.api.api_key.models import ApiKeys


def create(
    session: Session,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    name: str,
    expires_at: datetime | None,
    scopes: list[str],
) -> tuple[ApiKeys, str]:
    """Mint and persist an admin-owned key. Returns (row, raw_token)."""
    return _base.create_for_user(
        session,
        tenant_id=tenant_id,
        user_id=user_id,
        name=name,
        expires_at=expires_at,
        scopes=scopes,
    )


def list_own(session: Session, user_id: uuid.UUID) -> list[ApiKeys]:
    """All keys for the given admin user (own keys only)."""
    return _base.list_for_user(session, user_id)


def list_all(session: Session) -> list[ApiKeys]:
    """All admin keys visible on the session (SUPERADMIN path, relies on RLS)."""
    return _base.list_all_admin_keys(session)


def get_own(
    session: Session, key_id: uuid.UUID, user_id: uuid.UUID
) -> ApiKeys | None:
    """Fetch a key by id, scoped to the given user. None if not found/not owned."""
    return _base.get_for_user(session, key_id, user_id)


def get_any(session: Session, key_id: uuid.UUID) -> ApiKeys | None:
    """Fetch any admin key by id on the session (SUPERADMIN path, relies on RLS)."""
    return _base.get_any_admin_key(session, key_id)


def revoke(session: Session, row: ApiKeys) -> ApiKeys:
    """Soft-revoke: set revoked_at. Idempotent if already revoked."""
    return _base.revoke(session, row)
