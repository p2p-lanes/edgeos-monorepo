"""Portal endpoints for Google Calendar OAuth connect / disconnect / status.

Human-token only — staff users don't need personal calendar sync.

When the server is not configured (no GOOGLE_OAUTH_* env vars), every
endpoint responds with 501 Not Implemented so the portal can show a
clear "not configured" state while other events features keep working.
"""

import secrets
import uuid

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from loguru import logger
from sqlmodel import select

from app.api.google_calendar import service
from app.api.google_calendar.models import HumanGoogleCredentials
from app.api.google_calendar.schemas import (
    GoogleAuthUrlResponse,
    GoogleConnectionStatus,
)
from app.core.config import settings
from app.core.dependencies.users import (
    CurrentHuman,
    HumanTenantSession,
    SessionDep,
)

router = APIRouter(
    prefix="/portal/google-calendar",
    tags=["google-calendar"],
)


# State tokens are short-lived UUIDs. We store them in-process (bytes) —
# not persisted across restarts, but good enough for a one-way-hop OAuth
# flow. State carries no private data and is only validated on callback.
_PENDING_STATES: dict[str, uuid.UUID] = {}


def _require_configured() -> None:
    if not service.is_configured():
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Google Calendar integration is not configured on this server.",
        )


@router.get("/auth-url", response_model=GoogleAuthUrlResponse)
async def get_auth_url(
    current_human: CurrentHuman,
) -> GoogleAuthUrlResponse:
    """Return the URL to redirect the user to for the consent screen."""
    _require_configured()

    state = secrets.token_urlsafe(24)
    _PENDING_STATES[state] = current_human.id

    # Best-effort cap so the dict doesn't grow unbounded in dev.
    if len(_PENDING_STATES) > 512:
        # Drop an arbitrary oldest entry.
        _PENDING_STATES.pop(next(iter(_PENDING_STATES)))

    return GoogleAuthUrlResponse(
        url=service.build_auth_url(state=state),
        state=state,
    )


@router.get("/oauth-callback")
async def oauth_callback(
    db: SessionDep,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
) -> RedirectResponse:
    """Handle the redirect from Google.

    Exchanges the code for tokens, persists them, then redirects the user
    back to the portal events page with a query flag so the UI can toast.
    Uses a cookie-less flow: the ``state`` param we generated on /auth-url
    identifies the human.
    """
    portal_base = settings.PORTAL_URL.rstrip("/")
    events_url = f"{portal_base}/portal"  # fallback to the portal landing

    if error:
        logger.warning("GCal oauth callback error: {}", error)
        return RedirectResponse(
            url=f"{events_url}?gcal=error&reason={error}",
            status_code=status.HTTP_302_FOUND,
        )

    if not service.is_configured():
        return RedirectResponse(
            url=f"{events_url}?gcal=not_configured",
            status_code=status.HTTP_302_FOUND,
        )

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")

    human_id = _PENDING_STATES.pop(state, None)
    if human_id is None:
        raise HTTPException(status_code=400, detail="Invalid or expired state")

    try:
        tokens = service.exchange_code_for_tokens(code)
    except Exception as exc:
        logger.error("GCal token exchange failed: {}", exc)
        return RedirectResponse(
            url=f"{events_url}?gcal=error&reason=token_exchange",
            status_code=status.HTTP_302_FOUND,
        )

    from app.api.human.models import Humans

    human = db.exec(select(Humans).where(Humans.id == human_id)).first()
    if not human:
        raise HTTPException(status_code=404, detail="Human not found")

    try:
        service.upsert_credentials(
            db,
            tenant_id=human.tenant_id,
            human_id=human.id,
            token_response=tokens,
        )
    except ValueError as exc:
        logger.warning("GCal credential upsert failed: {}", exc)
        return RedirectResponse(
            url=f"{events_url}?gcal=error&reason=no_refresh_token",
            status_code=status.HTTP_302_FOUND,
        )

    return RedirectResponse(
        url=f"{events_url}?gcal=connected",
        status_code=status.HTTP_302_FOUND,
    )


@router.delete("/connection", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> None:
    """Revoke the human's stored refresh token and mark as disconnected."""
    _require_configured()

    creds = db.exec(
        select(HumanGoogleCredentials).where(
            HumanGoogleCredentials.human_id == current_human.id
        )
    ).first()

    if not creds:
        return

    service.revoke_refresh_token(creds.refresh_token)
    creds.revoked = True
    db.add(creds)
    db.commit()


@router.get("/status", response_model=GoogleConnectionStatus)
async def status_endpoint(
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> GoogleConnectionStatus:
    """Report whether the current human is connected to Google Calendar."""
    configured = service.is_configured()
    if not configured:
        return GoogleConnectionStatus(
            configured=False,
            connected=False,
            calendar_id=None,
            connected_at=None,
        )

    creds = db.exec(
        select(HumanGoogleCredentials).where(
            HumanGoogleCredentials.human_id == current_human.id
        )
    ).first()

    if not creds or creds.revoked:
        return GoogleConnectionStatus(
            configured=True,
            connected=False,
            calendar_id=None,
            connected_at=None,
        )

    return GoogleConnectionStatus(
        configured=True,
        connected=True,
        calendar_id=creds.google_calendar_id,
        connected_at=creds.created_at,
    )
