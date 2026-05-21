"""Admin API keys router — /backoffice/api-keys.

Guards:
  - All endpoints require CurrentAdmin (role >= ADMIN; VIEWER → 403).
  - API-key authenticated callers are rejected (_require_jwt): an admin key
    cannot mint or manage other admin keys (same argument as portal api_key/).

Visibility (REQ-BA-03):
  - ADMIN sees only their own keys (user_id == caller.id).
  - SUPERADMIN sees all admin keys in the tenant they target via X-Tenant-Id.

Revocation (REQ-OW-05, REQ-BA-05):
  - ADMIN may only revoke their own keys (403 otherwise).
  - SUPERADMIN may revoke any admin key in their tenant scope.

Scope validation (REQ-AK-06):
  - Requested scopes must be a subset of ADMIN_API_KEY_SCOPES → 422 if not.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.api.admin_api_key import crud
from app.api.admin_api_key.schemas import (
    AdminApiKeyCreate,
    AdminApiKeyCreated,
    AdminApiKeyPublic,
)
from app.api.shared.enums import UserRole
from app.core.dependencies.users import (
    CurrentAdmin,
    TenantSession,
)
from app.core.security import ADMIN_API_KEY_SCOPES, TokenPayload, get_token_payload

router = APIRouter(prefix="/backoffice/api-keys", tags=["admin-api-keys"])


def _require_jwt(
    token_payload: Annotated[TokenPayload, Depends(get_token_payload)],
) -> None:
    """Reject callers authenticated via API key.

    Admin API keys cannot mint or manage other admin API keys — an attacker
    with a leaked key must not be able to bootstrap permanent access.
    Administrators must use their JWT session for key lifecycle operations.
    """
    if getattr(token_payload, "via_api_key", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API keys cannot manage other API keys; sign in to the backoffice.",
        )


JwtOnly = Annotated[None, Depends(_require_jwt)]


@router.post("", response_model=AdminApiKeyCreated, status_code=status.HTTP_201_CREATED)
async def create_admin_api_key(
    payload: AdminApiKeyCreate,
    db: TenantSession,
    current_user: CurrentAdmin,
    _: JwtOnly,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> AdminApiKeyCreated:
    """Mint a new admin API key.

    Scopes must be a subset of ADMIN_API_KEY_SCOPES. Any scope outside that
    universe returns 422. Write scopes require an expiry date (validated by
    the schema).

    The cleartext key is returned once in ``raw_key``; only the hash is stored.
    """
    # Resolve tenant_id: ADMIN uses their own; SUPERADMIN must supply X-Tenant-Id.
    if current_user.role == UserRole.SUPERADMIN:
        if not x_tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="X-Tenant-Id header required for superadmin access",
            )
        try:
            tenant_id = uuid.UUID(x_tenant_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid tenant ID format",
            )
    else:
        if not current_user.tenant_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User has no tenant assigned",
            )
        tenant_id = current_user.tenant_id

    # Second wall: scope universe check (REQ-AK-06).
    invalid = set(payload.scopes) - ADMIN_API_KEY_SCOPES
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Scopes not permitted for admin API keys: {sorted(invalid)}",
        )

    row, raw = crud.create(
        db,
        tenant_id=tenant_id,
        user_id=current_user.id,
        name=payload.name.strip(),
        expires_at=payload.expires_at,
        scopes=payload.scopes,
    )
    return AdminApiKeyCreated.model_validate({**row.model_dump(), "raw_key": raw})


@router.get("", response_model=list[AdminApiKeyPublic])
async def list_admin_api_keys(
    db: TenantSession,
    current_user: CurrentAdmin,
    _: JwtOnly,
) -> list[AdminApiKeyPublic]:
    """List admin API keys.

    ADMIN sees only their own keys.
    SUPERADMIN sees all admin keys in the tenant they are operating on (via
    X-Tenant-Id header, already resolved by TenantSession).
    """
    if current_user.role == UserRole.SUPERADMIN:
        rows = crud.list_all(db)
    else:
        rows = crud.list_own(db, current_user.id)
    return [AdminApiKeyPublic.model_validate(r) for r in rows]


@router.get("/{key_id}", response_model=AdminApiKeyPublic)
async def get_admin_api_key(
    key_id: uuid.UUID,
    db: TenantSession,
    current_user: CurrentAdmin,
    _: JwtOnly,
) -> AdminApiKeyPublic:
    """Retrieve a specific admin API key.

    Visibility mirrors the list endpoint: ADMIN sees only own keys; SUPERADMIN
    sees any admin key in the tenant. Returns 404 for keys outside the caller's
    visibility — never 403, to avoid leaking existence of foreign keys.
    """
    if current_user.role == UserRole.SUPERADMIN:
        row = crud.get_any(db, key_id)
    else:
        row = crud.get_own(db, key_id, current_user.id)

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API key not found",
        )
    return AdminApiKeyPublic.model_validate(row)


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_admin_api_key(
    key_id: uuid.UUID,
    db: TenantSession,
    current_user: CurrentAdmin,
    _: JwtOnly,
) -> None:
    """Revoke an admin API key by setting revoked_at.

    ADMIN can only revoke their own keys (403 for foreign keys).
    SUPERADMIN can revoke any admin key in their tenant scope.
    Non-existent keys return 404.
    """
    if current_user.role == UserRole.SUPERADMIN:
        row = crud.get_any(db, key_id)
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="API key not found",
            )
    else:
        # Look up any admin key with this id to distinguish 404 vs 403.
        from sqlmodel import select

        from app.api.api_key.models import ApiKeys

        any_row = db.exec(
            select(ApiKeys)
            .where(ApiKeys.id == key_id)
            .where(ApiKeys.user_id.is_not(None))
        ).first()

        if not any_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="API key not found",
            )
        if any_row.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only revoke your own API keys",
            )
        row = any_row

    crud.revoke(db, row)
