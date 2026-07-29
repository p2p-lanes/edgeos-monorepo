"""Admin management of per-popup publishable keys.

Guards mirror admin_api_key/: admin-only (VIEWER -> 403), enforced at the router
level. The popup is looked up under the tenant-scoped session, so an admin can
only mint/list/revoke keys for popups in their own tenant (RLS enforces it).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlmodel import select

from app.api.popup.crud import popups_crud
from app.api.publishable_key import crud
from app.api.publishable_key.models import PopupPublishableKeys
from app.api.publishable_key.schemas import (
    PublishableKeyCreate,
    PublishableKeyCreated,
    PublishableKeyPublic,
)
from app.core.dependencies.users import TenantSession, get_admin

router = APIRouter(tags=["publishable-keys"], dependencies=[Depends(get_admin)])


@router.post(
    "/popups/{popup_id}/publishable-keys",
    response_model=PublishableKeyCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_publishable_key(
    popup_id: uuid.UUID,
    payload: PublishableKeyCreate,
    db: TenantSession,
) -> PublishableKeyCreated:
    popup = popups_crud.get(db, popup_id)
    if popup is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found"
        )
    row, raw = crud.create_publishable_key(
        db,
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=payload.name.strip(),
        allowed_origins=payload.allowed_origins,
    )
    return PublishableKeyCreated.model_validate({**row.model_dump(), "key": raw})


@router.get(
    "/popups/{popup_id}/publishable-keys",
    response_model=list[PublishableKeyPublic],
)
async def list_publishable_keys(
    popup_id: uuid.UUID,
    db: TenantSession,
) -> list[PopupPublishableKeys]:
    return list(
        db.exec(
            select(PopupPublishableKeys)
            .where(PopupPublishableKeys.popup_id == popup_id)
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
    row = db.get(PopupPublishableKeys, key_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    crud.revoke(db, row)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
