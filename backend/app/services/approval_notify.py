"""Email notifications to admins about pending approval submissions.

We deliberately keep this dead-simple — a plain HTML snippet with the
relevant links. Moving to a templated email system makes sense once the
product wants branded styling or per-tenant localization.
"""
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from loguru import logger

from app.core.config import settings as app_settings
from app.services.email import get_email_service

if TYPE_CHECKING:
    from app.api.event.models import Events
    from app.api.event_venue.models import EventVenues
    from app.api.popup.models import Popups


def _resolve_admin_recipient(
    settings, popup: Popups | None
) -> tuple[str | None, str | None, str | None]:
    """Return ``(email, from_address, from_name)`` for the approval email.

    Prefers ``EventSettings.approval_notification_email``; falls back to
    the tenant's ``contact_email``. Returns ``(None, _, _)`` if nothing is
    configured — caller should skip the send.
    """
    to = settings.approval_notification_email if settings else None
    if not to and popup and popup.tenant:
        to = getattr(popup.tenant, "contact_email", None) or getattr(
            popup.tenant, "sender_email", None
        )
    from_address = (
        popup.tenant.sender_email if popup and popup.tenant else None
    )
    from_name = popup.tenant.sender_name if popup and popup.tenant else None
    return to, from_address, from_name


async def notify_event_pending_approval(
    event: Events,
    popup: Popups | None,
    settings,
    *,
    reason: str = "This event requires approval.",
) -> None:
    to, from_address, from_name = _resolve_admin_recipient(settings, popup)
    if not to:
        logger.info(
            "No approval_notification_email for popup {}, skipping event "
            "approval notice",
            event.popup_id,
        )
        return
    popup_name = popup.name if popup else "event"
    subject = f"[{popup_name}] Event pending approval: {event.title}"
    review_url = (
        f"{app_settings.BACKOFFICE_URL.rstrip('/')}/events/{event.id}/edit"
    )
    html = (
        f"<p>A new event has been submitted and is pending approval.</p>"
        f"<ul>"
        f"<li><b>Title:</b> {event.title}</li>"
        f"<li><b>When:</b> {event.start_time.isoformat()} "
        f"→ {event.end_time.isoformat()}</li>"
        f"<li><b>Reason:</b> {reason}</li>"
        f"<li><b>Event ID:</b> {event.id}</li>"
        f"</ul>"
        f'<p><a href="{review_url}">Review in backoffice →</a></p>'
    )
    try:
        await get_email_service().send_email(
            to=to,
            subject=subject,
            html_content=html,
            from_address=from_address,
            from_name=from_name,
        )
        logger.info(
            "Sent event approval notice to {} for event {} ({})",
            to,
            event.id,
            reason,
        )
    except Exception as exc:  # pragma: no cover - best-effort
        logger.warning(
            "Failed to send event approval notice to {} for event {}: {}",
            to,
            event.id,
            exc,
        )


async def notify_venue_pending_approval(
    venue: EventVenues,
    popup: Popups | None,
    settings,
) -> None:
    to, from_address, from_name = _resolve_admin_recipient(settings, popup)
    if not to:
        return
    popup_name = popup.name if popup else "venue"
    subject = f"[{popup_name}] Venue pending approval: {venue.title}"
    review_url = (
        f"{app_settings.BACKOFFICE_URL.rstrip('/')}"
        f"/events/venues/{venue.id}/edit"
    )
    html = (
        f"<p>A new venue has been submitted and is pending approval.</p>"
        f"<ul>"
        f"<li><b>Title:</b> {venue.title}</li>"
        f"<li><b>Location:</b> {venue.location or ''}</li>"
        f"<li><b>Venue ID:</b> {venue.id}</li>"
        f"</ul>"
        f'<p><a href="{review_url}">Review in backoffice →</a></p>'
    )
    try:
        await get_email_service().send_email(
            to=to,
            subject=subject,
            html_content=html,
            from_address=from_address,
            from_name=from_name,
        )
        logger.info(
            "Sent venue approval notice to {} for venue {}", to, venue.id
        )
    except Exception as exc:  # pragma: no cover
        logger.warning(
            "Failed to send venue approval notice to {} for venue {}: {}",
            to,
            venue.id,
            exc,
        )


__all__ = [
    "notify_event_pending_approval",
    "notify_venue_pending_approval",
]

# Keep linters calm about unused import
_ = uuid
