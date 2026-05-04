import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.api_key import crud
from app.api.api_key.schemas import ApiKeyCreate, ApiKeyCreated, ApiKeyPublic
from app.core.dependencies.users import CurrentHuman, HumanTenantSession
from app.core.security import TokenPayload, get_token_payload

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


def _require_jwt(
    token_payload: Annotated[TokenPayload, Depends(get_token_payload)],
) -> None:
    """Reject calls authenticated via API key — only JWT sessions can manage keys.

    Rationale: if an API key could mint more API keys, a single leaked
    token would let an attacker pivot to permanent access even after the
    user revokes it. Force users back to the portal (with their JWT) for
    key lifecycle operations.
    """
    if getattr(token_payload, "via_api_key", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API keys cannot manage other API keys; sign in to the portal.",
        )


JwtOnly = Annotated[None, Depends(_require_jwt)]


@router.get("", response_model=list[ApiKeyPublic])
async def list_api_keys(
    db: HumanTenantSession,
    current_human: CurrentHuman,
    _: JwtOnly,
) -> list[ApiKeyPublic]:
    rows = crud.list_for_human(db, current_human.id)
    return [ApiKeyPublic.model_validate(r) for r in rows]


@router.post("", response_model=ApiKeyCreated, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    payload: ApiKeyCreate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    _: JwtOnly,
) -> ApiKeyCreated:
    row, raw = crud.create_for_human(
        db,
        tenant_id=current_human.tenant_id,
        human_id=current_human.id,
        name=payload.name.strip(),
        expires_at=payload.expires_at,
    )
    return ApiKeyCreated.model_validate({**row.model_dump(), "key": raw})


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(
    key_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    _: JwtOnly,
) -> None:
    row = crud.get_for_human(db, key_id, current_human.id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="API key not found"
        )
    crud.revoke(db, row)
