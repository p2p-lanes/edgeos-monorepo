"""iTIP (RFC 5546) dispatch helpers for event lifecycle emails.

Every entry point is best-effort: we log on failure and swallow the
exception so a broken SMTP never blocks the underlying mutation.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from loguru import logger

from app.core.config import settings
from app.services.email import (
    EventInvitationContext,
    get_email_service,
)
from app.services.ical import build_event_ics


def gather_event_recipients(db, event) -> list[dict[str, Any]]:
    """Return deduped attendees for iTIP updates.

    Includes anyone with an ``EventInvitations`` row plus any active
    ``EventParticipants`` (status != cancelled). Deduped by human id so an
    invitee who also RSVPed receives a single email.
    """
    from sqlmodel import select

    from app.api.event.models import EventInvitations
    from app.api.event_participant.models import EventParticipants
    from app.api.event_participant.schemas import ParticipantStatus
    from app.api.human.models import Humans

    invited_rows = list(
        db.exec(
            select(Humans)
            .join(EventInvitations, EventInvitations.human_id == Humans.id)
            .where(EventInvitations.event_id == event.id)
        ).all()
    )
    participant_rows = list(
        db.exec(
            select(Humans)
            .join(EventParticipants, EventParticipants.profile_id == Humans.id)
            .where(EventParticipants.event_id == event.id)
            .where(EventParticipants.status != ParticipantStatus.CANCELLED)
        ).all()
    )

    by_id: dict[uuid.UUID, Humans] = {}
    for human in [*invited_rows, *participant_rows]:
        if human.id not in by_id:
            by_id[human.id] = human

    return [
        {
            "human_id": h.id,
            "email": h.email,
            "first_name": h.first_name or "",
        }
        for h in by_id.values()
        if h.email
    ]


async def send_event_itip(
    db,
    event,
    recipients: list[dict[str, Any]],
    *,
    method: str = "REQUEST",
    occurrence_start: datetime | None = None,
) -> None:
    """Send an iTIP REQUEST or CANCEL email to each recipient.

    The ICS is rebuilt per recipient so the ATTENDEE line addresses them
    individually — iTIP requires this for Gmail / Apple Mail / Outlook to
    correlate incoming updates with the original invitation. SEQUENCE is
    read from ``event.ical_sequence``; caller is responsible for bumping
    it before dispatching an update/cancel.

    When ``occurrence_start`` is provided, the calendar entry is shifted
    to that single instance (and its UID disambiguated) so recurring-event
    RSVP emails create a one-off calendar appointment on that day instead
    of a series.
    """
    if not recipients:
        return

    if not settings.emails_enabled:
        logger.info(
            "Email disabled; skipping iTIP {} for event {}", method, event.id
        )
        return

    popup = getattr(event, "popup", None)
    popup_name = popup.name if popup else ""
    popup_slug = getattr(popup, "slug", None) if popup else None
    venue_title = getattr(getattr(event, "venue", None), "title", "") or ""

    event_url = ""
    if popup_slug:
        event_url = (
            f"{settings.PORTAL_URL.rstrip('/')}/portal/{popup_slug}/events/"
            f"{event.id}"
        )

    when_dt = occurrence_start or event.start_time
    when = when_dt.strftime("%b %d, %Y at %H:%M") if when_dt else ""

    service = get_email_service()
    from_address = popup.tenant.sender_email if popup and popup.tenant else None
    from_name = popup.tenant.sender_name if popup and popup.tenant else None
    organizer_name = from_name or popup_name or None

    if method == "CANCEL":
        subject = f'Event cancelled: {event.title or "an event"}'
    else:
        subject = f"You're invited to {event.title or 'an event'}"
        if popup_name:
            subject += f" — {popup_name}"

    for r in recipients:
        context = EventInvitationContext(
            first_name=r["first_name"],
            event_title=event.title or "",
            popup_name=popup_name,
            event_when=when,
            venue_title=venue_title,
            event_url=event_url,
        )
        try:
            ics_body = build_event_ics(
                event,
                recipient_email=r["email"],
                recipient_name=r["first_name"] or None,
                organizer_email=from_address,
                organizer_name=organizer_name,
                event_url=event_url or None,
                method=method,
                sequence=int(getattr(event, "ical_sequence", 0)),
                occurrence_start=occurrence_start,
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "Failed to build iTIP body for event {} / {}: {}",
                event.id,
                r["email"],
                exc,
            )
            ics_body = None

        try:
            await service.send_event_invitation(
                to=r["email"],
                subject=subject,
                context=context,
                from_address=from_address,
                from_name=from_name,
                popup_id=event.popup_id,
                db_session=db,
                ical_body=ics_body,
                ical_method=method,
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "Failed to send iTIP {} to {}: {}", method, r["email"], exc
            )


async def bump_and_dispatch_update(db, event) -> None:
    """Increment ``ical_sequence`` and re-send REQUEST to all attendees."""
    event.ical_sequence = int(event.ical_sequence or 0) + 1
    db.add(event)
    db.commit()
    db.refresh(event)
    recipients = gather_event_recipients(db, event)
    await send_event_itip(db, event, recipients, method="REQUEST")


async def bump_and_dispatch_cancel(db, event) -> None:
    """Increment ``ical_sequence`` and broadcast CANCEL to all attendees."""
    event.ical_sequence = int(event.ical_sequence or 0) + 1
    db.add(event)
    db.commit()
    db.refresh(event)
    recipients = gather_event_recipients(db, event)
    await send_event_itip(db, event, recipients, method="CANCEL")


def calendar_fields_changed(before: dict, after) -> bool:
    """True if a change to ``after`` modifies what iTIP clients display.

    ``before`` is a snapshot dict captured before the update; ``after`` is
    the refreshed Events row. We bump SEQUENCE when any of these differ.
    """
    fields = ("title", "start_time", "end_time", "venue_id")
    for f in fields:
        if before.get(f) != getattr(after, f, None):
            return True
    return False


async def send_itip_to_single_recipient(
    db,
    event,
    *,
    email: str,
    first_name: str,
    human_id: uuid.UUID,
    method: str = "REQUEST",
    occurrence_start: datetime | None = None,
) -> None:
    """Convenience wrapper: send a single iTIP email (e.g. RSVP confirmation).

    Does NOT bump SEQUENCE — RSVPing or cancelling your own participation
    doesn't change the event itself, we're just (re-)delivering the
    current invitation to one person.

    ``occurrence_start`` shifts the calendar entry to a specific occurrence
    of a recurring event (used by the portal RSVP flow).
    """
    await send_event_itip(
        db,
        event,
        [{"email": email, "first_name": first_name, "human_id": human_id}],
        method=method,
        occurrence_start=occurrence_start,
    )
