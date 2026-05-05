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


def gather_event_recipients(
    db,
    event,
    *,
    occurrence_start: datetime | None = None,
) -> list[dict[str, Any]]:
    """Return attendees for iTIP updates as ``(human, occurrence)`` rows.

    Includes anyone with an ``EventInvitations`` row (series-level, no
    occurrence scoping) plus any active ``EventParticipants`` (status !=
    cancelled). Each participant row keeps its own ``occurrence_start`` so
    the per-recipient ICS can carry a matching ``RECURRENCE-ID`` and
    correlate updates with the calendar entry the user already has.

    The same human can show up multiple times if they RSVPd to several
    occurrences of a recurring series — we want one email per
    (human, occurrence) so each entry on their calendar is updated.
    Invitations and participants for the same human are deduped only when
    their occurrence_start matches.

    When ``occurrence_start`` is provided, the result is restricted to
    participants RSVPd to that exact instance — used by the per-occurrence
    CANCEL flow (skip / detach).
    """
    from sqlmodel import select

    from app.api.event.models import EventInvitations
    from app.api.event_participant.models import EventParticipants
    from app.api.event_participant.schemas import ParticipantStatus
    from app.api.human.models import Humans

    rows: list[dict[str, Any]] = []
    seen: set[tuple[uuid.UUID, datetime | None]] = set()

    if occurrence_start is None:
        invited_rows = list(
            db.exec(
                select(Humans)
                .join(EventInvitations, EventInvitations.human_id == Humans.id)
                .where(EventInvitations.event_id == event.id)
            ).all()
        )
        for h in invited_rows:
            if not h.email:
                continue
            key = (h.id, None)
            if key in seen:
                continue
            seen.add(key)
            rows.append(
                {
                    "human_id": h.id,
                    "email": h.email,
                    "first_name": h.first_name or "",
                    "occurrence_start": None,
                }
            )

    participant_q = (
        select(Humans, EventParticipants.occurrence_start)
        .join(EventParticipants, EventParticipants.profile_id == Humans.id)
        .where(EventParticipants.event_id == event.id)
        .where(EventParticipants.status != ParticipantStatus.CANCELLED)
    )
    if occurrence_start is not None:
        participant_q = participant_q.where(
            EventParticipants.occurrence_start == occurrence_start
        )
    participant_rows = list(db.exec(participant_q).all())
    for h, occ in participant_rows:
        if not h.email:
            continue
        key = (h.id, occ)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "human_id": h.id,
                "email": h.email,
                "first_name": h.first_name or "",
                "occurrence_start": occ,
            }
        )

    return rows


async def send_event_itip(
    db,
    event,
    recipients: list[dict[str, Any]],
    *,
    method: str = "REQUEST",
    occurrence_start: datetime | None = None,
    is_self_rsvp: bool = False,
    is_update: bool = False,
    changes: dict[str, dict[str, str]] | None = None,
) -> None:
    """Send an iTIP REQUEST or CANCEL email to each recipient.

    The ICS is rebuilt per recipient so the ATTENDEE line addresses them
    individually — iTIP requires this for Gmail / Apple Mail / Outlook to
    correlate incoming updates with the original invitation. SEQUENCE is
    read from ``event.ical_sequence``; caller is responsible for bumping
    it before dispatching an update/cancel.

    The per-recipient ``occurrence_start`` (if any) takes precedence over
    the call-level ``occurrence_start`` argument, so a single dispatch can
    fan out per-occurrence updates: each recipient's ICS carries the
    ``RECURRENCE-ID`` matching the instance they originally RSVPd to,
    keeping the master UID stable so calendars patch the existing entry
    in place. The call-level ``occurrence_start`` is the fallback used
    when a recipient row didn't carry one (e.g. one-off send to a single
    address from the RSVP flow, or per-occurrence CANCEL broadcasts).

    When ``is_update`` is true, the email reads as a change notification
    (subject and heading flip to "The event has been updated") and
    ``changes`` is rendered as a before/after diff list à la Google
    Calendar update mails.
    """
    if not recipients:
        return

    if not settings.emails_enabled:
        logger.info("Email disabled; skipping iTIP {} for event {}", method, event.id)
        return

    popup = getattr(event, "popup", None)
    popup_name = popup.name if popup else ""
    popup_slug = getattr(popup, "slug", None) if popup else None
    venue_title = getattr(getattr(event, "venue", None), "title", "") or ""

    event_url = ""
    if popup_slug:
        event_url = (
            f"{settings.PORTAL_URL.rstrip('/')}/portal/{popup_slug}/events/{event.id}"
        )

    service = get_email_service()
    from_address = popup.tenant.sender_email if popup and popup.tenant else None
    from_name = popup.tenant.sender_name if popup and popup.tenant else None
    organizer_name = from_name or popup_name or None

    is_cancelled = method == "CANCEL"
    if is_cancelled:
        subject = f"Event cancelled: {event.title or 'an event'}"
        if popup_name:
            subject += f" — {popup_name}"
    elif is_update:
        subject = f"The event has been updated: {event.title or 'an event'}"
        if popup_name:
            subject += f" — {popup_name}"
    elif is_self_rsvp:
        subject = f"You're in! {event.title or 'an event'}"
        if popup_name:
            subject += f" — {popup_name}"
    else:
        subject = f"You're invited to {event.title or 'an event'}"
        if popup_name:
            subject += f" — {popup_name}"

    for r in recipients:
        # Per-recipient occurrence wins (a recurring-event RSVPer is bound
        # to a specific instance), with the call-level value as fallback.
        recipient_occurrence = r.get("occurrence_start") or occurrence_start
        if recipient_occurrence and event.start_time and event.end_time:
            # For one occurrence of a recurring series, mirror what the ICS
            # does: shift the master duration onto the occurrence start.
            duration = event.end_time - event.start_time
            when = _format_time_range(
                recipient_occurrence, recipient_occurrence + duration
            )
        elif recipient_occurrence:
            when = _format_when(recipient_occurrence)
        else:
            when = _format_time_range(event.start_time, event.end_time)
        context = EventInvitationContext(
            first_name=r["first_name"],
            event_title=event.title or "",
            popup_name=popup_name,
            event_when=when,
            venue_title=venue_title,
            event_url=event_url,
            is_self_rsvp=is_self_rsvp,
            is_update=is_update,
            is_cancelled=is_cancelled,
            changes=changes or {},
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
                occurrence_start=recipient_occurrence,
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
            logger.warning("Failed to send iTIP {} to {}: {}", method, r["email"], exc)


async def bump_and_dispatch_update(
    db,
    event,
    *,
    before: dict | None = None,
) -> None:
    """Increment ``ical_sequence`` and re-send REQUEST to all attendees.

    When ``before`` is supplied, a human-readable diff is rendered into
    the update email body so recipients see *what* changed (Google
    Calendar style), not just that something did.
    """
    event.ical_sequence = int(event.ical_sequence or 0) + 1
    db.add(event)
    db.commit()
    db.refresh(event)
    recipients = gather_event_recipients(db, event)
    changes = summarize_event_changes(db, before, event) if before else {}
    await send_event_itip(
        db,
        event,
        recipients,
        method="REQUEST",
        is_update=True,
        changes=changes,
    )


def _format_when(dt: datetime | None) -> str:
    return dt.strftime("%b %d, %Y at %H:%M") if dt else "—"


def _format_time_range(start: datetime | None, end: datetime | None) -> str:
    """Render a "Mon, May 5, 2026 at 14:00 – 15:00" style time range.

    Falls back to start-only when end is missing or equal to start, and
    expands to a full "<start> – <end-date end-time>" form when the event
    spans multiple days.
    """
    if not start:
        return "—"
    start_str = _format_when(start)
    if not end or end == start:
        return start_str
    if end.date() == start.date():
        return f"{start_str} – {end.strftime('%H:%M')}"
    return f"{start_str} – {_format_when(end)}"


def _venue_name(db, venue_id) -> str:
    if venue_id is None:
        return "—"
    try:
        from app.api.event_venue.models import EventVenues

        venue = db.get(EventVenues, venue_id)
        return (venue.title if venue else None) or "—"
    except Exception:  # pragma: no cover - defensive
        return "—"


def summarize_event_changes(db, before: dict, after) -> dict[str, dict[str, str]]:
    """Return ``{row_key: {before, after}}`` for fields that changed.

    Row keys mirror the rows the email template renders so each diff
    entry can highlight its corresponding row in place:

    - ``event``    → title change
    - ``time``     → start/end change (combined into a single time range)
    - ``location`` → venue change

    Unchanged fields are omitted so the template only highlights what
    actually moved.
    """
    changes: dict[str, dict[str, str]] = {}

    if "title" in before:
        old, new = before.get("title"), getattr(after, "title", None)
        if old != new:
            changes["event"] = {"before": old or "—", "after": new or "—"}

    if "start_time" in before or "end_time" in before:
        old_start = before.get("start_time", getattr(after, "start_time", None))
        old_end = before.get("end_time", getattr(after, "end_time", None))
        new_start = getattr(after, "start_time", None)
        new_end = getattr(after, "end_time", None)
        if old_start != new_start or old_end != new_end:
            changes["time"] = {
                "before": _format_time_range(old_start, old_end),
                "after": _format_time_range(new_start, new_end),
            }

    if "venue_id" in before:
        old, new = before.get("venue_id"), getattr(after, "venue_id", None)
        if old != new:
            changes["location"] = {
                "before": _venue_name(db, old),
                "after": _venue_name(db, new),
            }

    return changes


async def bump_and_dispatch_cancel(
    db,
    event,
    *,
    occurrence_start: datetime | None = None,
) -> None:
    """Increment ``ical_sequence`` and broadcast CANCEL to attendees.

    When ``occurrence_start`` is provided, only RSVPers bound to that
    specific instance are notified, and the per-recipient ICS carries a
    matching ``RECURRENCE-ID`` so calendars remove just that instance
    instead of the whole series. Used by the skip / detach flows.
    """
    event.ical_sequence = int(event.ical_sequence or 0) + 1
    db.add(event)
    db.commit()
    db.refresh(event)
    recipients = gather_event_recipients(db, event, occurrence_start=occurrence_start)
    await send_event_itip(
        db,
        event,
        recipients,
        method="CANCEL",
        occurrence_start=occurrence_start,
    )


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
    is_self_rsvp: bool = False,
) -> None:
    """Convenience wrapper: send a single iTIP email (e.g. RSVP confirmation).

    Does NOT bump SEQUENCE — RSVPing or cancelling your own participation
    doesn't change the event itself, we're just (re-)delivering the
    current invitation to one person.

    ``occurrence_start`` shifts the calendar entry to a specific occurrence
    of a recurring event (used by the portal RSVP flow).

    ``is_self_rsvp`` flips the email copy from organiser-style invitation
    ("You're invited") to attendee-side confirmation ("You're in!").
    """
    await send_event_itip(
        db,
        event,
        [
            {
                "email": email,
                "first_name": first_name,
                "human_id": human_id,
                "occurrence_start": occurrence_start,
            }
        ],
        method=method,
        occurrence_start=occurrence_start,
        is_self_rsvp=is_self_rsvp,
    )
