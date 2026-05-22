"""Admin CRUD router for /third-party-apps.

All endpoints require CurrentAdmin (ADMIN or SUPERADMIN).

Tenant scoping:
  ADMIN — operates on their own tenant (enforced by RLS + explicit tenant_id check).
  SUPERADMIN — must supply X-Tenant-Id; the TenantSession dependency handles it.

Route ordering note:
  GET /available-scopes is declared BEFORE GET /{id} so FastAPI's path matching
  does not consume the literal string "available-scopes" as an {id} param.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError

from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, Paging
from app.api.third_party_app import crud
from app.api.third_party_app.schemas import (
    AvailableScopes,
    ThirdPartyAppCreate,
    ThirdPartyAppCreated,
    ThirdPartyAppPublic,
    ThirdPartyAppUpdate,
)
from app.core.dependencies.users import (
    CurrentAdmin,
    TenantSession,
)
from app.core.security import (
    THIRD_PARTY_API_KEY_SCOPES_MAX,
    THIRD_PARTY_TOKEN_SCOPES_MAX,
)

router = APIRouter(prefix="/third-party-apps", tags=["third-party-apps"])

_NAME_CONFLICT_MSG = "App name already in use for this tenant"
_REVOKED_EDIT_MSG = "Cannot edit a revoked app"
_REVOKED_ROTATE_MSG = "Cannot rotate a revoked app"


def _resolve_tenant_id(
    current_user: CurrentAdmin,
    x_tenant_id: str | None,
) -> uuid.UUID:
    """Resolve the effective tenant_id for the caller.

    ADMIN: uses their own tenant_id (ignores X-Tenant-Id).
    SUPERADMIN: uses X-Tenant-Id (required).
    """
    if current_user.role == UserRole.SUPERADMIN:
        if not x_tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="X-Tenant-Id header required for superadmin access",
            )
        try:
            return uuid.UUID(x_tenant_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid tenant ID format",
            )
    if not current_user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User has no tenant assigned",
        )
    return current_user.tenant_id


def _get_app_or_404(db, app_id: uuid.UUID, tenant_id: uuid.UUID):
    """Load app by id + tenant. Raises 404 on miss (no info leak).

    Plain function (not a FastAPI dependency) — no Annotated typing on db.
    """
    app = crud.get(db, app_id, tenant_id)
    if app is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="App not found",
        )
    return app


# ---------------------------------------------------------------------------
# IMPORTANT: /available-scopes MUST be declared before /{id}
# ---------------------------------------------------------------------------


@router.get("/available-scopes", response_model=AvailableScopes)
async def get_available_scopes(
    _current_user: CurrentAdmin,  # noqa: ARG001
) -> AvailableScopes:
    """Return the platform MAX scope constants.

    Used by the frontend create/edit modal to populate multi-select options.
    No tenant filtering — these are platform-wide constants.
    """
    return AvailableScopes(
        token_scopes=list(THIRD_PARTY_TOKEN_SCOPES_MAX),
        api_key_scopes=sorted(THIRD_PARTY_API_KEY_SCOPES_MAX),
    )


@router.post("", response_model=ThirdPartyAppCreated, status_code=status.HTTP_201_CREATED)
async def create_third_party_app(
    body: ThirdPartyAppCreate,
    db: TenantSession,
    current_user: CurrentAdmin,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> ThirdPartyAppCreated:
    """Create a new third-party app and return its raw key (shown once).

    The raw key is embedded in the response body. It is never stored and
    cannot be retrieved again — store it securely on first receipt.
    """
    tenant_id = _resolve_tenant_id(current_user, x_tenant_id)
    try:
        app, raw_key = crud.create(
            db,
            tenant_id=tenant_id,
            name=body.name.strip(),
            allowed_token_scopes=list(body.allowed_token_scopes),
            allowed_api_key_scopes=list(body.allowed_api_key_scopes),
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_NAME_CONFLICT_MSG,
        )
    return ThirdPartyAppCreated.model_validate({**app.model_dump(), "raw_key": raw_key})


@router.get("", response_model=ListModel[ThirdPartyAppPublic])
async def list_third_party_apps(
    db: TenantSession,
    current_user: CurrentAdmin,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> ListModel[ThirdPartyAppPublic]:
    """List all apps (active + revoked) for the caller's tenant."""
    tenant_id = _resolve_tenant_id(current_user, x_tenant_id)
    apps = crud.list_for_tenant(db, tenant_id)
    results = [ThirdPartyAppPublic.model_validate(a) for a in apps]
    return ListModel(
        results=results,
        paging=Paging(limit=len(results), offset=0, total=len(results)),
    )


@router.get("/{app_id}", response_model=ThirdPartyAppPublic)
async def get_third_party_app(
    app_id: uuid.UUID,
    db: TenantSession,
    current_user: CurrentAdmin,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> ThirdPartyAppPublic:
    """Get a single app by id. 404 if not found or outside caller's tenant."""
    tenant_id = _resolve_tenant_id(current_user, x_tenant_id)
    app = _get_app_or_404(db, app_id, tenant_id)
    return ThirdPartyAppPublic.model_validate(app)


@router.patch("/{app_id}", response_model=ThirdPartyAppPublic)
async def update_third_party_app(
    app_id: uuid.UUID,
    body: ThirdPartyAppUpdate,
    db: TenantSession,
    current_user: CurrentAdmin,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> ThirdPartyAppPublic:
    """Update name and/or scopes. Cannot edit a revoked app."""
    tenant_id = _resolve_tenant_id(current_user, x_tenant_id)
    app = _get_app_or_404(db, app_id, tenant_id)

    if app.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_REVOKED_EDIT_MSG,
        )

    try:
        app = crud.update(db, app, body)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_NAME_CONFLICT_MSG,
        )
    return ThirdPartyAppPublic.model_validate(app)


@router.post("/{app_id}/rotate", response_model=ThirdPartyAppCreated)
async def rotate_third_party_app(
    app_id: uuid.UUID,
    db: TenantSession,
    current_user: CurrentAdmin,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> ThirdPartyAppCreated:
    """Generate a new raw key for the app. The new key is returned once.

    Old key is immediately invalid. Cannot rotate a revoked app.
    """
    tenant_id = _resolve_tenant_id(current_user, x_tenant_id)
    app = _get_app_or_404(db, app_id, tenant_id)

    if app.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_REVOKED_ROTATE_MSG,
        )

    app, raw_key = crud.rotate_key(db, app)
    return ThirdPartyAppCreated.model_validate({**app.model_dump(), "raw_key": raw_key})


@router.delete("/{app_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def revoke_third_party_app(
    app_id: uuid.UUID,
    db: TenantSession,
    current_user: CurrentAdmin,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> Response:
    """Soft-revoke the app: set revoked_at = now(), active = False.

    The row is preserved for audit and in-flight JWT grace. 204 on success.
    """
    tenant_id = _resolve_tenant_id(current_user, x_tenant_id)
    app = _get_app_or_404(db, app_id, tenant_id)
    crud.soft_revoke(db, app)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
