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

# ---------------------------------------------------------------------------
# Scope type definitions
# ---------------------------------------------------------------------------

# Human/portal scope universe. These map to what a portal JWT (or a JWT issued
# by the third-party OTP surface) may carry. They are completely disjoint from
# ApiKeyScope so that a union type can be used on TokenPayload.scopes.
# Each granular scope describes WHICH resource + WHICH action. New routes
# attach a scope inline via `dependencies=[needs("portal:resource:action")]`
# (see app.core.dependencies.users.needs). The registry walker discovers the
# scope automatically — no per-scope alias needed.
HumanScope = Literal[
    "portal:*",
    "portal:profile:read",
    "portal:profile:write",
    "portal:applications:read",
    "portal:applications:write",
    "portal:attendees:write",
    "portal:payments:read",
    "portal:directory:read",
    "portal:api_keys:manage",
]

# Admin API-key scope universe. Defined here (not in app.api.api_key.schemas)
# to avoid an import cycle: api_key.router imports from core.dependencies.users
# which imports from core.security, so security cannot import back into api_key.
ApiKeyScope = Literal[
    "events:read",
    "events:write",
    "rsvp:write",
    "venues:read",
    "venues:write",
    "applications:read",
    "applications:write",
    "attendees:read",
    "attendees:write",
    "humans:read",
    "humans:write",
    "groups:read",
    "groups:write",
    "products:read",
    "products:write",
    "coupons:read",
    "coupons:write",
    "forms:read",
    "forms:write",
    "payments:read",
    "tracks:read",
    "tracks:write",
    "ticketing_steps:read",
    "ticketing_steps:write",
    "translations:read",
    "translations:write",
]

# Union used for TokenPayload.scopes — accepts both universes.
AnyScope = HumanScope | ApiKeyScope

# ---------------------------------------------------------------------------
# Scope universe constants
# ---------------------------------------------------------------------------

# Maximum scopes embeddable in a JWT issued by the third-party OTP flow.
# These are HumanScope values — the third-party user gets portal access,
# not admin access. Per-app subsets are drawn from this ceiling.
THIRD_PARTY_TOKEN_SCOPES_MAX: tuple[HumanScope, ...] = (
    "portal:profile:read",
    "portal:profile:write",
    "portal:applications:read",
    "portal:applications:write",
    "portal:attendees:write",
    "portal:payments:read",
    "portal:directory:read",
    "portal:api_keys:manage",
)
# Note: RSVP write capability is delivered through the api-key surface (the
# `rsvp:write` ApiKeyScope in THIRD_PARTY_API_KEY_SCOPES_MAX). The agent
# mints an api key via portal:api_keys:manage and uses it against the
# /event-participants/portal/{register,cancel-registration} endpoints, so a
# dedicated JWT-level rsvp scope would be redundant.

# Maximum scopes a human may request when minting an API key via the
# third-party OTP surface. Per-app subsets are drawn from this ceiling.
# Intentionally narrow — external partners get event-read and rsvp-write only.
THIRD_PARTY_API_KEY_SCOPES_MAX: frozenset[str] = frozenset({
    "events:read",
    "rsvp:write",
    "venues:read",
})

# Full admin scope universe. Explicitly EXCLUDES: email_templates, users,
# tenants, tenants:credentials, popup_reviewers, payments:write.
ADMIN_API_KEY_SCOPES: frozenset[str] = frozenset({
    "events:read",
    "events:write",
    "rsvp:write",
    "venues:read",
    "venues:write",
    "applications:read",
    "applications:write",
    "attendees:read",
    "attendees:write",
    "humans:read",
    "humans:write",
    "groups:read",
    "groups:write",
    "products:read",
    "products:write",
    "coupons:read",
    "coupons:write",
    "forms:read",
    "forms:write",
    "payments:read",
    "tracks:read",
    "tracks:write",
    "ticketing_steps:read",
    "ticketing_steps:write",
    "translations:read",
    "translations:write",
})

# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

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
    # True when this payload was synthesised from an API key rather than a
    # JWT. Sensitive endpoints (e.g. API key management) reject these so a
    # leaked key cannot mint further keys.
    via_api_key: bool = False
    # How the token was originally issued. Used by scope enforcement to decide
    # which scope universe applies (portal vs third_party surface).
    issued_via: Literal["portal", "third_party"] = "portal"
    # Scopes attached to this token. Empty list = legacy token (grace period
    # logic in decode_access_token synthesises ["portal:*"] for human tokens).
    scopes: list[AnyScope] = Field(default_factory=list)
    # Internal — set only by _resolve_api_key for admin-owned keys. Lets
    # get_admin_or_api_key_tenant_session resolve tenant without going through
    # CurrentUser. NOT serialised into any JWT.
    api_key_tenant_id: uuid.UUID | None = None
    # Identifies which ThirdPartyApps row minted this JWT. Drives per-app scope
    # enforcement at api-key minting and self-discovery.
    # None for portal JWTs and for legacy v1 third-party JWTs in flight at
    # deploy time.
    # Grace-period contract: if issued_via=="third_party" AND issued_by_app_id
    # is None, the JWT is a legacy v1 token and its embedded scopes are
    # authoritative.
    issued_by_app_id: uuid.UUID | None = None


# Each entry: (route, exact_match, scopes_any_of). The api key must carry at
# least one of `scopes_any_of` for the route to be accessible.
_PAT_ROUTE_POLICIES: dict[
    str, tuple[tuple[str, bool, tuple[ApiKeyScope, ...]], ...]
] = {
    "GET": (
        ("/api/v1/events/portal/events", False, ("events:read",)),
        ("/api/v1/event-participants/portal/participants", False, ("events:read",)),
        ("/api/v1/event-venues/portal/venues", False, ("events:read", "venues:read")),
        ("/api/v1/event-settings/portal/settings", False, ("events:read",)),
        ("/api/v1/tracks/portal/tracks", False, ("events:read",)),
        ("/api/v1/popups/portal/list", True, ("events:read",)),
        ("/api/v1/popups/portal/", False, ("events:read",)),
    ),
    "POST": (
        # Edge City: POST /events disabled for API keys until week 2.
        # Restore the line below to re-enable agentic event creation:
        # ("/api/v1/events/portal/events", True, ("events:write",)),
        ("/api/v1/events/portal/events/", False, ("events:write",)),
        ("/api/v1/event-venues/portal/venues", True, ("venues:write",)),
        ("/api/v1/event-participants/portal/register/", False, ("rsvp:write",)),
        (
            "/api/v1/event-participants/portal/cancel-registration/",
            False,
            ("rsvp:write",),
        ),
    ),
    "PATCH": (
        ("/api/v1/event-venues/portal/venues/", False, ("venues:write",)),
        ("/api/v1/events/portal/events/", False, ("events:write",)),
    ),
    "DELETE": (
        ("/api/v1/event-venues/portal/venues/", False, ("venues:write",)),
        ("/api/v1/events/portal/events/", False, ("events:write",)),
    ),
}


def _required_scopes_for_pat(
    method: str, path: str
) -> tuple[ApiKeyScope, ...] | None:
    """Return the tuple of any-of scopes the route requires, or None if the
    route is not in the PAT whitelist."""
    allowed_routes = _PAT_ROUTE_POLICIES.get(method, ())
    for route, exact, scopes in allowed_routes:
        if path == route if exact else path.startswith(route):
            return scopes
    return None


def _enforce_api_key_policy(request: Request, payload: TokenPayload) -> None:
    if not payload.via_api_key:
        return

    # Admin-owned api keys (token_type="user") are governed by the
    # CurrentAdminOrApiKey dependency, not by _PAT_ROUTE_POLICIES. Skip the
    # portal whitelist check for them.
    if payload.token_type == "user":
        return

    path = request.url.path
    method = request.method.upper()
    required_scopes = _required_scopes_for_pat(method, path)

    if required_scopes is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "API keys are restricted to approved event automation routes. "
                "Sign in with the portal session for broader access."
            ),
        )

    if not any(s in payload.scopes for s in required_scopes):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"API key lacks required scope: {required_scopes[0]}",
        )


def create_access_token(
    subject: str | uuid.UUID,
    token_type: str | None = None,
    expires_delta: timedelta | None = None,
    scopes: list[AnyScope] | None = None,
    issued_via: Literal["portal", "third_party"] = "portal",
    via_api_key: bool = False,
    api_key_id: str | None = None,
    issued_by_app_id: uuid.UUID | None = None,
) -> str:
    """Mint a signed JWT.

    ``scopes`` and ``issued_via`` are encoded only when they carry non-default
    values to keep legacy token payloads minimal. The exception: when
    ``issued_via="third_party"``, ``scopes`` is always encoded because it is
    the defining property of a third-party token.

    ``issued_by_app_id``: when set, encoded as a string UUID in the payload.
    Identifies the ThirdPartyApps row that authorized this JWT issuance.
    Omitted for portal JWTs and for legacy v1 third-party JWTs.
    """
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
    if issued_via != "portal":
        to_encode["issued_via"] = issued_via
    if scopes:
        to_encode["scopes"] = list(scopes)
    elif issued_via == "third_party":
        # Always encode scopes for third-party tokens even if empty.
        to_encode["scopes"] = []
    if via_api_key:
        to_encode["via_api_key"] = True
    if api_key_id is not None:
        to_encode["api_key_id"] = api_key_id
    if issued_by_app_id is not None:
        to_encode["issued_by_app_id"] = str(issued_by_app_id)

    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> TokenPayload:
    """Decode a JWT and return a TokenPayload.

    Grace-period rule (backward compat):
        If ``token_type == "human"`` and the JWT carries no ``scopes`` field
        (or ``scopes == []``) and no ``issued_via`` field, synthesise
        ``scopes=["portal:*"]`` and ``issued_via="portal"``. This covers
        legacy portal JWTs in flight at deploy time. The grace period self-
        bounds via the token's own ``exp``.

    User tokens (``token_type == "user"``) do NOT receive grace synthesis —
    admin scope enforcement runs in ``CurrentAdminOrApiKey`` which treats a
    missing scopes field on a user JWT as "JWT path → trust role guard".
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        token_type: str | None = payload.get("token_type")
        raw_scopes: list[str] = payload.get("scopes", [])
        issued_via: str = payload.get("issued_via", "portal")
        via_api_key: bool = payload.get("via_api_key", False)
        api_key_id: str | None = payload.get("api_key_id")
        raw_app_id: str | None = payload.get("issued_by_app_id")
        issued_by_app_id: uuid.UUID | None = (
            uuid.UUID(raw_app_id) if raw_app_id else None
        )

        # Grace-period synthesis for human tokens with absent/empty scopes.
        if token_type == "human" and not raw_scopes and issued_via == "portal":
            raw_scopes = ["portal:*"]

        return TokenPayload(
            sub=payload["sub"],
            exp=payload["exp"],
            token_type=token_type,
            issued_via=issued_via,
            scopes=raw_scopes,  # type: ignore[arg-type]
            via_api_key=via_api_key,
            api_key_id=api_key_id,
            issued_by_app_id=issued_by_app_id,
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
    that mirrors the human or user JWT shape so downstream dependencies can
    stay oblivious to the auth method.

    For human-owned keys (human_id set): returns ``token_type="human"`` with
    ``sub=human_id``, same as the previous behaviour.

    For admin-owned keys (user_id set, human_id None): returns
    ``token_type="user"`` with ``sub=user_id`` and sets
    ``api_key_tenant_id`` from the key row so that
    ``get_admin_or_api_key_tenant_session`` can resolve the tenant without
    going through ``CurrentUser`` (FLAG-2 fix).

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

        # Branch on ownership type.
        if row.human_id is not None:
            # Human-owned key: original path.
            from app.api.human.models import Humans

            human = session.get(Humans, row.human_id)
            if human is None or human.red_flag:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="API key owner is blocked from using API keys.",
                )
            api_key_crud.touch_last_used(session, row)
            return TokenPayload(
                sub=str(row.human_id),
                exp=datetime.now(UTC) + timedelta(minutes=1),
                token_type="human",
                api_key_id=str(row.id),
                scopes=row.scopes,  # type: ignore[arg-type]
                via_api_key=True,
            )

        # Admin-owned key (user_id is set).
        if row.user_id is not None:
            api_key_crud.touch_last_used(session, row)
            return TokenPayload(
                sub=str(row.user_id),
                exp=datetime.now(UTC) + timedelta(minutes=1),
                token_type="user",
                api_key_id=str(row.id),
                scopes=row.scopes,  # type: ignore[arg-type]
                via_api_key=True,
                # api_key_tenant_id lets get_admin_or_api_key_tenant_session
                # resolve the tenant from the key row without needing CurrentUser.
                api_key_tenant_id=row.tenant_id,
            )

        # Constraint violation: both are null. Should never happen in production
        # because the DB CHECK constraint prevents it, but we guard defensively.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="API key row has neither human_id nor user_id set.",
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
