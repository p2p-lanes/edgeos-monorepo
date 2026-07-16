"""Write guards shared by popup-scoped portal endpoints.

Lives in the popup package (not ``core``) so routers can import it without
pulling API modules into ``app.core.security``.
"""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.core.security import TokenPayload, get_token_payload

# Convenience annotation so portal routes can receive the resolved token
# payload (JWT or API key) and pass it to the popup guards below.
CallerToken = Annotated[TokenPayload, Depends(get_token_payload)]


def ensure_popup_writable(popup: Popups | None) -> None:
    """Reject portal mutations on ended popups (recap mode is read-only).

    Applies to both portal JWT humans and API-key callers, which share the
    same ``/portal`` endpoints. Backoffice/admin endpoints stay writable.
    """
    if popup is not None and popup.status == PopupStatus.ended:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This popup has ended and is read-only.",
        )


def is_popup_scoped_api_key(token_payload: TokenPayload) -> bool:
    """True when the caller authenticated with a human-owned (portal) API key.

    Admin-owned keys (token_type="user") are tenant-scoped, governed by
    CurrentAdminOrApiKey, and never popup-bound.
    """
    return bool(token_payload.via_api_key) and token_payload.token_type == "human"


def ensure_api_key_popup(
    token_payload: TokenPayload, popup_id: uuid.UUID | None
) -> None:
    """Reject popup-scoped API-key calls that target a different popup.

    No-op for JWT sessions and admin keys. For human-owned keys the request's
    popup must match the key's binding; a key without a binding (legacy row)
    or a request whose popup could not be resolved fails closed.
    """
    if not is_popup_scoped_api_key(token_payload):
        return
    if (
        token_payload.popup_id is None
        or popup_id is None
        or token_payload.popup_id != popup_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This API key does not have access to this popup.",
        )


def resolve_api_key_popup_filter(
    token_payload: TokenPayload, popup_id: uuid.UUID | None
) -> uuid.UUID | None:
    """Popup filter for list endpoints with an optional ``popup_id`` param.

    JWT sessions keep whatever filter they asked for. Popup-scoped API keys
    are forced onto their own popup: an explicit mismatching filter raises
    403, and an omitted filter is replaced by the key's popup so a key can
    never read tenant-wide data.
    """
    if not is_popup_scoped_api_key(token_payload):
        return popup_id
    if popup_id is not None:
        ensure_api_key_popup(token_payload, popup_id)
        return popup_id
    if token_payload.popup_id is None:
        # Legacy key without a popup binding — fail closed.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This API key does not have access to this popup.",
        )
    return token_payload.popup_id
