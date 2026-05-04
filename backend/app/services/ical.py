"""iCalendar (RFC 5545 / 5546) generator for event invitation emails.

We use iTIP semantics (METHOD:REQUEST / CANCEL with an ATTENDEE line and a
persisted SEQUENCE) so mail clients such as Gmail, Apple Mail and Outlook
recognise the message as a real calendar invitation — showing inline
RSVP buttons and updating the previously-received event in place instead
of creating a duplicate when the organiser edits it.

Contract with the caller:
- ``uid`` must be stable for an event across its lifetime; we key on it so
  updates collide with the original entry in every target calendar.
- ``sequence`` must monotonically increase whenever a material field of the
  event (title, time, location, cancel) changes. We do not bump it here;
  the caller reads/writes ``events.ical_sequence`` and hands us the
  current value.
- One ICS is generated **per recipient** because the ATTENDEE line
  identifies the target; clients rely on seeing their own address there.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

Method = Literal["REQUEST", "CANCEL"]


def _escape(text: str) -> str:
    """Escape a TEXT value per RFC 5545 section 3.3.11."""
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def _fmt_utc(dt: datetime) -> str:
    """Format a datetime as UTC per RFC 5545 (e.g. 20260505T140000Z)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    else:
        dt = dt.astimezone(UTC)
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _fold(line: str) -> str:
    """Fold long lines to 75 bytes per RFC 5545 section 3.1."""
    if len(line.encode("utf-8")) <= 75:
        return line
    chunks: list[str] = []
    raw = line.encode("utf-8")
    i = 0
    first = True
    while i < len(raw):
        size = 75 if first else 74
        chunk = raw[i : i + size]
        while chunk and (chunk[-1] & 0xC0) == 0x80:
            size -= 1
            chunk = raw[i : i + size]
        chunks.append(chunk.decode("utf-8"))
        i += size
        first = False
    return "\r\n ".join(chunks)


def build_event_ics(
    event: Any,
    *,
    recipient_email: str,
    recipient_name: str | None = None,
    organizer_email: str | None = None,
    organizer_name: str | None = None,
    event_url: str | None = None,
    method: Method = "REQUEST",
    sequence: int | None = None,
    occurrence_start: datetime | None = None,
) -> str:
    """Build an iTIP .ics body for a single event + recipient.

    Accepts the ``Events`` SQLModel (or any object exposing ``.id``,
    ``.title``, ``.start_time``, ``.end_time``, ``.content``,
    ``.updated_at``, ``.ical_sequence``). Venue info is pulled from
    ``event.venue`` when the relationship is loaded.

    ``method`` controls semantics:
    - ``REQUEST``: initial invite or update. Recipient's calendar creates
      or replaces the entry keyed on UID.
    - ``CANCEL``: event was cancelled. Calendar removes the entry.

    ``occurrence_start`` shifts the calendar entry to a specific instance
    of a recurring event: DTSTART/DTEND are recomputed using the master's
    duration, and the UID is suffixed with the occurrence timestamp so
    each instance is a distinct entry in the recipient's calendar.
    """
    title = _escape(getattr(event, "title", "") or "Event")

    description_parts: list[str] = []
    if getattr(event, "content", None):
        description_parts.append(str(event.content))
    if event_url:
        description_parts.append(f"More info: {event_url}")
    description = _escape("\n\n".join(description_parts)) if description_parts else ""

    venue = getattr(event, "venue", None)
    location_bits: list[str] = []
    if venue:
        if getattr(venue, "title", None):
            location_bits.append(venue.title)
        if getattr(venue, "location", None):
            location_bits.append(venue.location)
    location = _escape(" — ".join(location_bits)) if location_bits else ""

    if occurrence_start is not None:
        master_duration = event.end_time - event.start_time
        effective_start = occurrence_start
        effective_end = occurrence_start + master_duration
        # Distinct UID per instance so the recipient's calendar imports
        # each occurrence as its own appointment instead of overwriting
        # the previous one.
        uid_suffix = f"_{occurrence_start.strftime('%Y%m%dT%H%M%SZ')}"
    else:
        effective_start = event.start_time
        effective_end = event.end_time
        uid_suffix = ""
    uid = f"{event.id}{uid_suffix}@edgeos"
    now = _fmt_utc(datetime.now(UTC))
    dtstart = _fmt_utc(effective_start)
    dtend = _fmt_utc(effective_end)
    last_modified = (
        _fmt_utc(event.updated_at) if getattr(event, "updated_at", None) else now
    )
    seq = sequence if sequence is not None else int(getattr(event, "ical_sequence", 0))

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//EdgeOS//Events//EN",
        "CALSCALE:GREGORIAN",
        f"METHOD:{method}",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{now}",
        f"DTSTART:{dtstart}",
        f"DTEND:{dtend}",
        f"LAST-MODIFIED:{last_modified}",
        f"SEQUENCE:{seq}",
        f"SUMMARY:{title}",
    ]
    if description:
        lines.append(f"DESCRIPTION:{description}")
    if location:
        lines.append(f"LOCATION:{location}")
    if event_url:
        lines.append(f"URL:{_escape(event_url)}")

    if organizer_email:
        cn = f';CN="{_escape(organizer_name)}"' if organizer_name else ""
        lines.append(f"ORGANIZER{cn}:mailto:{organizer_email}")

    # ATTENDEE is mandatory for iTIP REQUEST/CANCEL. RSVP=TRUE surfaces the
    # Yes/Maybe/No chips in Gmail; PARTSTAT=NEEDS-ACTION tells the client
    # the invitee hasn't answered yet. Clients still add the entry to the
    # calendar regardless of what the user clicks.
    attendee_params = [
        "CUTYPE=INDIVIDUAL",
        "ROLE=REQ-PARTICIPANT",
        "PARTSTAT=NEEDS-ACTION",
        "RSVP=TRUE",
    ]
    if recipient_name:
        attendee_params.append(f'CN="{_escape(recipient_name)}"')
    attendee_line = (
        "ATTENDEE;" + ";".join(attendee_params) + f":mailto:{recipient_email}"
    )
    lines.append(attendee_line)

    if method == "CANCEL":
        lines.append("STATUS:CANCELLED")
    else:
        lines.append("STATUS:CONFIRMED")
    lines.extend(["TRANSP:OPAQUE", "END:VEVENT", "END:VCALENDAR"])

    return "\r\n".join(_fold(line) for line in lines) + "\r\n"
