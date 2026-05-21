"""Self-discovery endpoints: GET /me/access and GET /me/access/docs.

Only third-party JWTs may call these endpoints:
  - v2: issued_by_app_id is set (any value)
  - legacy v1: issued_via == "third_party" and issued_by_app_id is None

Any other JWT type (portal, admin/user) receives 401.

NOTE: do NOT add `from __future__ import annotations` to this file.
FastAPI resolves Annotated[..., Depends(...)] at runtime; string-based
annotations (PEP 563) cause Depends to be seen as a string literal and
break dependency injection, making required parameters appear as 422 errors.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import PlainTextResponse

from app.api.access.introspection import SCOPE_ROUTES_REGISTRY
from app.api.access.markdown import render_access_docs_markdown
from app.api.access.schemas import MeAccess
from app.core.dependencies.users import SessionDep  # noqa: E402
from app.core.security import (  # noqa: E402
    THIRD_PARTY_API_KEY_SCOPES_MAX,
    TokenPayload,
    get_token_payload,
)

router = APIRouter(prefix="/me/access", tags=["me-access"])


# ---------------------------------------------------------------------------
# Auth gate — third-party JWTs only
# ---------------------------------------------------------------------------


def _require_third_party_session(
    token_payload: Annotated[TokenPayload, Depends(get_token_payload)],
) -> TokenPayload:
    """Accept v2 third-party JWTs (issued_by_app_id set) or legacy v1 JWTs.

    LEGACY-V1-FALLBACK — remove >=30d after deploy.
    """
    if token_payload.issued_by_app_id is not None:
        return token_payload
    if token_payload.issued_via == "third_party" and token_payload.token_type == "human":
        return token_payload
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="This endpoint is only available for third-party sessions.",
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


@router.get("", response_model=MeAccess, summary="Get caller app access info")
async def get_me_access(
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
async def get_me_access_docs(
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
