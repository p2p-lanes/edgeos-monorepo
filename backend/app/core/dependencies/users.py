import uuid
from collections.abc import Generator
from typing import TYPE_CHECKING, Annotated

from cachetools import TTLCache
from fastapi import Depends, Header, HTTPException, status
from sqlmodel import Session, func, select

from app.api.shared.enums import UserRole
from app.core.db import engine
from app.core.security import ApiKeyScope, HumanScope, TokenPayload, get_token_payload

if TYPE_CHECKING:
    from app.api.human.schemas import HumanPublic
    from app.api.tenant.schemas import TenantPublic
    from app.api.user.schemas import UserPublic

# Cache authenticated users for 60 seconds to reduce DB round-trips
# Key: user_id (UUID), Value: UserPublic
_user_cache: TTLCache[uuid.UUID, "UserPublic"] = TTLCache(maxsize=1000, ttl=60)


def invalidate_user_cache(user_id: uuid.UUID) -> None:
    """Call this when a user is modified/deleted to invalidate their cache entry."""
    _user_cache.pop(user_id, None)


def get_session() -> Generator[Session]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


def fetch_authenticated_user(
    token_payload: Annotated[TokenPayload, Depends(get_token_payload)],
    db: SessionDep,
    require_token_type: str | None = "user",
) -> "UserPublic":
    from app.api.user.models import Users
    from app.api.user.schemas import UserPublic

    # Check token type if specified
    if require_token_type and token_payload.token_type != require_token_type:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This endpoint requires a {require_token_type} token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_id = uuid.UUID(token_payload.sub)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check cache first
    if user_id in _user_cache:
        return _user_cache[user_id]

    user = db.exec(select(Users).where(Users.id == user_id)).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.deleted:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is deactivated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_public = UserPublic.model_validate(user)
    _user_cache[user_id] = user_public
    return user_public


def get_current_user(
    token_payload: Annotated[TokenPayload, Depends(get_token_payload)],
    db: SessionDep,
) -> "UserPublic":
    return fetch_authenticated_user(token_payload, db)


def get_current_human(
    token_payload: Annotated[TokenPayload, Depends(get_token_payload)],
    db: SessionDep,
) -> "HumanPublic":
    from app.api.human.models import Humans
    from app.api.human.schemas import HumanPublic

    # Only allow human tokens
    if token_payload.token_type != "human":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint requires a human token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        human_id = uuid.UUID(token_payload.sub)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    human = db.exec(select(Humans).where(Humans.id == human_id)).first()

    if not human:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Human not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return HumanPublic.model_validate(human)


def get_superadmin(
    current_user: Annotated["UserPublic", Depends(get_current_user)],
) -> "UserPublic":
    if current_user.role != UserRole.SUPERADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superadmin access required",
        )
    return current_user


def get_admin(
    current_user: Annotated["UserPublic", Depends(get_current_user)],
) -> "UserPublic":
    if current_user.role not in [UserRole.SUPERADMIN, UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


def get_operator(
    current_user: Annotated["UserPublic", Depends(get_current_user)],
) -> "UserPublic":
    if current_user.role not in [
        UserRole.SUPERADMIN,
        UserRole.ADMIN,
        UserRole.OPERATOR,
    ]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operator access required",
        )
    return current_user


def require_write_permission(
    current_user: Annotated["UserPublic", Depends(get_current_user)],
) -> "UserPublic":
    if current_user.role not in [UserRole.SUPERADMIN, UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Write access requires admin role",
        )
    return current_user


def get_check_in_operator(
    current_user: Annotated["UserPublic", Depends(get_current_user)],
) -> "UserPublic":
    if current_user.role not in [
        UserRole.SUPERADMIN,
        UserRole.ADMIN,
        UserRole.OPERATOR,
        UserRole.CHECK_IN_CONTROLLER,
    ]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Check-in operator access required",
        )
    return current_user


CurrentUser = Annotated["UserPublic", Depends(get_current_user)]
CurrentHuman = Annotated["HumanPublic", Depends(get_current_human)]
CurrentSuperadmin = Annotated["UserPublic", Depends(get_superadmin)]
CurrentAdmin = Annotated["UserPublic", Depends(get_admin)]
CurrentOperator = Annotated["UserPublic", Depends(get_operator)]
CurrentWriter = Annotated["UserPublic", Depends(require_write_permission)]
CurrentCheckInOperator = Annotated["UserPublic", Depends(get_check_in_operator)]


def get_operator_jwt_only(
    token_payload: Annotated["TokenPayload", Depends(get_token_payload)],
    current_user: Annotated["UserPublic", Depends(get_operator)],
) -> "UserPublic":
    """Like get_operator but explicitly rejects API-key tokens.

    Used for endpoints that are intentionally JWT-only by policy (e.g. PATCH
    /payments) — api-key callers receive 403 regardless of their scopes.
    """
    if token_payload.via_api_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint requires a JWT session; API keys are not accepted.",
        )
    return current_user


CurrentOperatorJwtOnly = Annotated["UserPublic", Depends(get_operator_jwt_only)]


def get_current_tenant(
    db: SessionDep,
    x_tenant_id: Annotated[str, Header(alias="X-Tenant-Id")],
) -> "TenantPublic":
    from app.api.tenant.models import Tenants
    from app.api.tenant.schemas import TenantPublic

    try:
        tenant_id = uuid.UUID(x_tenant_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid tenant ID format",
        )

    tenant = db.exec(select(Tenants).where(Tenants.id == tenant_id)).first()

    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )

    if tenant.deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant is deactivated",
        )

    return TenantPublic.model_validate(tenant)


CurrentTenant = Annotated["TenantPublic", Depends(get_current_tenant)]


def get_tenant_session(
    current_user: CurrentUser,
    db: SessionDep,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> Generator[Session]:
    from app.api.shared.enums import CredentialType
    from app.core.tenant_db import tenant_connection_manager

    if current_user.role == UserRole.SUPERADMIN:
        if not x_tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="X-Tenant-Id header required for superadmin access to tenant data",
            )

        try:
            tenant_id = uuid.UUID(x_tenant_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid tenant ID format",
            )

        cached_cred = tenant_connection_manager.get_credential(
            db, tenant_id, CredentialType.CRUD
        )

        if not cached_cred:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tenant credentials not configured",
            )

        tenant_engine = tenant_connection_manager.get_engine(
            tenant_id,
            CredentialType.CRUD,
            cached_cred.username,
            cached_cred.password,
        )

        with Session(tenant_engine) as tenant_session:
            yield tenant_session
        return

    if not current_user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User has no tenant assigned",
        )

    credential_type = (
        CredentialType.READONLY
        if current_user.role == UserRole.VIEWER
        else CredentialType.CRUD  # CHECK_IN_CONTROLLER falls through to CRUD — required for ticket_events writes
    )

    cached_cred = tenant_connection_manager.get_credential(
        db, current_user.tenant_id, credential_type
    )

    if not cached_cred:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant credentials not configured",
        )

    tenant_engine = tenant_connection_manager.get_engine(
        current_user.tenant_id,
        credential_type,
        cached_cred.username,
        cached_cred.password,
    )

    with Session(tenant_engine) as tenant_session:
        yield tenant_session


TenantSession = Annotated[Session, Depends(get_tenant_session)]


def get_human_tenant_session(
    current_human: CurrentHuman,
    db: SessionDep,
) -> Generator[Session]:
    """Yield a tenant-scoped DB session for portal (human) routes.

    Uses the human's tenant_id to obtain a CRUD-scoped engine with RLS,
    mirroring the pattern used by get_tenant_session for backoffice users.
    """
    from app.api.shared.enums import CredentialType
    from app.core.tenant_db import tenant_connection_manager

    if not current_human.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Human has no tenant assigned",
        )

    cached_cred = tenant_connection_manager.get_credential(
        db, current_human.tenant_id, CredentialType.CRUD
    )

    if not cached_cred:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant credentials not configured",
        )

    tenant_engine = tenant_connection_manager.get_engine(
        current_human.tenant_id,
        CredentialType.CRUD,
        cached_cred.username,
        cached_cred.password,
    )

    with Session(tenant_engine) as tenant_session:
        yield tenant_session


HumanTenantSession = Annotated[Session, Depends(get_human_tenant_session)]


def get_current_portal_staff(
    current_human: CurrentHuman,
    db: SessionDep,
) -> "HumanPublic":
    """Authorize a portal human as backoffice staff, by email match.

    Some features (e.g. event admin notes) are staff-only but must be reachable
    from the portal, which authenticates Humans (no roles). We bridge the two
    identity systems by email: a logged-in human whose email matches a
    non-deleted backoffice User is treated as staff. The human already proved
    control of that email via OTP login, so the match is as trustworthy as the
    human session itself.

    A SUPERADMIN spans all tenants (their ``tenant_id`` is typically NULL), so a
    matching superadmin grants staff access in any tenant. Other roles are
    tenant-scoped: the User must belong to the human's tenant. Raises 403 when
    no matching User qualifies.
    """
    from app.api.user.models import Users

    candidates = db.exec(
        select(Users).where(
            func.lower(Users.email) == current_human.email.lower(),
            Users.deleted == False,  # noqa: E712
        )
    ).all()
    is_staff = any(
        user.role == UserRole.SUPERADMIN or user.tenant_id == current_human.tenant_id
        for user in candidates
    )
    if not is_staff:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action is restricted to backoffice staff.",
        )
    return current_human


CurrentPortalStaff = Annotated["HumanPublic", Depends(get_current_portal_staff)]


# ---------------------------------------------------------------------------
# require_human_scope — portal scope guard (Block 4, task 4.2)
# ---------------------------------------------------------------------------


def require_human_scope(scope: HumanScope):
    """Return a dependency that enforces a specific HumanScope on portal routes.

    Pass conditions (REQ-SE-01 through REQ-SE-05):
      - ``portal:*`` in payload.scopes (explicit wildcard or grace-synthesised).
      - The exact requested ``scope`` is in payload.scopes.

    Raises HTTP 403 otherwise. Does NOT re-check JWT authenticity — additive on
    top of ``get_current_human``.

    The returned callable carries a ``scope`` attribute so the registry walker
    in ``app.api.access.introspection`` can introspect which scope each
    dependency enforces without inspecting closure cells.
    """

    def _guard(
        token_payload: Annotated[TokenPayload, Depends(get_token_payload)],
    ) -> None:
        # API key callers are governed by _PAT_ROUTE_POLICIES in core.security
        # which enforces a route-specific api-key-side scope (e.g. rsvp:write).
        # Skipping the human-scope check here avoids requiring api keys to also
        # carry a portal:* scope they cannot meaningfully hold.
        if token_payload.via_api_key:
            return
        if "portal:*" in token_payload.scopes:
            return
        if scope in token_payload.scopes:
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Your session does not have permission to access this resource. "
                f"Required scope: {scope}."
            ),
        )

    # Attach scope for introspection by register_scope_routes.
    _guard.scope = scope  # type: ignore[attr-defined]
    return _guard


# ---------------------------------------------------------------------------
# CurrentAdminOrApiKey — dual-auth guard for admin endpoints (Block 4, task 4.3)
# ---------------------------------------------------------------------------


def CurrentAdminOrApiKey(scope: ApiKeyScope):
    """Return a dependency that accepts admin JWTs or scoped admin api-keys.

    Path A — JWT admin:
      token_type="user", via_api_key=False, role in (ADMIN, SUPERADMIN).
      Scope is implicitly granted; role gates the whole catalog.

    Path B — Admin api-key:
      token_type="user", via_api_key=True, ``scope`` in payload.scopes.

    Anything else (human JWT, human api-key, unauthenticated) raises 403.
    """

    def _dep(
        token_payload: Annotated[TokenPayload, Depends(get_token_payload)],
        db: "SessionDep",
    ) -> "UserPublic":
        if token_payload.token_type != "user":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This endpoint requires an admin session or an admin API key.",
            )

        if not token_payload.via_api_key:
            # Path A: JWT-authenticated user — enforce role.
            # Matches the former CurrentOperator gate: SUPERADMIN, ADMIN, OPERATOR.
            # CHECK_IN_CONTROLLER and VIEWER are excluded.
            user = fetch_authenticated_user(
                token_payload, db, require_token_type="user"
            )
            if user.role not in (
                UserRole.SUPERADMIN,
                UserRole.ADMIN,
                UserRole.OPERATOR,
            ):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Admin access required.",
                )
            return user

        # Path B: admin-owned api-key — enforce scope.
        if scope not in token_payload.scopes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"API key lacks required scope: {scope}",
            )
        return fetch_authenticated_user(token_payload, db, require_token_type="user")

    return _dep


# ---------------------------------------------------------------------------
# get_admin_or_api_key_tenant_session — tenant session for dual-auth (4.4)
# ---------------------------------------------------------------------------


def get_admin_or_api_key_tenant_session(scope: ApiKeyScope):
    """Return a factory that yields a tenant-scoped Session.

    Resolves tenant_id:
      - api-key branch: from ``token_payload.api_key_tenant_id`` (set by
        ``_resolve_api_key`` for admin-owned keys — FLAG-2 fix).
      - JWT branch: delegates to ``get_tenant_session`` (existing logic —
        supports SUPERADMIN + X-Tenant-Id and regular admin).

    Design R-A1 note: the JWT branch uses ``yield from`` delegation to
    ``get_tenant_session``. FastAPI's generator lifecycle handles cleanup
    correctly because the outer generator itself is a generator (``yield from``
    propagates both ``send()`` and ``throw()`` so the inner generator's
    ``finally`` block still runs on request teardown).
    """

    def _dep(
        current_user: Annotated["UserPublic", Depends(CurrentAdminOrApiKey(scope))],
        token_payload: Annotated[TokenPayload, Depends(get_token_payload)],
        db: "SessionDep",
        x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
    ) -> Generator[Session]:
        if token_payload.via_api_key:
            from app.api.shared.enums import CredentialType
            from app.core.tenant_db import tenant_connection_manager

            tenant_id = token_payload.api_key_tenant_id
            if tenant_id is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="API key has no tenant context.",
                )

            cached_cred = tenant_connection_manager.get_credential(
                db, tenant_id, CredentialType.CRUD
            )
            if not cached_cred:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Tenant credentials not configured",
                )

            tenant_engine = tenant_connection_manager.get_engine(
                tenant_id,
                CredentialType.CRUD,
                cached_cred.username,
                cached_cred.password,
            )
            with Session(tenant_engine) as tenant_session:
                yield tenant_session
        else:
            # JWT branch — delegate to the existing get_tenant_session logic.
            yield from get_tenant_session(current_user, db, x_tenant_id)

    return _dep


# ---------------------------------------------------------------------------
# CurrentCheckInOrApiKey — wider JWT gate for check-in-accessible routes
# ---------------------------------------------------------------------------


def CurrentCheckInOrApiKey(scope: ApiKeyScope):
    """Like CurrentAdminOrApiKey but also accepts CHECK_IN_CONTROLLER JWTs.

    Used for routes that scanners (check-in controllers) need read access to
    (e.g. GET /attendees) but that must still accept admin api-keys with the
    appropriate scope on the api-key path.
    """

    def _dep(
        token_payload: Annotated[TokenPayload, Depends(get_token_payload)],
        db: "SessionDep",
    ) -> "UserPublic":
        if token_payload.token_type != "user":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This endpoint requires an admin session or an admin API key.",
            )

        if not token_payload.via_api_key:
            user = fetch_authenticated_user(
                token_payload, db, require_token_type="user"
            )
            if user.role not in (
                UserRole.SUPERADMIN,
                UserRole.ADMIN,
                UserRole.OPERATOR,
                UserRole.CHECK_IN_CONTROLLER,
            ):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Admin access required.",
                )
            return user

        # Api-key path: enforce scope.
        if scope not in token_payload.scopes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"API key lacks required scope: {scope}",
            )
        return fetch_authenticated_user(token_payload, db, require_token_type="user")

    return _dep


def get_check_in_or_api_key_tenant_session(scope: ApiKeyScope):
    """Tenant session factory paired with CurrentCheckInOrApiKey."""

    def _dep(
        current_user: Annotated["UserPublic", Depends(CurrentCheckInOrApiKey(scope))],
        token_payload: Annotated[TokenPayload, Depends(get_token_payload)],
        db: "SessionDep",
        x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
    ) -> Generator[Session]:
        if token_payload.via_api_key:
            from app.api.shared.enums import CredentialType
            from app.core.tenant_db import tenant_connection_manager

            tenant_id = token_payload.api_key_tenant_id
            if tenant_id is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="API key has no tenant context.",
                )

            cached_cred = tenant_connection_manager.get_credential(
                db, tenant_id, CredentialType.CRUD
            )
            if not cached_cred:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Tenant credentials not configured",
                )

            tenant_engine = tenant_connection_manager.get_engine(
                tenant_id,
                CredentialType.CRUD,
                cached_cred.username,
                cached_cred.password,
            )
            with Session(tenant_engine) as tenant_session:
                yield tenant_session
        else:
            yield from get_tenant_session(current_user, db, x_tenant_id)

    return _dep


# ---------------------------------------------------------------------------
# Per-scope Annotated aliases (Block 4, task 4.5)
# Design R-A2: one alias pair per scope in ADMIN_API_KEY_SCOPES (~56 LOC).
# If this module grows past ~400 LOC, split into admin_scopes.py.
# ---------------------------------------------------------------------------

# events
AdminOrApiKey_EventsRead = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("events:read"))
]
AdminOrApiKey_EventsWrite = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("events:write"))
]
AdminOrApiKeySession_EventsRead = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("events:read"))
]
AdminOrApiKeySession_EventsWrite = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("events:write"))
]

# rsvp
AdminOrApiKey_RsvpWrite = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("rsvp:write"))
]
AdminOrApiKeySession_RsvpWrite = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("rsvp:write"))
]

# venues
AdminOrApiKey_VenuesWrite = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("venues:write"))
]
AdminOrApiKeySession_VenuesWrite = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("venues:write"))
]

# applications
AdminOrApiKey_ApplicationsRead = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("applications:read"))
]
AdminOrApiKey_ApplicationsWrite = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("applications:write"))
]
AdminOrApiKeySession_ApplicationsRead = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("applications:read"))
]
AdminOrApiKeySession_ApplicationsWrite = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("applications:write"))
]

# attendees
# Write routes: admin JWT or scoped api-key.
AdminOrApiKey_AttendeesRead = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("attendees:read"))
]
AdminOrApiKey_AttendeesWrite = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("attendees:write"))
]
AdminOrApiKeySession_AttendeesRead = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("attendees:read"))
]
AdminOrApiKeySession_AttendeesWrite = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("attendees:write"))
]
# Read routes with check-in controller access (scanners can list/get attendees).
CheckInOrApiKey_AttendeesRead = Annotated[
    "UserPublic", Depends(CurrentCheckInOrApiKey("attendees:read"))
]
CheckInOrApiKeySession_AttendeesRead = Annotated[
    Session, Depends(get_check_in_or_api_key_tenant_session("attendees:read"))
]

# humans
AdminOrApiKey_HumansRead = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("humans:read"))
]
AdminOrApiKey_HumansWrite = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("humans:write"))
]
AdminOrApiKeySession_HumansRead = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("humans:read"))
]
AdminOrApiKeySession_HumansWrite = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("humans:write"))
]

# groups
AdminOrApiKey_GroupsRead = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("groups:read"))
]
AdminOrApiKey_GroupsWrite = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("groups:write"))
]
AdminOrApiKeySession_GroupsRead = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("groups:read"))
]
AdminOrApiKeySession_GroupsWrite = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("groups:write"))
]

# products
AdminOrApiKey_ProductsRead = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("products:read"))
]
AdminOrApiKey_ProductsWrite = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("products:write"))
]
AdminOrApiKeySession_ProductsRead = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("products:read"))
]
AdminOrApiKeySession_ProductsWrite = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("products:write"))
]

# coupons
AdminOrApiKey_CouponsRead = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("coupons:read"))
]
AdminOrApiKey_CouponsWrite = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("coupons:write"))
]
AdminOrApiKeySession_CouponsRead = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("coupons:read"))
]
AdminOrApiKeySession_CouponsWrite = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("coupons:write"))
]

# forms
AdminOrApiKey_FormsRead = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("forms:read"))
]
AdminOrApiKey_FormsWrite = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("forms:write"))
]
AdminOrApiKeySession_FormsRead = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("forms:read"))
]
AdminOrApiKeySession_FormsWrite = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("forms:write"))
]

# payments (read-only; payments:write is intentionally excluded from the universe)
AdminOrApiKey_PaymentsRead = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("payments:read"))
]
AdminOrApiKeySession_PaymentsRead = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("payments:read"))
]

# tracks
AdminOrApiKey_TracksRead = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("tracks:read"))
]
AdminOrApiKey_TracksWrite = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("tracks:write"))
]
AdminOrApiKeySession_TracksRead = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("tracks:read"))
]
AdminOrApiKeySession_TracksWrite = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("tracks:write"))
]

# ticketing_steps
AdminOrApiKey_TicketingStepsRead = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("ticketing_steps:read"))
]
AdminOrApiKey_TicketingStepsWrite = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("ticketing_steps:write"))
]
AdminOrApiKeySession_TicketingStepsRead = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("ticketing_steps:read"))
]
AdminOrApiKeySession_TicketingStepsWrite = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("ticketing_steps:write"))
]

# translations
AdminOrApiKey_TranslationsRead = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("translations:read"))
]
AdminOrApiKey_TranslationsWrite = Annotated[
    "UserPublic", Depends(CurrentAdminOrApiKey("translations:write"))
]
AdminOrApiKeySession_TranslationsRead = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("translations:read"))
]
AdminOrApiKeySession_TranslationsWrite = Annotated[
    Session, Depends(get_admin_or_api_key_tenant_session("translations:write"))
]


# DRY helper for scope-gated routes. Use directly in the route decorator's
# `dependencies=[...]` list instead of declaring a per-scope Annotated alias:
#
#   @router.get(
#       "/me",
#       summary="Get your profile",
#       dependencies=[needs("portal:profile:read")],
#   )
#   async def get_me(current_human: CurrentHuman, ...) -> HumanPublic: ...
#
# The registry walker (app.api.access.introspection.register_scope_routes)
# auto-discovers each route's scope by inspecting its dependency tree, so
# adding or renaming a scope is a string change at the call site only.
def needs(scope: HumanScope):
    """Return a FastAPI Depends that enforces the given HumanScope."""
    return Depends(require_human_scope(scope))
