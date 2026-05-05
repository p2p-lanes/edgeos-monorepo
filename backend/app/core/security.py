import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.core.redis import (
    pat_event_create_daily_rate_limiter,
    pat_event_create_rate_limiter,
    pat_event_write_rate_limiter,
)

# Defined here (not in app.api.api_key.schemas) to avoid an import cycle:
# api_key.router imports from core.dependencies.users which imports from
# core.security, so security cannot import back into the api_key package.
ApiKeyScope = Literal["events:read", "events:write", "rsvp:write"]

ALGORITHM = "HS256"

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/v1/auth/user/authenticate")


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    sub: str
    exp: datetime
    token_type: str | None = None
    api_key_id: str | None = None
    scopes: list[ApiKeyScope] = Field(default_factory=list)
    # True when this payload was synthesised from an API key rather than a
    # JWT. Sensitive endpoints (e.g. API key management) reject these so a
    # leaked key cannot mint further keys.
    via_api_key: bool = False


_PAT_ROUTE_POLICIES: dict[str, tuple[tuple[str, bool, ApiKeyScope], ...]] = {
    "GET": (
        ("/api/v1/events/portal/events", False, "events:read"),
        ("/api/v1/event-participants/portal/participants", False, "events:read"),
        ("/api/v1/event-venues/portal/venues", False, "events:read"),
        ("/api/v1/event-settings/portal/settings", False, "events:read"),
        ("/api/v1/tracks/portal/tracks", False, "events:read"),
        ("/api/v1/popups/portal/list", True, "events:read"),
        ("/api/v1/popups/portal/", False, "events:read"),
    ),
    "POST": (
        ("/api/v1/events/portal/events", True, "events:write"),
        ("/api/v1/event-participants/portal/register/", False, "rsvp:write"),
        ("/api/v1/event-participants/portal/cancel-registration/", False, "rsvp:write"),
    ),
}


def _required_scope_for_pat(method: str, path: str) -> ApiKeyScope | None:
    allowed_routes = _PAT_ROUTE_POLICIES.get(method, ())
    for route, exact, scope in allowed_routes:
        if path == route if exact else path.startswith(route):
            return scope
    return None


def _enforce_api_key_policy(request: Request, payload: TokenPayload) -> None:
    if not payload.via_api_key:
        return

    path = request.url.path
    method = request.method.upper()
    required_scope = _required_scope_for_pat(method, path)

    if required_scope is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "API keys are restricted to approved event automation routes. "
                "Sign in with the portal session for broader access."
            ),
        )

    if required_scope not in payload.scopes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"API key lacks required scope: {required_scope}",
        )

    identifier = payload.api_key_id or payload.sub
    if method in {"POST", "PATCH", "PUT", "DELETE"}:
        is_allowed, _remaining = pat_event_write_rate_limiter.is_allowed(identifier)
        if not is_allowed:
            ttl = pat_event_write_rate_limiter.get_ttl(identifier)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="API key write limit exceeded for event automation.",
                headers={"Retry-After": str(ttl)},
            )

    if method == "POST" and path == "/api/v1/events/portal/events":
        create_identifier = f"create:{identifier}"
        is_allowed, _remaining = pat_event_create_rate_limiter.is_allowed(
            create_identifier
        )
        if not is_allowed:
            ttl = pat_event_create_rate_limiter.get_ttl(create_identifier)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="API key event creation limit exceeded.",
                headers={"Retry-After": str(ttl)},
            )

        daily_identifier = f"create-daily:{identifier}"
        is_allowed, _remaining = pat_event_create_daily_rate_limiter.is_allowed(
            daily_identifier
        )
        if not is_allowed:
            ttl = pat_event_create_daily_rate_limiter.get_ttl(daily_identifier)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="API key daily event creation limit exceeded.",
                headers={"Retry-After": str(ttl)},
            )


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
    from app.api.human.models import Humans

    with Session(engine) as session:
        row = api_key_crud.lookup_active_by_raw(session, token)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or revoked API key",
                headers={"WWW-Authenticate": "Bearer"},
            )
        human = session.get(Humans, row.human_id)
        if human is None or human.red_flag:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API key owner is blocked from using API keys.",
            )
        api_key_crud.touch_last_used(session, row)
        # Synthesise a far-future exp so the BaseModel field is satisfied;
        # actual revocation/expiry is enforced at lookup time, not via JWT
        # exp checks.
        return TokenPayload(
            sub=str(row.human_id),
            exp=datetime.now(UTC) + timedelta(minutes=1),
            token_type="human",
            api_key_id=str(row.id),
            scopes=row.scopes,
            via_api_key=True,
        )


def get_token_payload(
    request: Request,
    token: Annotated[str, Depends(oauth2_scheme)],
) -> TokenPayload:
    # Lazy import to avoid pulling api_key into module import order.
    from app.api.api_key.crud import looks_like_api_key

    if looks_like_api_key(token):
        payload = _resolve_api_key(token)
        _enforce_api_key_policy(request, payload)
        return payload
    return decode_access_token(token)
