"""Third-party self-discovery endpoints under /third-party-apps/.

Three routes, all dual-auth (accept either a third-party JWT or the raw
X-Third-Party-Api-Key header for pre-login discovery):
  - GET /third-party-apps/whoami       — app metadata + scope universe
  - GET /third-party-apps/docs         — endpoint catalog (json or markdown)
  - GET /third-party-apps/openapi.json — filtered OpenAPI 3.x spec

JWT path requires either v2 (issued_by_app_id set) or legacy v1
(issued_via == "third_party"). Any other JWT type (portal, admin/user)
receives 401.

NOTE: do NOT add `from __future__ import annotations` to this file.
FastAPI resolves Annotated[..., Depends(...)] at runtime; string-based
annotations (PEP 563) cause Depends to be seen as a string literal and
break dependency injection, making required parameters appear as 422 errors.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import PlainTextResponse
from fastapi.security import OAuth2PasswordBearer

from app.api.access.introspection import SCOPE_ROUTES_REGISTRY
from app.api.access.markdown import render_access_docs_markdown
from app.api.access.schemas import MeAccess
from app.core.dependencies.users import SessionDep  # noqa: E402
from app.core.security import (  # noqa: E402
    _PAT_ROUTE_POLICIES,
    THIRD_PARTY_API_KEY_SCOPES_MAX,
    TokenPayload,
)

router = APIRouter(prefix="/third-party-apps", tags=["third-party-discovery"])

# Optional JWT scheme: returns None instead of 401 when Authorization is absent,
# so the dependency can fall back to the api-key header path for pre-login
# discovery flows.
_optional_oauth2 = OAuth2PasswordBearer(
    tokenUrl="/v1/auth/user/authenticate", auto_error=False
)


# ---------------------------------------------------------------------------
# Auth gate — third-party JWTs OR raw third-party api key
# ---------------------------------------------------------------------------
#
# Two auth paths are accepted so an agent can call these endpoints both
# pre-login (with only the third-party api key) and post-login (with the
# JWT). The api-key path returns the app's capabilities — what a human
# WOULD get if they logged in via this app — so discovery of the auth flow
# and the available scopes is possible before any OTP exchange happens.


def _require_third_party_session(
    db: SessionDep,
    token: Annotated[str | None, Depends(_optional_oauth2)] = None,
    x_third_party_api_key: Annotated[
        str | None, Header(alias="X-Third-Party-Api-Key")
    ] = None,
) -> TokenPayload:
    """Resolve a third-party identity from either a JWT or the raw api key.

    Resolution order:
      1. JWT present → must be a third-party JWT (v2 by ``issued_by_app_id``
         or legacy v1 by ``issued_via=='third_party'``).
      2. No JWT but ``X-Third-Party-Api-Key`` present → look up the app row
         and synthesise a TokenPayload with the app's scopes so the
         downstream handler can treat both paths uniformly.
      3. Neither → 401.

    LEGACY-V1-FALLBACK — the JWT-without-app branch can be removed >=30d
    after deploy.
    """
    # Path 1 — JWT path
    if token:
        from app.core.security import decode_access_token

        try:
            payload = decode_access_token(token)
        except HTTPException:
            raise
        if payload.issued_by_app_id is not None:
            return payload
        if payload.issued_via == "third_party" and payload.token_type == "human":
            return payload
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This endpoint is only available for third-party sessions.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Path 2 — raw api key path (pre-login discovery)
    if x_third_party_api_key:
        from app.api.third_party_app.crud import validate_third_party_key

        _tenant, app = validate_third_party_key(db, x_third_party_api_key)
        return TokenPayload(
            sub=str(app.tenant_id),
            exp=app.created_at,
            token_type="third_party_app",
            issued_via="third_party",
            issued_by_app_id=app.id,
            scopes=list(app.allowed_token_scopes),
        )

    # Path 3 — no credentials
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=(
            "Provide either a third-party JWT (Authorization: Bearer ...) or "
            "the raw app key (X-Third-Party-Api-Key)."
        ),
        headers={"WWW-Authenticate": "Bearer"},
    )


ThirdPartySession = Annotated[TokenPayload, Depends(_require_third_party_session)]


# ---------------------------------------------------------------------------
# Helper — resolve MeAccess from a validated payload
# ---------------------------------------------------------------------------


def _resolve_me_access(payload: TokenPayload, db: SessionDep) -> MeAccess:
    """Build MeAccess from the caller's token payload.

    v2 path: look up the ThirdPartyApps row by issued_by_app_id.
    Legacy path: use the JWT's embedded scopes.
    """
    if payload.issued_by_app_id is not None:
        from app.api.third_party_app.crud import get_for_authorization

        app = get_for_authorization(db, payload.issued_by_app_id)
        if app is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Third-party app no longer authorized.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return MeAccess(
            app_name=app.name,
            scopes=list(app.allowed_token_scopes),
            api_key_scopes=list(app.allowed_api_key_scopes),
        )
    # LEGACY-V1-FALLBACK — remove >=30d after deploy.
    return MeAccess(
        app_name="legacy",
        scopes=list(payload.scopes),
        api_key_scopes=sorted(THIRD_PARTY_API_KEY_SCOPES_MAX),
    )


# ---------------------------------------------------------------------------
# GET /me/access
# ---------------------------------------------------------------------------


@router.get("/whoami", response_model=MeAccess, summary="Get caller app access info")
async def get_third_party_whoami(
    payload: ThirdPartySession,
    db: SessionDep,
) -> MeAccess:
    """Return the caller's app name, token scopes, and api-key scopes.

    For v2 third-party JWTs (issued_by_app_id set): reads from ThirdPartyApps row.
    For legacy v1 JWTs (issued_via=third_party, no issued_by_app_id): returns
    embedded JWT scopes with platform MAX api-key ceiling.
    """
    return _resolve_me_access(payload, db)


# ---------------------------------------------------------------------------
# GET /me/access/docs
# ---------------------------------------------------------------------------


@router.get("/docs", response_model=None, summary="Get caller scope documentation")
async def get_third_party_docs(
    payload: ThirdPartySession,
    db: SessionDep,
    format: Literal["json", "markdown"] = "json",
):
    """Return endpoint documentation for the caller's held scopes.

    ?format=json (default): JSON list of {scope, endpoints}.
    ?format=markdown: Markdown document with scope sections.
    """
    me = _resolve_me_access(payload, db)
    held_scopes = set(me.scopes)

    filtered: dict[str, list] = {
        s: SCOPE_ROUTES_REGISTRY.get(s, []) for s in held_scopes
    }

    if format == "markdown":
        return PlainTextResponse(
            render_access_docs_markdown(me, filtered),
            media_type="text/markdown; charset=utf-8",
        )

    # JSON: list of {scope, endpoints} entries
    return [
        {
            "scope": scope,
            "endpoints": [
                {"method": r.method, "path": r.path, "summary": r.summary}
                for r in routes
            ],
        }
        for scope, routes in sorted(filtered.items())
    ]


# ---------------------------------------------------------------------------
# GET /third-party-apps/openapi.json — filtered OpenAPI 3.x spec
# ---------------------------------------------------------------------------


# Endpoints that are always part of the third-party surface (auth + discovery)
# regardless of the caller's scope set. (method, path) pairs use the full
# /api/v1 prefix since that is how FastAPI emits paths in openapi().
_ALWAYS_ALLOWED_THIRD_PARTY: frozenset[tuple[str, str]] = frozenset(
    {
        ("post", "/api/v1/auth/human/third-party/login"),
        ("post", "/api/v1/auth/human/third-party/authenticate"),
        ("get", "/api/v1/third-party-apps/whoami"),
        ("get", "/api/v1/third-party-apps/docs"),
        ("get", "/api/v1/third-party-apps/openapi.json"),
    }
)


def _build_accessible_surface(
    me: MeAccess,
) -> tuple[frozenset[tuple[str, str]], tuple[tuple[str, bool, str], ...]]:
    """Return (exact_pairs, prefix_rules) describing which (method, path) the
    caller can reach.

    exact_pairs: (lowercased_method, path) covering the always-allowed
        surface and the token-scope routes from SCOPE_ROUTES_REGISTRY.
    prefix_rules: (lowercased_method, exact_match, path_prefix) covering the
        api-key routes from _PAT_ROUTE_POLICIES that any of the caller's
        api_key_scopes can reach.
    """
    exact: set[tuple[str, str]] = set(_ALWAYS_ALLOWED_THIRD_PARTY)

    for scope in me.scopes:
        for r in SCOPE_ROUTES_REGISTRY.get(scope, []):
            exact.add((r.method.lower(), r.path))

    prefix_rules: list[tuple[str, bool, str]] = []
    api_key_scope_set = set(me.api_key_scopes)
    for method, entries in _PAT_ROUTE_POLICIES.items():
        for path_prefix, exact_match, scopes in entries:
            if any(s in api_key_scope_set for s in scopes):
                prefix_rules.append((method.lower(), exact_match, path_prefix))

    return frozenset(exact), tuple(prefix_rules)


def _path_accessible(
    method: str,
    path: str,
    exact: frozenset[tuple[str, str]],
    prefix_rules: tuple[tuple[str, bool, str], ...],
) -> bool:
    m = method.lower()
    if (m, path) in exact:
        return True
    for pm, exact_match, prefix in prefix_rules:
        if pm != m:
            continue
        if path == prefix if exact_match else path.startswith(prefix):
            return True
    return False


@router.get(
    "/openapi.json",
    summary="Filtered OpenAPI 3.x spec for the caller's third-party surface",
)
async def get_third_party_openapi(
    request: Request,
    payload: ThirdPartySession,
    db: SessionDep,
) -> dict:
    """Return a curated OpenAPI spec scoped to what the caller can use.

    Includes the auth + discovery endpoints, plus every route reachable
    through the caller's token scopes (held by the JWT or granted by the
    app when the api-key auth path is used) and the api-key scopes the
    app allows to be minted. Admin and internal routes are omitted.

    Useful as the agent's entrypoint for SDK generation, Postman
    collections, or LLM prompt context — the agent gets a same-shape
    OpenAPI document but only with routes it can actually call.
    """
    me = _resolve_me_access(payload, db)
    exact, prefix_rules = _build_accessible_surface(me)

    full_spec = request.app.openapi()
    filtered_paths: dict[str, dict] = {}
    for path, methods in full_spec.get("paths", {}).items():
        for method, op in methods.items():
            if _path_accessible(method, path, exact, prefix_rules):
                filtered_paths.setdefault(path, {})[method] = op

    info = dict(full_spec.get("info", {}))
    info["title"] = f"{info.get('title', 'API')} (third-party)"
    info["description"] = (
        "Curated OpenAPI spec scoped to your third-party app's access. "
        "Includes auth, discovery, and the routes your token and api-key "
        "scopes grant. Admin and internal routes are omitted."
    )

    return {
        **full_spec,
        "info": info,
        "paths": filtered_paths,
    }
