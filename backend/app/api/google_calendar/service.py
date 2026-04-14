"""Google Calendar OAuth + one-way sync service.

Design notes
------------
- One-way push: EdgeOS events are mirrored into the human's personal
  Google Calendar. We do not pull changes back. If the human edits the
  gcal copy, the next EdgeOS update will overwrite it (Google's ``patch``
  semantics merge, but our payload is the full canonical body).
- Token storage: we persist the refresh_token and refresh on demand.
  access_token may be stale; google-auth refreshes automatically through
  the ``Credentials`` object when it exposes a refresh_token + client
  credentials.
- Best-effort: every public entry point is wrapped at the caller site in
  try/except — these helpers raise on programming errors but callers
  must never block user flows on calendar failures.
- Config: if env vars are missing, ``is_configured()`` returns False and
  every helper is a no-op.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from loguru import logger
from sqlmodel import Session, select

from app.api.google_calendar.models import (
    EventGcalSync,
    HumanGoogleCredentials,
)
from app.core.config import settings

# Scopes we request from the user. Read-only is not useful — we need insert/patch.
GOOGLE_CALENDAR_SCOPES: list[str] = [
    "https://www.googleapis.com/auth/calendar.events",
    "openid",
    "email",
]

# Token endpoints
GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"


_WARNED_NOT_CONFIGURED = False


def is_configured() -> bool:
    """Return True iff GCal OAuth env vars are present."""
    return bool(settings.google_calendar_enabled)


def _warn_once_not_configured() -> None:
    """Emit a single info-level log when GCal is disabled."""
    global _WARNED_NOT_CONFIGURED
    if not _WARNED_NOT_CONFIGURED:
        logger.info(
            "Google Calendar sync is not configured (GOOGLE_OAUTH_* env vars "
            "missing); RSVPs will not push to Google Calendar."
        )
        _WARNED_NOT_CONFIGURED = True


# ---------------------------------------------------------------------------
# Calendar client protocol — service methods use a narrow interface so tests
# can inject a fake with the same shape as the Google API client.
# ---------------------------------------------------------------------------


class CalendarClient(Protocol):
    def insert_event(
        self, calendar_id: str, body: dict[str, Any]
    ) -> dict[str, Any]: ...

    def patch_event(
        self, calendar_id: str, event_id: str, body: dict[str, Any]
    ) -> dict[str, Any]: ...

    def delete_event(self, calendar_id: str, event_id: str) -> None: ...


class GoogleCalendarClient:
    """Thin wrapper around the googleapiclient events resource.

    We instantiate one per call to pick up the freshest credentials.
    """

    def __init__(self, credentials: Any) -> None:
        # Imported lazily so the module loads even when google libs are absent
        from googleapiclient.discovery import build  # type: ignore[import-not-found]

        self._service = build("calendar", "v3", credentials=credentials, cache_discovery=False)

    def insert_event(
        self, calendar_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        return (
            self._service.events()
            .insert(calendarId=calendar_id, body=body)
            .execute()
        )

    def patch_event(
        self, calendar_id: str, event_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        return (
            self._service.events()
            .patch(calendarId=calendar_id, eventId=event_id, body=body)
            .execute()
        )

    def delete_event(self, calendar_id: str, event_id: str) -> None:
        self._service.events().delete(
            calendarId=calendar_id, eventId=event_id
        ).execute()


# ---------------------------------------------------------------------------
# OAuth URL construction & token exchange (manual — avoids pulling in a
# Flask server dependency on google-auth-oauthlib's installed flow helper).
# ---------------------------------------------------------------------------


def build_auth_url(state: str) -> str:
    """Return the URL to redirect the human to for the consent screen."""
    from urllib.parse import urlencode

    params = {
        "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(GOOGLE_CALENDAR_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{GOOGLE_AUTHORIZE_URL}?{urlencode(params)}"


def exchange_code_for_tokens(code: str) -> dict[str, Any]:
    """Exchange an authorization code for access + refresh tokens."""
    import httpx

    resp = httpx.post(
        GOOGLE_TOKEN_URL,
        data={
            "code": code,
            "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
            "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
            "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
            "grant_type": "authorization_code",
        },
        timeout=10.0,
    )
    resp.raise_for_status()
    return resp.json()


def revoke_refresh_token(refresh_token: str) -> None:
    """Revoke a refresh token with Google (best-effort)."""
    import httpx

    try:
        httpx.post(
            GOOGLE_REVOKE_URL,
            params={"token": refresh_token},
            timeout=5.0,
        )
    except Exception as exc:  # pragma: no cover - network path
        logger.warning("Failed to revoke Google token: {}", exc)


# ---------------------------------------------------------------------------
# Credential persistence
# ---------------------------------------------------------------------------


def upsert_credentials(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    human_id: uuid.UUID,
    token_response: dict[str, Any],
) -> HumanGoogleCredentials:
    """Insert or update a human's stored GCal credentials from a token response."""
    refresh_token = token_response.get("refresh_token")
    access_token = token_response.get("access_token")
    expires_in = token_response.get("expires_in")
    scope = token_response.get("scope")

    existing = db.exec(
        select(HumanGoogleCredentials).where(
            HumanGoogleCredentials.human_id == human_id
        )
    ).first()

    expiry: datetime | None = None
    if expires_in:
        expiry = datetime.now(UTC) + timedelta(seconds=int(expires_in))

    if existing:
        existing.access_token = access_token or existing.access_token
        # Google only returns refresh_token on first consent unless prompt=consent,
        # which we set — but keep defensively fallback to the old one.
        if refresh_token:
            existing.refresh_token = refresh_token
        existing.token_expiry = expiry or existing.token_expiry
        existing.scope = scope or existing.scope
        existing.revoked = False
        existing.updated_at = datetime.now(UTC)
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing

    if not refresh_token:
        # First-time connect without a refresh token means the user previously
        # granted but we lost state; raise a descriptive error.
        raise ValueError(
            "Google did not return a refresh_token. Ensure prompt=consent is "
            "set and that the user has not previously granted access with a "
            "non-offline flow."
        )

    creds = HumanGoogleCredentials(
        tenant_id=tenant_id,
        human_id=human_id,
        access_token=access_token,
        refresh_token=refresh_token,
        token_expiry=expiry,
        scope=scope,
    )
    db.add(creds)
    db.commit()
    db.refresh(creds)
    return creds


def get_credentials(
    db: Session, human_id: uuid.UUID
) -> HumanGoogleCredentials | None:
    creds = db.exec(
        select(HumanGoogleCredentials).where(
            HumanGoogleCredentials.human_id == human_id
        )
    ).first()
    if creds and creds.revoked:
        return None
    return creds


def _build_google_credentials(creds: HumanGoogleCredentials) -> Any:
    """Turn our stored credentials into a google-auth Credentials object."""
    from google.oauth2.credentials import Credentials  # type: ignore[import-not-found]

    return Credentials(
        token=creds.access_token,
        refresh_token=creds.refresh_token,
        token_uri=GOOGLE_TOKEN_URL,
        client_id=settings.GOOGLE_OAUTH_CLIENT_ID,
        client_secret=settings.GOOGLE_OAUTH_CLIENT_SECRET,
        scopes=GOOGLE_CALENDAR_SCOPES,
    )


def _persist_refreshed_token(
    db: Session, creds_row: HumanGoogleCredentials, google_creds: Any
) -> None:
    """Copy token/expiry back from a refreshed google-auth Credentials."""
    creds_row.access_token = google_creds.token
    if google_creds.expiry is not None:
        # google-auth stores a naive UTC datetime.
        expiry = google_creds.expiry
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=UTC)
        creds_row.token_expiry = expiry
    creds_row.updated_at = datetime.now(UTC)
    db.add(creds_row)
    db.commit()
    db.refresh(creds_row)


def _get_calendar_client(
    db: Session, creds_row: HumanGoogleCredentials
) -> CalendarClient:
    """Build a live CalendarClient, refreshing the access token if needed."""
    from google.auth.transport.requests import Request  # type: ignore[import-not-found]

    google_creds = _build_google_credentials(creds_row)
    try:
        if not google_creds.valid:
            google_creds.refresh(Request())
            _persist_refreshed_token(db, creds_row, google_creds)
    except Exception as exc:
        logger.warning(
            "GCal token refresh failed for human {}: {}", creds_row.human_id, exc
        )
        raise

    return GoogleCalendarClient(google_creds)


# ---------------------------------------------------------------------------
# Event -> Google payload
# ---------------------------------------------------------------------------


def _event_to_gcal_body(event: Any) -> dict[str, Any]:
    """Translate an Events row into a Google Calendar event payload."""
    body: dict[str, Any] = {
        "summary": event.title or "",
        "description": event.content or "",
        "start": {
            "dateTime": event.start_time.isoformat(),
            "timeZone": event.timezone or "UTC",
        },
        "end": {
            "dateTime": event.end_time.isoformat(),
            "timeZone": event.timezone or "UTC",
        },
    }
    if event.meeting_url:
        body["location"] = event.meeting_url
    # Mark as cancelled via ``status`` so Google shows it struck through.
    if str(getattr(event, "status", "")) in {"cancelled", "EventStatus.CANCELLED"}:
        body["status"] = "cancelled"
    return body


# ---------------------------------------------------------------------------
# Public sync API — callable from hooks. All raise on internal errors; hook
# sites wrap in try/except and must never block the HTTP request.
# ---------------------------------------------------------------------------


def sync_event_to_human(
    db: Session,
    event: Any,
    human_id: uuid.UUID,
    *,
    client: CalendarClient | None = None,
) -> EventGcalSync | None:
    """Create or update the gcal mirror of ``event`` for ``human_id``.

    - If the human is not connected, or GCal is not configured, returns None.
    - Otherwise, inserts (first time) or patches (subsequent) the gcal event
      and upserts the ``event_gcal_sync`` row.
    - ``client`` is injectable for tests.
    """
    if not is_configured():
        _warn_once_not_configured()
        return None

    creds = get_credentials(db, human_id)
    if not creds:
        # Not connected — silently no-op (common case).
        return None

    if client is None:
        client = _get_calendar_client(db, creds)

    body = _event_to_gcal_body(event)
    sync_row = db.exec(
        select(EventGcalSync)
        .where(EventGcalSync.event_id == event.id)
        .where(EventGcalSync.human_id == human_id)
    ).first()

    if sync_row is None:
        gcal_event = client.insert_event(creds.google_calendar_id, body)
        sync_row = EventGcalSync(
            tenant_id=event.tenant_id,
            event_id=event.id,
            human_id=human_id,
            gcal_event_id=gcal_event["id"],
            etag=gcal_event.get("etag"),
            last_synced_at=datetime.now(UTC),
        )
        db.add(sync_row)
        db.commit()
        db.refresh(sync_row)
        return sync_row

    gcal_event = client.patch_event(
        creds.google_calendar_id, sync_row.gcal_event_id, body
    )
    sync_row.etag = gcal_event.get("etag") or sync_row.etag
    sync_row.last_synced_at = datetime.now(UTC)
    db.add(sync_row)
    db.commit()
    db.refresh(sync_row)
    return sync_row


def delete_event_for_human(
    db: Session,
    event: Any,
    human_id: uuid.UUID,
    *,
    client: CalendarClient | None = None,
) -> None:
    """Delete the mirrored gcal event for ``(event, human_id)`` if present."""
    if not is_configured():
        _warn_once_not_configured()
        return

    creds = get_credentials(db, human_id)
    if not creds:
        return

    sync_row = db.exec(
        select(EventGcalSync)
        .where(EventGcalSync.event_id == event.id)
        .where(EventGcalSync.human_id == human_id)
    ).first()
    if sync_row is None:
        return

    if client is None:
        try:
            client = _get_calendar_client(db, creds)
        except Exception as exc:
            logger.warning(
                "GCal client build failed while deleting for human {}: {}",
                human_id,
                exc,
            )
            db.delete(sync_row)
            db.commit()
            return

    try:
        client.delete_event(creds.google_calendar_id, sync_row.gcal_event_id)
    except Exception as exc:
        # Already-gone events return 410; treat all deletion errors as
        # non-fatal and remove our mirror row regardless.
        logger.warning(
            "GCal delete failed for human {} event {}: {}",
            human_id,
            event.id,
            exc,
        )

    db.delete(sync_row)
    db.commit()


def sync_event_to_all_participants(db: Session, event: Any) -> None:
    """Propagate an event update to every registered participant's gcal.

    Called from event update / cancel hooks. Best-effort; failures per human
    are swallowed so a bad token for one user does not block the others.
    """
    if not is_configured():
        _warn_once_not_configured()
        return

    from app.api.event_participant.models import EventParticipants
    from app.api.event_participant.schemas import ParticipantStatus

    participants = list(
        db.exec(
            select(EventParticipants)
            .where(EventParticipants.event_id == event.id)
            .where(EventParticipants.status != ParticipantStatus.CANCELLED)
        ).all()
    )
    if not participants:
        return

    # Only sync for participants that are connected. Fetch creds upfront.
    human_ids = [p.profile_id for p in participants]
    connected_humans = set(
        db.exec(
            select(HumanGoogleCredentials.human_id)
            .where(HumanGoogleCredentials.human_id.in_(human_ids))
            .where(HumanGoogleCredentials.revoked == False)  # noqa: E712
        ).all()
    )
    if not connected_humans:
        return

    for p in participants:
        if p.profile_id not in connected_humans:
            continue
        try:
            sync_event_to_human(db, event, p.profile_id)
        except Exception as exc:  # pragma: no cover - best-effort
            logger.warning(
                "GCal sync failed for human {} event {}: {}",
                p.profile_id,
                event.id,
                exc,
            )
