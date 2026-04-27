import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine

ALGORITHM = "HS256"

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/v1/auth/user/authenticate")


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    sub: str
    exp: datetime
    token_type: str | None = None
    # True when this payload was synthesised from an API key rather than a
    # JWT. Sensitive endpoints (e.g. API key management) reject these so a
    # leaked key cannot mint further keys.
    via_api_key: bool = False


def create_access_token(
    subject: str | uuid.UUID,
    token_type: str | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        expire = datetime.now(UTC) + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )

    to_encode: dict[str, Any] = {
        "sub": str(subject),
        "exp": expire,
    }
    if token_type:
        to_encode["token_type"] = token_type

    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> TokenPayload:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        return TokenPayload(
            sub=payload["sub"],
            exp=payload["exp"],
            token_type=payload.get("token_type"),
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _resolve_api_key(token: str) -> TokenPayload:
    """Look up a raw API key on the global engine and return a TokenPayload
    that mirrors the human JWT shape so downstream dependencies (e.g.
    ``get_current_human``) can stay oblivious to the auth method.

    The lookup runs on the unscoped ``engine`` because at this point the
    request hasn't established a tenant context yet — RLS would otherwise
    reject the query.
    """
    # Imported lazily to avoid a circular dependency: api_key.crud is part
    # of the API surface and pulls in models that themselves transitively
    # depend on app.core.*.
    from app.api.api_key import crud as api_key_crud

    with Session(engine) as session:
        row = api_key_crud.lookup_active_by_raw(session, token)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or revoked API key",
                headers={"WWW-Authenticate": "Bearer"},
            )
        api_key_crud.touch_last_used(session, row)
        # Synthesise a far-future exp so the BaseModel field is satisfied;
        # actual revocation/expiry is enforced at lookup time, not via JWT
        # exp checks.
        return TokenPayload(
            sub=str(row.human_id),
            exp=datetime.now(UTC) + timedelta(minutes=1),
            token_type="human",
            via_api_key=True,
        )


def get_token_payload(
    token: Annotated[str, Depends(oauth2_scheme)],
) -> TokenPayload:
    # Lazy import to avoid pulling api_key into module import order.
    from app.api.api_key.crud import looks_like_api_key

    if looks_like_api_key(token):
        return _resolve_api_key(token)
    return decode_access_token(token)
