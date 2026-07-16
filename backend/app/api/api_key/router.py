import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.api_key import crud
from app.api.api_key.schemas import ApiKeyCreate, ApiKeyCreated, ApiKeyPublic
from app.core.dependencies.users import (
    CurrentHuman,
    HumanTenantSession,
    needs,
)
from app.core.security import (
    THIRD_PARTY_API_KEY_SCOPES_MAX,
    TokenPayload,
    get_token_payload,
)

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


def _require_human_can_manage_api_keys(current_human: CurrentHuman) -> None:
    if current_human.red_flag:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Blocked humans cannot create or manage API keys.",
        )


HumanCanManageApiKeys = Annotated[None, Depends(_require_human_can_manage_api_keys)]


@router.get(
    "",
    response_model=list[ApiKeyPublic],
    summary="List your API keys",
    dependencies=[needs("portal:api_keys:manage")],
)
async def list_api_keys(
    db: HumanTenantSession,
    current_human: CurrentHuman,
    _: JwtOnly,
    __: HumanCanManageApiKeys,
) -> list[ApiKeyPublic]:
    rows = crud.list_for_human(db, current_human.id)
    return [ApiKeyPublic.model_validate(r) for r in rows]


@router.post(
    "",
    response_model=ApiKeyCreated,
    status_code=status.HTTP_201_CREATED,
    summary="Create an API key",
    dependencies=[needs("portal:api_keys:manage")],
)
async def create_api_key(
    payload: ApiKeyCreate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    token_payload: Annotated[TokenPayload, Depends(get_token_payload)],
    _: JwtOnly,
    __: HumanCanManageApiKeys,
) -> ApiKeyCreated:
    # REQ-4.1 / REQ-5.1: third-party JWT scope enforcement.
    if getattr(token_payload, "issued_via", "portal") == "third_party":
        if token_payload.issued_by_app_id is not None:
            # v2 path: per-app ceiling — check app.allowed_api_key_scopes.
            from app.api.third_party_app.crud import get_for_authorization

            app = get_for_authorization(db, token_payload.issued_by_app_id)
            if app is None:
                # App was deleted/revoked between JWT mint and now.
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Third-party app no longer authorized.",
                )
            allowed = set(app.allowed_api_key_scopes)
        else:
            # LEGACY-V1-FALLBACK — remove >=30d after deploy.
            allowed = set(THIRD_PARTY_API_KEY_SCOPES_MAX)

        invalid = set(payload.scopes) - allowed
        if invalid:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"These scopes are not permitted for third-party sessions: {sorted(invalid)}",
            )

    # Popup binding: keys are attendee keys (human + popup). The popup must
    # exist within the caller's tenant (RLS hides foreign popups → 404).
    from app.api.application.crud import applications_crud
    from app.api.popup.crud import popups_crud
    from app.api.popup.schemas import PopupStatus

    popup = popups_crud.get(db, payload.popup_id)
    if popup is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    # Membership gate: same access ladder as the portal passes/events gates
    # (accepted application, attendee ticket, payment, or companion access).
    access = applications_crud.resolve_popup_access(db, current_human.id, popup.id)
    if not access.allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You need to be an accepted participant of this popup to create an API key for it.",
        )

    # Ended popups are recap/read-only: keys may still be minted for queries,
    # but never with write capability.
    if popup.status == PopupStatus.ended and any(
        scope.endswith(":write") for scope in payload.scopes
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This popup has ended; API keys can only be created with read-only access.",
        )

    row, raw = crud.create_for_human(
        db,
        tenant_id=current_human.tenant_id,
        human_id=current_human.id,
        popup_id=popup.id,
        name=payload.name.strip(),
        expires_at=payload.expires_at,
        scopes=payload.scopes,
    )
    return ApiKeyCreated.model_validate({**row.model_dump(), "key": raw})


@router.delete(
    "/{key_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke an API key",
    dependencies=[needs("portal:api_keys:manage")],
)
async def revoke_api_key(
    key_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    _: JwtOnly,
    __: HumanCanManageApiKeys,
) -> None:
    row = crud.get_for_human(db, key_id, current_human.id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="API key not found"
        )
    crud.revoke(db, row)
