"""Admin management of per-TENANT publishable keys.

Guards mirror admin_api_key/: admin-only (VIEWER -> 403), enforced at the router
level. Keys are minted for the admin's own tenant (a SUPERADMIN targets a tenant
via the X-Tenant-Id header, same as every other backoffice write). The
tenant-scoped RLS session ensures an admin can only list/revoke keys in their
own tenant. Keys are tenant-wide: the checkout URL slug picks the popup.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlmodel import select

from app.api.publishable_key import crud
from app.api.publishable_key.models import PopupPublishableKeys
from app.api.publishable_key.schemas import (
    PublishableKeyCreate,
    PublishableKeyCreated,
    PublishableKeyPublic,
)
from app.api.shared.enums import UserRole
from app.core.dependencies.users import CurrentAdmin, TenantSession, get_admin

router = APIRouter(tags=["publishable-keys"], dependencies=[Depends(get_admin)])

_XTenantId = Annotated[str | None, Header(alias="X-Tenant-Id")]


def _effective_tenant_id(
    current_user: CurrentAdmin, x_tenant_id: str | None
) -> uuid.UUID:
    """The tenant a write targets: X-Tenant-Id for a SUPERADMIN, else the admin's
    own tenant. TenantSession already 400s when a superadmin omits the header, so
    it is guaranteed present here for that role."""
    if current_user.role == UserRole.SUPERADMIN:
        return uuid.UUID(str(x_tenant_id))
    assert current_user.tenant_id is not None  # non-superadmin always has one
    return current_user.tenant_id


@router.post(
    "/publishable-keys",
    response_model=PublishableKeyCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_publishable_key(
    payload: PublishableKeyCreate,
    db: TenantSession,
    current_user: CurrentAdmin,
    x_tenant_id: _XTenantId = None,
) -> PublishableKeyCreated:
    tenant_id = _effective_tenant_id(current_user, x_tenant_id)
    row, raw = crud.create_publishable_key(
        db,
        tenant_id=tenant_id,
        name=payload.name.strip(),
        allowed_origins=payload.allowed_origins,
    )
    return PublishableKeyCreated.model_validate({**row.model_dump(), "key": raw})


@router.get("/publishable-keys", response_model=list[PublishableKeyPublic])
async def list_publishable_keys(
    db: TenantSession,
    current_user: CurrentAdmin,
    x_tenant_id: _XTenantId = None,
) -> list[PopupPublishableKeys]:
    tenant_id = _effective_tenant_id(current_user, x_tenant_id)
    return list(
        db.exec(
            select(PopupPublishableKeys)
            .where(PopupPublishableKeys.tenant_id == tenant_id)
            .where(PopupPublishableKeys.revoked_at.is_(None))
        ).all()
    )


@router.delete(
    "/publishable-keys/{key_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_publishable_key(
    key_id: uuid.UUID,
    db: TenantSession,
) -> Response:
    # RLS on the tenant-scoped session means a key from another tenant is
    # invisible here → 404, so no explicit tenant check is needed.
    row = db.get(PopupPublishableKeys, key_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    crud.revoke(db, row)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
