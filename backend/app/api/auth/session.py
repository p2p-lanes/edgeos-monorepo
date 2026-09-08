from typing import Annotated

from fastapi import Depends, HTTPException

from app.core.security import TokenPayload, decode_access_token, oauth2_scheme


def get_portal_session_payload(
    token: Annotated[str, Depends(oauth2_scheme)],
) -> TokenPayload:
    # Decode JWTs only. Raw API keys must not resolve or touch their usage timestamp.
    payload = decode_access_token(token)
    if (
        payload.token_type != "human"
        or payload.via_api_key
        or payload.api_key_id is not None
        or payload.issued_via != "portal"
        or payload.issued_by_app_id is not None
        or "portal:*" not in payload.scopes
    ):
        raise HTTPException(status_code=401, detail="Invalid portal session")
    return payload


PortalSessionPayload = Annotated[TokenPayload, Depends(get_portal_session_payload)]
